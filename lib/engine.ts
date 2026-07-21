import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "./db";
import { trackedMatches, trades, priceSnapshots } from "./schema";
import {
  STRATEGY_NAMES,
  TOURS,
  TOUR_NAMES,
  DISCOVERY_PROBE_BUDGET,
  type StrategyName,
  type TourName,
} from "./config";
import {
  discoverTrackableMatches,
  getPriceReading,
  getMatchState,
  isMarketClosed,
  getSettlement,
  type PriceReading,
  type MatchState,
} from "./polymarket";
import {
  sidePrice,
  sideToTrack,
  decideEntry,
  decideExit,
  computePnl,
  buyFill,
  sellFill,
  takerFee,
  getStrategyConfig,
  type Side,
} from "./strategy";

const OPEN_STATUSES = ["watching", "entered"] as const;

type TrackedMatch = typeof trackedMatches.$inferSelect;

/**
 * Per-poll-cycle cache. The same match is often tracked by several strategies
 * at once; without this each strategy unit would re-fetch the same price/state,
 * multiplying Polymarket API calls (and risking the 60-req/min limit). Fetch
 * each market's price and each event's state once per cycle, share the result.
 */
class PollCache {
  private price = new Map<string, Promise<PriceReading>>();
  private state = new Map<string, Promise<MatchState>>();

  price_(marketSlug: string): Promise<PriceReading> {
    let p = this.price.get(marketSlug);
    if (!p) {
      p = getPriceReading(marketSlug);
      this.price.set(marketSlug, p);
    }
    return p;
  }

  state_(eventSlug: string): Promise<MatchState> {
    let s = this.state.get(eventSlug);
    if (!s) {
      s = getMatchState(eventSlug);
      this.state.set(eventSlug, s);
    }
    return s;
  }
}

function dateKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

async function openTradeFor(matchId: string) {
  return db
    .select()
    .from(trades)
    .where(and(eq(trades.matchId, matchId), isNull(trades.exitAt)))
    .get();
}

/** Mid price of the tracked side, for signal decisions and snapshots. */
function midFor(reading: PriceReading, side: Side): number | null {
  return reading.longPrice !== null ? sidePrice(reading.longPrice, side) : null;
}

async function closeAsResolved(match: TrackedMatch, now: number) {
  const settlement = await getSettlement(match.marketSlug);
  const longSettlement = settlement ?? 0.5; // push fallback if unavailable
  const finalPrice = sidePrice(longSettlement, match.side as Side);

  if (match.status === "entered") {
    const openTrade = await openTradeFor(match.id);
    if (openTrade) {
      // No exit fee/spread on hold-to-resolution: settlement isn't a taker trade.
      const gross = computePnl(openTrade.entryPrice, finalPrice, openTrade.stake);
      const pnl = gross - openTrade.fees;
      await db
        .update(trades)
        .set({
          exitPrice: finalPrice,
          exitAt: now,
          exitReason: pnl >= 0 ? "resolution_win" : "resolution_loss",
          pnl,
        })
        .where(eq(trades.id, openTrade.id));
    }
  }

  await db
    .update(trackedMatches)
    .set({ status: match.status === "entered" ? "exited" : "resolved", updatedAt: now })
    .where(eq(trackedMatches.id, match.id));
}

async function pollTrackedMatch(match: TrackedMatch, cache: PollCache) {
  const now = Date.now();
  const side = match.side as Side;
  const cfg = getStrategyConfig(match.strategy as StrategyName);
  const reading = await cache.price_(match.marketSlug);
  const mid = midFor(reading, side);

  if (mid !== null) {
    await db.insert(priceSnapshots).values({ matchId: match.id, price: mid, observedAt: now });
  }

  if (reading.looksResolved) {
    if (await isMarketClosed(match.marketSlug)) {
      await closeAsResolved(match, now);
    }
    return;
  }

  if (mid === null) return;

  if (match.status === "watching") {
    const state = await cache.state_(match.eventSlug);

    // Build the score context for the tracked side. Score is long-first.
    let gamesInLostSet1: number | null = null;
    const set1 = state.completedSetScores[0];
    if (set1) {
      const mineS1 = side === "long" ? set1.long : set1.short;
      const oppS1 = side === "long" ? set1.short : set1.long;
      if (mineS1 < oppS1) gamesInLostSet1 = mineS1; // lost set 1 with this many games
    }

    // Sets won by each side across completed sets → is the tracked side leading?
    let mySets = 0;
    let oppSets = 0;
    for (const s of state.completedSetScores) {
      const mine = side === "long" ? s.long : s.short;
      const opp = side === "long" ? s.short : s.long;
      if (mine > opp) mySets += 1;
      else if (opp > mine) oppSets += 1;
    }
    const leadingOnSets = mySets > oppSets;

    if (
      decideEntry(cfg, mid, match.openingPrice, state.completedSets, {
        gamesInLostSet1,
        leadingOnSets,
      }).action !== "enter"
    ) {
      return;
    }
    // Fill the buy at the ask (spread cost) and pay the entry taker fee.
    const stake = TOURS[match.tour as TourName].stake;
    const entryFill = buyFill(side, mid, reading.longBid, reading.longAsk);
    // Reject fills the spread pushed outside the band — don't overpay on thin
    // markets, and keep the % take-profit target reachable (< 1.0).
    if (entryFill < cfg.entryMin || entryFill > cfg.entryMax) return;
    const shares = stake / entryFill;
    const entryFee = takerFee(shares, entryFill);

    await db.insert(trades).values({
      id: crypto.randomUUID(),
      matchId: match.id,
      tour: match.tour,
      strategy: match.strategy,
      eventSlug: match.eventSlug,
      marketSlug: match.marketSlug,
      label: match.label,
      playerName: match.playerName,
      entryPrice: entryFill,
      entryAt: now,
      peakPrice: mid, // trailing high-water mark tracks the mid price
      stake,
      fees: entryFee,
      tradeDate: dateKey(now),
    });
    await db
      .update(trackedMatches)
      .set({ status: "entered", updatedAt: now })
      .where(eq(trackedMatches.id, match.id));
    return;
  }

  if (match.status === "entered") {
    const openTrade = await openTradeFor(match.id);
    if (!openTrade) return;

    // Update the trailing high-water mark (mid price) before deciding.
    const peak = Math.max(openTrade.peakPrice ?? openTrade.entryPrice, mid);
    if (peak !== openTrade.peakPrice) {
      await db.update(trades).set({ peakPrice: peak }).where(eq(trades.id, openTrade.id));
    }

    // Decisions use the mid price; the fill then pays the spread.
    const decision = decideExit(cfg, mid, openTrade.entryPrice, peak);
    if (decision.action === "hold") return;

    const exitFill = sellFill(side, mid, reading.longBid, reading.longAsk);
    const shares = openTrade.stake / openTrade.entryPrice;
    const exitFee = takerFee(shares, exitFill);
    const totalFees = openTrade.fees + exitFee;
    const gross = computePnl(openTrade.entryPrice, exitFill, openTrade.stake);
    const pnl = gross - totalFees;

    await db
      .update(trades)
      .set({ exitPrice: exitFill, exitAt: now, exitReason: decision.action, fees: totalFees, pnl })
      .where(eq(trades.id, openTrade.id));
    await db
      .update(trackedMatches)
      .set({ status: "exited", updatedAt: now })
      .where(eq(trackedMatches.id, match.id));
  }
}

async function discoverAndTrack(cache: PollCache) {
  const openMatches = await db
    .select({ tour: trackedMatches.tour })
    .from(trackedMatches)
    .where(inArray(trackedMatches.status, [...OPEN_STATUSES]));

  // Dedup against EVERY tracked unit, not just open ones — a (match × strategy)
  // is only ever tracked once (no re-entry after it exits/resolves).
  const allTracked = await db
    .select({ marketSlug: trackedMatches.marketSlug, strategy: trackedMatches.strategy })
    .from(trackedMatches);
  const trackedKeys = new Set(allTracked.map((m) => `${m.marketSlug}::${m.strategy}`));

  // Each tour (book) fills its own slots independently, so ITF's large, thin
  // pool can't crowd out the main-tour book.
  for (const tour of TOUR_NAMES) {
    const cfgTour = TOURS[tour];
    const openInTour = openMatches.filter((m) => m.tour === tour).length;
    let slotsAvailable = cfgTour.maxConcurrent - openInTour;
    if (slotsAvailable <= 0) continue;

    const candidates = await discoverTrackableMatches(cfgTour.tags);
    let probes = 0;

    for (const candidate of candidates) {
      if (slotsAvailable <= 0) break;
      if (probes >= DISCOVERY_PROBE_BUDGET) break; // cap API calls per tour per poll

      // Only lock in "the favorite" from BEFORE any set is decided. If we first
      // see a match mid-way (a set already completed), the current price reflects
      // that set's result — an underdog who won set 1 looks like the "favorite".
      // Skip those so `favorite` is always the genuine pre-match favorite.
      if (candidate.completedSets >= 1) continue;

      probes += 1;
      const reading = await cache.price_(candidate.marketSlug);
      if (reading.longPrice === null) continue;

      for (const strategyName of STRATEGY_NAMES) {
        if (slotsAvailable <= 0) break;
        const cfg = getStrategyConfig(strategyName);
        if (!cfg.enabled) continue;

        const key = `${candidate.marketSlug}::${strategyName}`;
        if (trackedKeys.has(key)) continue;

        const side = sideToTrack(cfg, reading.longPrice);
        if (!side) continue;

        const openingPrice = sidePrice(reading.longPrice, side);
        const playerName = side === "long" ? candidate.longName : candidate.shortName;

        await db
          .insert(trackedMatches)
          .values({
            id: crypto.randomUUID(),
            tour,
            strategy: strategyName,
            eventSlug: candidate.eventSlug,
            marketSlug: candidate.marketSlug,
            label: candidate.label,
            side,
            playerName,
            openingPrice,
            status: "watching",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          })
          .onConflictDoNothing();

        trackedKeys.add(key);
        slotsAvailable -= 1;
      }
    }
  }
}

/** Entry point for the cron route: poll all open positions, then discover new ones. */
export async function runPollCycle() {
  const openMatches = await db
    .select()
    .from(trackedMatches)
    .where(inArray(trackedMatches.status, [...OPEN_STATUSES]));

  const errors: string[] = [];
  const cache = new PollCache();

  // Isolate each match: one bad API call / row shouldn't abort the whole cycle.
  for (const match of openMatches) {
    try {
      await pollTrackedMatch(match, cache);
    } catch (err) {
      errors.push(`poll ${match.marketSlug} [${match.strategy}]: ${String(err)}`);
    }
  }

  try {
    await discoverAndTrack(cache);
  } catch (err) {
    errors.push(`discover: ${String(err)}`);
  }

  return { polled: openMatches.length, errors };
}

/**
 * Fast loop: re-check ONLY currently-open (entered) positions for exits. Meant
 * to run every ~1 minute so stop-losses fire near their target instead of
 * slipping 15%+ between the slow 5-minute discovery polls. It does no discovery
 * and touches only entered positions (a handful), so it stays well within the
 * 60-req/min rate limit.
 */
export async function runFastExitCheck() {
  const entered = await db
    .select()
    .from(trackedMatches)
    .where(eq(trackedMatches.status, "entered"));

  const errors: string[] = [];
  const cache = new PollCache();

  for (const match of entered) {
    try {
      await pollTrackedMatch(match, cache);
    } catch (err) {
      errors.push(`fast ${match.marketSlug}: ${String(err)}`);
    }
  }

  return { checked: entered.length, errors };
}
