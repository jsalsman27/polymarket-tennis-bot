import { desc, isNotNull, isNull } from "drizzle-orm";
import { db } from "./db";
import { trades } from "./schema";

export interface DayPnl {
  date: string;
  pnl: number;
  tradeCount: number;
  cumulativePnl: number;
}

export interface DashboardData {
  closedTrades: (typeof trades.$inferSelect)[];
  openTrades: (typeof trades.$inferSelect)[];
  dayPnl: DayPnl[];
  cumulativePnl: number;
  winRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  totalTrades: number;
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

  const byDate = new Map<string, { pnl: number; count: number }>();
  for (const t of closedTrades) {
    const existing = byDate.get(t.tradeDate) ?? { pnl: 0, count: 0 };
    existing.pnl += t.pnl ?? 0;
    existing.count += 1;
    byDate.set(t.tradeDate, existing);
  }

  const sortedDates = [...byDate.keys()].sort();
  let running = 0;
  const dayPnl: DayPnl[] = sortedDates.map((date) => {
    const { pnl, count } = byDate.get(date)!;
    running += pnl;
    return { date, pnl, tradeCount: count, cumulativePnl: running };
  });

  const wins = closedTrades.filter((t) => (t.pnl ?? 0) > 0);
  const losses = closedTrades.filter((t) => (t.pnl ?? 0) <= 0);

  return {
    closedTrades,
    openTrades,
    dayPnl,
    cumulativePnl: running,
    winRate: closedTrades.length > 0 ? wins.length / closedTrades.length : null,
    avgWin:
      wins.length > 0 ? wins.reduce((sum, t) => sum + (t.pnl ?? 0), 0) / wins.length : null,
    avgLoss:
      losses.length > 0
        ? losses.reduce((sum, t) => sum + (t.pnl ?? 0), 0) / losses.length
        : null,
    totalTrades: closedTrades.length,
  };
}
