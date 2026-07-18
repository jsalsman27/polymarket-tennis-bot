import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "./db";
import { trackedMatches, trades, priceSnapshots } from "./schema";
import { STRATEGY_CONFIG } from "./config";
import {
  discoverLiveTennisMatches,
  getPriceReading,
  isMarketClosed,
  getSettlement,
  favoritePrice,
} from "./polymarket";
import { determineFavoriteSide, decideEntry, decideExit, computePnl } from "./strategy";

const OPEN_STATUSES = ["watching", "entered"] as const;

function dateKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

async function closeAsResolved(match: typeof trackedMatches.$inferSelect, now: number) {
  const settlement = await getSettlement(match.marketSlug);
  // Fall back to 0.5 (push) if settlement isn't available yet — shouldn't normally happen
  // once the book has emptied out, but avoids leaving a trade open forever.
  const longSettlement = settlement ?? 0.5;
  const finalFavoritePrice = favoritePrice(longSettlement, match.favoriteSide as "long" | "short");

  if (match.status === "entered") {
    const openTrade = await db
      .select()
      .from(trades)
      .where(and(eq(trades.matchId, match.id), isNull(trades.exitAt)))
      .get();

    if (openTrade) {
      const pnl = computePnl(openTrade.entryPrice, finalFavoritePrice, openTrade.stake);
      await db
        .update(trades)
        .set({
          exitPrice: finalFavoritePrice,
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

async function pollTrackedMatch(match: typeof trackedMatches.$inferSelect) {
  const now = Date.now();
  const reading = await getPriceReading(match.marketSlug);
  const price =
    reading.longPrice !== null
      ? favoritePrice(reading.longPrice, match.favoriteSide as "long" | "short")
      : null;

  if (price !== null) {
    await db.insert(priceSnapshots).values({
      matchId: match.id,
      price,
      observedAt: now,
    });
  }

  if (reading.looksResolved) {
    const closed = await isMarketClosed(match.marketSlug);
    if (closed) {
      await closeAsResolved(match, now);
      return;
    }
    // Book is momentarily empty but market isn't closed yet (e.g. between games) — skip this tick.
    return;
  }

  if (price === null) return;

  if (match.status === "watching") {
    const decision = decideEntry(price);
    if (decision.action === "enter") {
      await db.insert(trades).values({
        id: crypto.randomUUID(),
        matchId: match.id,
        eventSlug: match.eventSlug,
        marketSlug: match.marketSlug,
        label: match.label,
        entryPrice: price,
        entryAt: now,
        stake: STRATEGY_CONFIG.STAKE_USD,
        tradeDate: dateKey(now),
      });
      await db
        .update(trackedMatches)
        .set({ status: "entered", updatedAt: now })
        .where(eq(trackedMatches.id, match.id));
    }
    return;
  }

  if (match.status === "entered") {
    const decision = decideExit(price);
    if (decision.action === "hold") return;

    const openTrade = await db
      .select()
      .from(trades)
      .where(and(eq(trades.matchId, match.id), isNull(trades.exitAt)))
      .get();
    if (!openTrade) return;

    const pnl = computePnl(openTrade.entryPrice, price, openTrade.stake);
    await db
      .update(trades)
      .set({
        exitPrice: price,
        exitAt: now,
        exitReason: decision.action,
        pnl,
      })
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

  const trackedSlugs = new Set(openMatches.map((m) => m.marketSlug));
  let slotsAvailable = STRATEGY_CONFIG.MAX_CONCURRENT_MATCHES - openMatches.length;
  if (slotsAvailable <= 0) return;

  const candidates = await discoverLiveTennisMatches();

  for (const candidate of candidates) {
    if (slotsAvailable <= 0) break;
    if (trackedSlugs.has(candidate.marketSlug)) continue;

    const reading = await getPriceReading(candidate.marketSlug);
    if (reading.longPrice === null) continue;

    const favoriteSide = determineFavoriteSide(reading.longPrice);
    if (!favoriteSide) continue; // no clear pre-match favorite yet; reconsider next poll

    const favoriteName = favoriteSide === "long" ? candidate.longName : candidate.shortName;
    const openingPrice = favoritePrice(reading.longPrice, favoriteSide);

    await db.insert(trackedMatches).values({
      id: crypto.randomUUID(),
      eventSlug: candidate.eventSlug,
      marketSlug: candidate.marketSlug,
      label: candidate.label,
      openingPrice,
      favoriteSide,
      favoriteName,
      status: "watching",
      createdAt: now,
      updatedAt: now,
    });

    trackedSlugs.add(candidate.marketSlug);
    slotsAvailable -= 1;
  }
}

/** Entry point for the cron route: poll all open matches, then look for new ones to track. */
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
