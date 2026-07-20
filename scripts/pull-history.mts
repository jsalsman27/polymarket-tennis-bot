/**
 * Pulls your Polymarket US trade history LOCALLY (read-only) and saves it to
 * data/my-trades.json for analysis. The API key is read from .env.local and
 * never leaves this machine / is never committed. Run: npx tsx scripts/pull-history.mts
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { PolymarketUS } from "polymarket-us";

// --- load creds from .env.local (gitignored) ---
function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(".env.local")) throw new Error(".env.local not found");
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const [k, ...rest] = t.split("=");
    out[k.trim()] = rest.join("=").trim();
  }
  return out;
}

const env = loadEnv();
const keyId = env.PM_KEY_ID;
const secretKey = env.PM_SECRET_KEY;
if (!keyId || !secretKey) throw new Error("PM_KEY_ID / PM_SECRET_KEY missing in .env.local");

const client = new PolymarketUS({ keyId, secretKey });

async function main() {
  console.log("Pulling activity history (read-only)…");
  const all: unknown[] = [];
  let cursor: string | undefined = undefined;
  let page = 0;

  // Paginate through all activities.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await client.portfolio.activities({ limit: 100, cursor });
    const acts = res.activities ?? [];
    all.push(...acts);
    page += 1;
    process.stdout.write(`  page ${page}: +${acts.length} (total ${all.length})\r`);
    if (res.eof || !res.nextCursor || acts.length === 0) break;
    cursor = res.nextCursor;
    if (page > 200) break; // safety
  }
  console.log(`\nDone. ${all.length} activities pulled.`);

  writeFileSync("data/my-trades.json", JSON.stringify(all, null, 2));
  console.log("Saved to data/my-trades.json");

  // Quick shape sample so we can see the structure.
  const trades = all.filter((a) => (a as { type?: string }).type === "ACTIVITY_TYPE_TRADE");
  console.log(`\nActivity type counts:`);
  const counts: Record<string, number> = {};
  for (const a of all) {
    const t = (a as { type?: string }).type ?? "unknown";
    counts[t] = (counts[t] ?? 0) + 1;
  }
  console.log(counts);
  console.log(`\nSample trade:`, JSON.stringify(trades[0], null, 2));
}

main().catch((e) => {
  console.error("FAILED:", e?.message || e);
  process.exit(1);
});
