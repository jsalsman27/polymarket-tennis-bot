import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "./db";
import { trackedMatches, trades, priceSnapshots } from "./schema";
import { STRATEGY_CONFIG, STRATEGY_NAMES, type StrategyName } from "./config";
import {
  discoverLiveTennisMatches,
  getPriceReading,
  getMatchState,
  isMarketClosed,
  getSettlement,
  type PriceReading,
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

async function pollTrackedMatch(match: TrackedMatch) {
  const now = Date.now();
  const side = match.side as Side;
  const cfg = getStrategyConfig(match.strategy as StrategyName);
  const reading = await getPriceReading(match.marketSlug);
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
    const state = await getMatchState(match.eventSlug);
    if (decideEntry(cfg, mid, match.openingPrice, state.completedSets).action !== "enter") {
      return;
    }
    // Fill the buy at the ask (spread cost) and pay the entry taker fee.
    const entryFill = buyFill(side, mid, reading.longBid, reading.longAsk);
    const shares = STRATEGY_CONFIG.STAKE_USD / entryFill;
    const entryFee = takerFee(shares, entryFill);

    await db.insert(trades).values({
      id: crypto.randomUUID(),
      matchId: match.id,
      strategy: match.strategy,
      eventSlug: match.eventSlug,
      marketSlug: match.marketSlug,
      label: match.label,
      playerName: match.playerName,
      entryPrice: entryFill,
      entryAt: now,
      stake: STRATEGY_CONFIG.STAKE_USD,
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
    // Decisions use the mid price; the fill then pays the spread.
    const decision = decideExit(cfg, mid, openTrade.entryPrice);
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

async function discoverAndTrack() {
  const now = Date.now();
  const openMatches = await db
    .select()
    .from(trackedMatches)
    .where(inArray(trackedMatches.status, [...OPEN_STATUSES]));

  let slotsAvailable = STRATEGY_CONFIG.MAX_CONCURRENT - openMatches.length;
  if (slotsAvailable <= 0) return;

  const trackedKeys = new Set(openMatches.map((m) => `${m.marketSlug}::${m.strategy}`));

  const candidates = await discoverLiveTennisMatches();

  for (const candidate of candidates) {
    if (slotsAvailable <= 0) break;

    const reading = await getPriceReading(candidate.marketSlug);
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

      await db.insert(trackedMatches).values({
        id: crypto.randomUUID(),
        strategy: strategyName,
        eventSlug: candidate.eventSlug,
        marketSlug: candidate.marketSlug,
        label: candidate.label,
        side,
        playerName,
        openingPrice,
        status: "watching",
        createdAt: now,
        updatedAt: now,
      });

      trackedKeys.add(key);
      slotsAvailable -= 1;
    }
  }
}

/** Entry point for the cron route: poll all open positions, then discover new ones. */
export async function runPollCycle() {
  const openMatches = await db
    .select()
    .from(trackedMatches)
    .where(inArray(trackedMatches.status, [...OPEN_STATUSES]));

  for (const match of openMatches) {
    await pollTrackedMatch(match);
  }

  await discoverAndTrack();
}
