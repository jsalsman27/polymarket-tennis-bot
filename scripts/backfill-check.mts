/**
 * Recompute TRUE P/L of closed trades using real settlements (the resolution
 * exits were mis-booked at a 0.5 push before the settlement-timing fix).
 * Run: DATABASE_URL=... DATABASE_AUTH_TOKEN=... npx tsx scripts/backfill-check.mts
 */
import { isNotNull } from "drizzle-orm";
import { db } from "../lib/db";
import { trades, trackedMatches } from "../lib/schema";
import { getSettlement, type MatchState } from "../lib/polymarket";
import { sidePrice, computePnl, type Side } from "../lib/strategy";

const closed = await db.select().from(trades).where(isNotNull(trades.exitAt));
const tracked = await db.select().from(trackedMatches);
const sideById = new Map(tracked.map((m) => [m.id, m.side as Side]));

let bookedTotal = 0;
let trueTotal = 0;
let resWins = 0;
let resLosses = 0;
let recomputed = 0;

for (const t of closed) {
  bookedTotal += t.pnl ?? 0;
  const isResolution = (t.exitReason ?? "").startsWith("resolution");
  if (!isResolution) {
    trueTotal += t.pnl ?? 0; // stop-losses were booked at a real observed price
    continue;
  }
  const side = sideById.get(t.matchId);
  if (!side) {
    trueTotal += t.pnl ?? 0;
    continue;
  }
  const settlement = await getSettlement(t.marketSlug);
  if (settlement === null) {
    trueTotal += t.pnl ?? 0;
    continue;
  }
  const finalPrice = sidePrice(settlement, side);
  const gross = computePnl(t.entryPrice, finalPrice, t.stake);
  const truePnl = gross - (t.fees ?? 0);
  trueTotal += truePnl;
  recomputed += 1;
  if (finalPrice > t.entryPrice) resWins += 1;
  else resLosses += 1;
}

console.log(`closed trades: ${closed.length}`);
console.log(`recomputed resolution trades: ${recomputed}  (real wins ${resWins}, real losses ${resLosses})`);
console.log(`BOOKED total P/L (buggy):  $${bookedTotal.toFixed(2)}`);
console.log(`TRUE total P/L (fixed):    $${trueTotal.toFixed(2)}`);

// avoid unused import type error
void (0 as unknown as MatchState);
