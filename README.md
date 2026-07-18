# Polymarket Tennis Swing Bot — v1 (Paper Trading)

Simulates a tennis in-play swing-trading strategy against live Polymarket US
prices. **No real orders are ever placed and no funds move** — this is a
paper-trading harness only.

## Strategy (v1)

1. **Discover**: poll ATP/WTA singles matches currently live on Polymarket US.
2. **Baseline**: on first sighting of a live match, record the current price
   of whichever side is above 0.50 as the "pre-match favorite" and its price.
3. **Entry**: buy (simulated) the favorite if its price falls into
   **0.28–0.35** (proxy for "favorite lost set 1" — see [Assumptions](#assumptions-and-open-questions)).
4. **Exit**: sell at **0.48–0.52** (take profit) or **0.15–0.18** (stop
   loss); if neither is hit before the match ends, hold to settlement (1.0/0.0).
5. One entry per match, flat $2 stake, max 4 matches tracked concurrently.

All thresholds live in [`lib/config.ts`](lib/config.ts) — tune them without
touching the engine.

## Stack

- Next.js 16 (App Router), deployed to Vercel
- Vercel Cron (`vercel.json`) hits `/api/cron/poll` every 5 minutes
- Polymarket US public gateway (`polymarket-us` SDK) for read-only market
  data — no API key, no wallet signing anywhere in this codebase
- Drizzle ORM over libSQL (SQLite-compatible), used identically in dev and prod

## Local dev (Codespaces)

```bash
npm install
npm run db:push   # creates data/dev.db from lib/schema.ts
npm run dev
```

Visit the dev server for the dashboard. To manually trigger a poll cycle
(instead of waiting on cron) once the dev server is running:

```bash
curl http://localhost:3000/api/cron/poll
```

## Deploying to Vercel

### 1. Persistence — swap SQLite file for a hosted libSQL DB

Vercel's serverless filesystem doesn't persist writes across invocations, so
the local `data/dev.db` file approach only works in Codespaces. Before
deploying:

1. Create a free [Turso](https://turso.tech) database (`turso db create
   tennis-bot`, or any libSQL-compatible host).
2. In the Vercel project settings, set:
   - `DATABASE_URL` → e.g. `libsql://tennis-bot-<org>.turso.io`
   - `DATABASE_AUTH_TOKEN` → your Turso auth token
3. Run `npm run db:push` once locally with those same env vars set, to apply
   the schema to the hosted DB.

No code changes needed — [`lib/db.ts`](lib/db.ts) already reads
`DATABASE_URL`/`DATABASE_AUTH_TOKEN` and falls back to the local file only
when they're unset.

### 2. Cron frequency and the Vercel Hobby plan

**Vercel's free Hobby plan limits cron jobs to one run per day**, which is too
infrequent for in-play tennis — and it rejects deploys that declare a more
frequent schedule. So `vercel.json` is set to a daily run (`0 12 * * *`) purely
to keep Hobby deploys valid; real polling is driven by an external scheduler.

To poll every few minutes on the free plan, hit the deployed poll endpoint from
an external scheduler:

```
GET https://<your-app>.vercel.app/api/cron/poll
Authorization: Bearer <CRON_SECRET>
```

Options: a free service like [cron-job.org](https://cron-job.org), or a GitHub
Actions workflow on a `schedule:` trigger. (Upgrading to Vercel Pro would allow
minute-level `vercel.json` cron and remove the need for this.)

### 3. Optional: protect the poll endpoint

Set a `CRON_SECRET` env var in Vercel; the route then requires
`Authorization: Bearer <CRON_SECRET>` (which Vercel Cron sends
automatically). Leave it unset for open/local testing.

## Assumptions and open questions

- **Entry signal is a price proxy, not live scores.** Per the original brief,
  "favorite lost set 1" is detected via a price drop into 0.28–0.35 rather
  than a separate live-scores feed — this matches how trades have been made
  manually. Worth knowing: the Polymarket US events API already returns a
  `period` field (e.g. `"S1"`, `"FT"`) with actual set-level match state on
  every event we poll. A v1.5 could cross-reference `period` for a sharper
  signal at effectively no extra integration cost, since we're already
  fetching it.
- **"Pre-match favorite" is approximated from first-observed price**, not a
  true pre-match line, since the bot only starts tracking a match once it's
  already live. If polling starts well after the match begins, the baseline
  could already reflect in-game movement. Matches with no clear favorite
  (price within ~0.02 of 0.50) are skipped rather than guessed at.
- **Only ATP and WTA tour tags are watched by default** (`lib/polymarket.ts`,
  `TENNIS_TAGS`). ITF tour tags (`itfm`, `itfw`) exist on Polymarket US too
  but tend to be thinner markets — add them to `TENNIS_TAGS` if broader
  coverage is wanted.
- **The `polymarket-us` npm SDK (v0.1.1) ships TypeScript response types that
  don't match the live API** (missing `marketSides`, `live`, `period`;
  prices nested as `{ value, currency }` rather than flat numbers). All types
  in `lib/polymarket.ts` were derived by querying the live gateway directly
  rather than trusting the bundled `.d.ts` files — worth re-verifying if the
  SDK gets a version bump.
- **Which Polymarket account/API this targets was confirmed as Polymarket US**
  (CFTC-regulated, `gateway.polymarket.us`) at build time — if that ever
  changes to the offshore Polymarket.com product, the API surface and base
  URLs in `lib/polymarket.ts` would need to change too.

## Project structure

- `lib/config.ts` — tunable strategy constants
- `lib/polymarket.ts` — read-only Polymarket US gateway client
- `lib/strategy.ts` — pure entry/exit decision functions
- `lib/engine.ts` — orchestrates discovery + polling + simulated trade bookkeeping
- `lib/schema.ts` / `lib/db.ts` — Drizzle schema and DB client
- `lib/stats.ts` — dashboard aggregation (P/L, win rate, etc.)
- `app/api/cron/poll/route.ts` — the Vercel Cron entry point
- `app/page.tsx` — dashboard
