import { desc, isNotNull, isNull } from "drizzle-orm";
import { db } from "./db";
import { trades } from "./schema";
import { STRATEGY_NAMES, type StrategyName } from "./config";

type Trade = typeof trades.$inferSelect;

export interface Stats {
  totalTrades: number;
  /** Net cumulative P/L (after spread + fees). */
  cumulativePnl: number;
  /** Total taker fees paid across all closed trades. */
  totalFees: number;
  winRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  /** Average P/L per trade (expectancy). */
  expectancy: number | null;
}

export interface DayPnl {
  date: string;
  pnl: number;
  tradeCount: number;
  cumulativePnl: number;
}

export interface EntryBucket {
  label: string;
  tradeCount: number;
  pnl: number;
  winRate: number;
  expectancy: number;
}

export interface DashboardData {
  overall: Stats;
  perStrategy: Record<StrategyName, Stats>;
  dayPnl: DayPnl[];
  entryBuckets: EntryBucket[];
  closedTrades: Trade[];
  openTrades: Trade[];
}

function computeStats(closed: Trade[]): Stats {
  const wins = closed.filter((t) => (t.pnl ?? 0) > 0);
  const losses = closed.filter((t) => (t.pnl ?? 0) <= 0);
  const cumulativePnl = closed.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const totalFees = closed.reduce((s, t) => s + (t.fees ?? 0), 0);
  return {
    totalTrades: closed.length,
    cumulativePnl,
    totalFees,
    winRate: closed.length > 0 ? wins.length / closed.length : null,
    avgWin: wins.length > 0 ? wins.reduce((s, t) => s + (t.pnl ?? 0), 0) / wins.length : null,
    avgLoss: losses.length > 0 ? losses.reduce((s, t) => s + (t.pnl ?? 0), 0) / losses.length : null,
    expectancy: closed.length > 0 ? cumulativePnl / closed.length : null,
  };
}

function bucketFor(entryPrice: number): string {
  const lo = Math.floor(entryPrice * 10) / 10;
  const hi = lo + 0.1;
  return `${lo.toFixed(2)}–${hi.toFixed(2)}`;
}

export async function getDashboardData(): Promise<DashboardData> {
  const closedTrades = await db
    .select()
    .from(trades)
    .where(isNotNull(trades.exitAt))
    .orderBy(desc(trades.entryAt));

  const openTrades = await db
    .select()
    .from(trades)
    .where(isNull(trades.exitAt))
    .orderBy(desc(trades.entryAt));

  // Per-day P/L + running cumulative.
  const byDate = new Map<string, { pnl: number; count: number }>();
  for (const t of closedTrades) {
    const e = byDate.get(t.tradeDate) ?? { pnl: 0, count: 0 };
    e.pnl += t.pnl ?? 0;
    e.count += 1;
    byDate.set(t.tradeDate, e);
  }
  let running = 0;
  const dayPnl: DayPnl[] = [...byDate.keys()]
    .sort()
    .map((date) => {
      const { pnl, count } = byDate.get(date)!;
      running += pnl;
      return { date, pnl, tradeCount: count, cumulativePnl: running };
    });

  // Per-strategy stats.
  const perStrategy = Object.fromEntries(
    STRATEGY_NAMES.map((name) => [
      name,
      computeStats(closedTrades.filter((t) => t.strategy === name)),
    ])
  ) as Record<StrategyName, Stats>;

  // Entry-price bucket stats (which price bands actually pay).
  const byBucket = new Map<string, Trade[]>();
  for (const t of closedTrades) {
    const b = bucketFor(t.entryPrice);
    (byBucket.get(b) ?? byBucket.set(b, []).get(b)!).push(t);
  }
  const entryBuckets: EntryBucket[] = [...byBucket.keys()]
    .sort()
    .map((label) => {
      const ts = byBucket.get(label)!;
      const s = computeStats(ts);
      return {
        label,
        tradeCount: ts.length,
        pnl: s.cumulativePnl,
        winRate: s.winRate ?? 0,
        expectancy: s.expectancy ?? 0,
      };
    });

  return {
    overall: computeStats(closedTrades),
    perStrategy,
    dayPnl,
    entryBuckets,
    closedTrades,
    openTrades,
  };
}
