import { getDashboardData, type Stats } from "@/lib/stats";
import { STRATEGY_NAMES } from "@/lib/config";

export const dynamic = "force-dynamic";

function fmtUsd(n: number | null): string {
  if (n === null || n === undefined) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function fmtPct(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return `${(n * 100).toFixed(0)}%`;
}

function fmtTime(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function pnlClass(n: number | null | undefined): string {
  if (n === null || n === undefined) return "text-zinc-500";
  return n >= 0 ? "text-emerald-600" : "text-red-600";
}

const STRATEGY_LABEL: Record<string, string> = {
  favorite_dip: "Favorite dip",
  underdog_momentum: "Underdog momentum",
};

const EXIT_REASON_LABEL: Record<string, string> = {
  take_profit: "Take profit",
  stop_loss: "Stop loss",
  resolution_win: "Resolution (won)",
  resolution_loss: "Resolution (lost)",
};

export default async function Home() {
  const data = await getDashboardData();

  return (
    <div className="flex flex-col flex-1 bg-zinc-50 dark:bg-black">
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            Tennis Swing Bot
          </h1>
          <p className="mt-1 text-sm font-medium text-amber-600">
            Paper trading only — no real orders are placed, no funds move.
          </p>
        </header>

        <section className="mb-3 grid grid-cols-2 gap-4 sm:grid-cols-5">
          <StatCard label="Net P/L" value={fmtUsd(data.overall.cumulativePnl)} valueClass={pnlClass(data.overall.cumulativePnl)} />
          <StatCard label="Trades" value={String(data.overall.totalTrades)} />
          <StatCard label="Win rate" value={fmtPct(data.overall.winRate)} />
          <StatCard label="Expectancy / trade" value={fmtUsd(data.overall.expectancy)} valueClass={pnlClass(data.overall.expectancy)} />
          <StatCard label="Fees paid" value={fmtUsd(data.overall.totalFees)} valueClass="text-zinc-500" />
        </section>
        <p className="mb-10 text-xs text-zinc-500">
          P/L is net — fills pay the live bid/ask spread and Polymarket&apos;s taker fee. Hold-to-resolution exits incur no fee.
        </p>

        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Strategy comparison
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {STRATEGY_NAMES.map((name) => (
              <StrategyCard
                key={name}
                title={STRATEGY_LABEL[name] ?? name}
                stats={data.perStrategy[name]}
              />
            ))}
          </div>
        </section>

        {data.openTrades.length > 0 && (
          <Section title="Open positions">
            <Table
              head={["Match", "Strategy", "Side", "Entry", "Entered", "Stake"]}
              rows={data.openTrades.map((t) => [
                t.label,
                STRATEGY_LABEL[t.strategy] ?? t.strategy,
                t.playerName,
                t.entryPrice.toFixed(2),
                fmtTime(t.entryAt),
                fmtUsd(t.stake),
              ])}
            />
          </Section>
        )}

        <Section title="Which entry prices pay (by bucket)">
          {data.entryBuckets.length === 0 ? (
            <Empty />
          ) : (
            <Table
              head={["Entry price", "Trades", "Win rate", "Total P/L", "Expectancy"]}
              rows={data.entryBuckets.map((b) => [
                b.label,
                String(b.tradeCount),
                fmtPct(b.winRate),
                { text: fmtUsd(b.pnl), className: pnlClass(b.pnl) },
                { text: fmtUsd(b.expectancy), className: pnlClass(b.expectancy) },
              ])}
            />
          )}
        </Section>

        <Section title="Per-trial (daily) P/L">
          {data.dayPnl.length === 0 ? (
            <Empty />
          ) : (
            <Table
              head={["Date", "Trades", "Day P/L", "Cumulative P/L"]}
              rows={[...data.dayPnl].reverse().map((d) => [
                d.date,
                String(d.tradeCount),
                { text: fmtUsd(d.pnl), className: pnlClass(d.pnl) },
                { text: fmtUsd(d.cumulativePnl), className: pnlClass(d.cumulativePnl) },
              ])}
            />
          )}
        </Section>

        <Section title="Trade log">
          {data.closedTrades.length === 0 ? (
            <Empty />
          ) : (
            <Table
              head={["Match", "Strategy", "Entry", "Exit", "Reason", "P/L"]}
              rows={data.closedTrades.map((t) => [
                t.label,
                STRATEGY_LABEL[t.strategy] ?? t.strategy,
                t.entryPrice.toFixed(2),
                t.exitPrice !== null ? t.exitPrice.toFixed(2) : "—",
                t.exitReason ? EXIT_REASON_LABEL[t.exitReason] ?? t.exitReason : "—",
                { text: fmtUsd(t.pnl), className: pnlClass(t.pnl) },
              ])}
            />
          )}
        </Section>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
      {children}
    </section>
  );
}

function Empty() {
  return <p className="text-sm text-zinc-500">No closed trades yet.</p>;
}

type Cell = string | { text: string; className?: string };

function Table({ head, rows }: { head: string[]; rows: Cell[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-sm">
        <thead className="bg-zinc-100 text-left text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-zinc-200 dark:border-zinc-800">
              {row.map((cell, j) => {
                const text = typeof cell === "string" ? cell : cell.text;
                const cn = typeof cell === "string" ? "" : cell.className ?? "";
                return (
                  <td key={j} className={`px-4 py-2 ${cn ? `font-medium ${cn}` : ""}`}>
                    {text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatCard({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${valueClass ?? "text-zinc-900 dark:text-zinc-50"}`}>
        {value}
      </div>
    </div>
  );
}

function StrategyCard({ title, stats }: { title: string; stats: Stats }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">{title}</h3>
        <span className={`text-lg font-semibold ${pnlClass(stats.cumulativePnl)}`}>
          {fmtUsd(stats.cumulativePnl)}
        </span>
      </div>
      <dl className="grid grid-cols-4 gap-2 text-center text-xs">
        <Metric label="Trades" value={String(stats.totalTrades)} />
        <Metric label="Win %" value={fmtPct(stats.winRate)} />
        <Metric label="Exp/trade" value={fmtUsd(stats.expectancy)} valueClass={pnlClass(stats.expectancy)} />
        <Metric label="Avg win" value={fmtUsd(stats.avgWin)} valueClass="text-emerald-600" />
      </dl>
    </div>
  );
}

function Metric({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div>
      <div className="text-zinc-500">{label}</div>
      <div className={`mt-0.5 font-semibold ${valueClass ?? "text-zinc-900 dark:text-zinc-50"}`}>
        {value}
      </div>
    </div>
  );
}
