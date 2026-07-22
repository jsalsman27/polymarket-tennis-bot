import { getDashboardData, type BookData, type Stats } from "@/lib/stats";
import { ENABLED_STRATEGY_NAMES } from "@/lib/config";

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
  back_favorite: "Leading fav · with stop",
  back_favorite_hold: "Leading fav · hold to end",
  favorite_dip: "Favorite dip",
  underdog_momentum: "Underdog momentum",
  underdog_pre_match: "Underdog pre-match",
};

const EXIT_REASON_LABEL: Record<string, string> = {
  take_profit: "Take profit",
  stop_loss: "Stop loss",
  trail_stop: "Trailing exit",
  resolution_win: "Resolution (won)",
  resolution_loss: "Resolution (lost)",
};

export default async function Home() {
  const { books } = await getDashboardData();

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
          <p className="mt-1 text-xs text-zinc-500">
            Two separate paper books. Main tour (ATP/WTA) and ITF are kept apart so the thinner ITF
            markets don&apos;t muddy the main-tour data. P/L is net of the live spread and Polymarket&apos;s
            taker fee.
          </p>
        </header>

        {books.map((book) => (
          <Book key={book.tour} book={book} />
        ))}
      </main>
    </div>
  );
}

function Book({ book }: { book: BookData }) {
  const netPnl = book.overall.cumulativePnl;
  const returnPct = book.startingBankroll > 0 ? netPnl / book.startingBankroll : null;

  return (
    <section className="mb-14 border-t border-zinc-200 pt-8 first:border-t-0 first:pt-0 dark:border-zinc-800">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">{book.label}</h2>
        <div className="text-sm text-zinc-500">
          Bankroll{" "}
          <span className={`text-base font-semibold ${pnlClass(book.balance - book.startingBankroll)}`}>
            {fmtUsd(book.balance)}
          </span>{" "}
          <span className="text-zinc-400">(started ${book.startingBankroll.toFixed(0)})</span>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard label="Net P/L" value={fmtUsd(netPnl)} valueClass={pnlClass(netPnl)} />
        <StatCard label="Return" value={fmtPct(returnPct)} valueClass={pnlClass(returnPct)} />
        <StatCard label="Trades" value={String(book.overall.totalTrades)} />
        <StatCard label="Win rate" value={fmtPct(book.overall.winRate)} />
        <StatCard label="Fees paid" value={fmtUsd(book.overall.totalFees)} valueClass="text-zinc-500" />
      </div>

      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
        Strategy comparison
      </h3>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ENABLED_STRATEGY_NAMES.map((name) => (
          <StrategyCard key={name} title={STRATEGY_LABEL[name] ?? name} stats={book.perStrategy[name]} />
        ))}
      </div>

      {book.openTrades.length > 0 && (
        <Sub title="Open positions">
          <Table
            head={["Match", "Strategy", "Side", "Entry", "Entered", "Stake"]}
            rows={book.openTrades.map((t) => [
              t.label,
              STRATEGY_LABEL[t.strategy] ?? t.strategy,
              t.playerName,
              t.entryPrice.toFixed(2),
              fmtTime(t.entryAt),
              fmtUsd(t.stake),
            ])}
          />
        </Sub>
      )}

      <Sub title="Which entry prices pay (by bucket)">
        {book.entryBuckets.length === 0 ? (
          <Empty />
        ) : (
          <Table
            head={["Entry price", "Trades", "Win rate", "Total P/L", "Expectancy"]}
            rows={book.entryBuckets.map((b) => [
              b.label,
              String(b.tradeCount),
              fmtPct(b.winRate),
              { text: fmtUsd(b.pnl), className: pnlClass(b.pnl) },
              { text: fmtUsd(b.expectancy), className: pnlClass(b.expectancy) },
            ])}
          />
        )}
      </Sub>

      <Sub title="Trade log">
        {book.closedTrades.length === 0 ? (
          <Empty />
        ) : (
          <Table
            head={["Match", "Strategy", "Entry", "Exit", "Reason", "P/L"]}
            rows={book.closedTrades.slice(0, 100).map((t) => [
              t.label,
              STRATEGY_LABEL[t.strategy] ?? t.strategy,
              t.entryPrice.toFixed(2),
              t.exitPrice !== null ? t.exitPrice.toFixed(2) : "—",
              t.exitReason ? EXIT_REASON_LABEL[t.exitReason] ?? t.exitReason : "—",
              { text: fmtUsd(t.pnl), className: pnlClass(t.pnl) },
            ])}
          />
        )}
      </Sub>
    </section>
  );
}

function Sub({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
      {children}
    </div>
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
      <div className={`mt-1 text-lg font-semibold ${valueClass ?? "text-zinc-900 dark:text-zinc-50"}`}>
        {value}
      </div>
    </div>
  );
}

function StrategyCard({ title, stats }: { title: string; stats: Stats }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-3 flex items-baseline justify-between">
        <h4 className="font-semibold text-zinc-900 dark:text-zinc-50">{title}</h4>
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
