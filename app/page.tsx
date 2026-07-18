import { getDashboardData } from "@/lib/stats";

export const dynamic = "force-dynamic";

function fmtUsd(n: number | null): string {
  if (n === null) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function fmtPct(n: number | null): string {
  if (n === null) return "—";
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

function pnlClass(n: number | null): string {
  if (n === null) return "text-zinc-500";
  return n >= 0 ? "text-emerald-600" : "text-red-600";
}

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

        <section className="mb-10 grid grid-cols-2 gap-4 sm:grid-cols-5">
          <StatCard label="Cumulative P/L" value={fmtUsd(data.cumulativePnl)} valueClass={pnlClass(data.cumulativePnl)} />
          <StatCard label="Trades" value={String(data.totalTrades)} />
          <StatCard label="Win rate" value={fmtPct(data.winRate)} />
          <StatCard label="Avg win" value={fmtUsd(data.avgWin)} valueClass="text-emerald-600" />
          <StatCard label="Avg loss" value={fmtUsd(data.avgLoss)} valueClass="text-red-600" />
        </section>

        {data.openTrades.length > 0 && (
          <section className="mb-10">
            <h2 className="mb-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              Open positions
            </h2>
            <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-sm">
                <thead className="bg-zinc-100 text-left text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                  <tr>
                    <th className="px-4 py-2 font-medium">Match</th>
                    <th className="px-4 py-2 font-medium">Entry price</th>
                    <th className="px-4 py-2 font-medium">Entered</th>
                    <th className="px-4 py-2 font-medium">Stake</th>
                  </tr>
                </thead>
                <tbody>
                  {data.openTrades.map((t) => (
                    <tr key={t.id} className="border-t border-zinc-200 dark:border-zinc-800">
                      <td className="px-4 py-2">{t.label}</td>
                      <td className="px-4 py-2">{t.entryPrice.toFixed(2)}</td>
                      <td className="px-4 py-2">{fmtTime(t.entryAt)}</td>
                      <td className="px-4 py-2">{fmtUsd(t.stake)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Per-trial (daily) P/L
          </h2>
          {data.dayPnl.length === 0 ? (
            <p className="text-sm text-zinc-500">No closed trades yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-sm">
                <thead className="bg-zinc-100 text-left text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                  <tr>
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">Trades</th>
                    <th className="px-4 py-2 font-medium">Day P/L</th>
                    <th className="px-4 py-2 font-medium">Cumulative P/L</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.dayPnl].reverse().map((d) => (
                    <tr key={d.date} className="border-t border-zinc-200 dark:border-zinc-800">
                      <td className="px-4 py-2">{d.date}</td>
                      <td className="px-4 py-2">{d.tradeCount}</td>
                      <td className={`px-4 py-2 font-medium ${pnlClass(d.pnl)}`}>{fmtUsd(d.pnl)}</td>
                      <td className={`px-4 py-2 font-medium ${pnlClass(d.cumulativePnl)}`}>
                        {fmtUsd(d.cumulativePnl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Trade log
          </h2>
          {data.closedTrades.length === 0 ? (
            <p className="text-sm text-zinc-500">No closed trades yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-sm">
                <thead className="bg-zinc-100 text-left text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                  <tr>
                    <th className="px-4 py-2 font-medium">Match</th>
                    <th className="px-4 py-2 font-medium">Entry</th>
                    <th className="px-4 py-2 font-medium">Exit</th>
                    <th className="px-4 py-2 font-medium">Reason</th>
                    <th className="px-4 py-2 font-medium">P/L</th>
                  </tr>
                </thead>
                <tbody>
                  {data.closedTrades.map((t) => (
                    <tr key={t.id} className="border-t border-zinc-200 dark:border-zinc-800">
                      <td className="px-4 py-2">{t.label}</td>
                      <td className="px-4 py-2">
                        {t.entryPrice.toFixed(2)}
                        <span className="ml-1 text-xs text-zinc-500">{fmtTime(t.entryAt)}</span>
                      </td>
                      <td className="px-4 py-2">
                        {t.exitPrice !== null ? t.exitPrice.toFixed(2) : "—"}
                        <span className="ml-1 text-xs text-zinc-500">{fmtTime(t.exitAt)}</span>
                      </td>
                      <td className="px-4 py-2">
                        {t.exitReason ? EXIT_REASON_LABEL[t.exitReason] ?? t.exitReason : "—"}
                      </td>
                      <td className={`px-4 py-2 font-medium ${pnlClass(t.pnl)}`}>{fmtUsd(t.pnl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
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
