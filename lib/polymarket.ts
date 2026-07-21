import { PolymarketUS } from "polymarket-us";

/**
 * Thin wrapper around the Polymarket US public gateway for read-only tennis
 * market data. No API key / wallet signing is used anywhere in this file —
 * only the public, unauthenticated endpoints under https://gateway.polymarket.us.
 *
 * The bundled `polymarket-us` SDK (v0.1.1) ships TypeScript response types
 * that don't fully match the live API (e.g. it's missing `marketSides`,
 * `live`, `period`, and nests prices as `{ value, currency }`). The types
 * below were derived empirically by querying the live gateway directly, and
 * are used in place of the SDK's declared types for the fields we rely on.
 */

import { STRATEGY_CONFIG } from "./config";

const client = new PolymarketUS();

const HOUR_MS = 60 * 60 * 1000;
// How far back a start time can be and still count as a real live match (drops
// the gateway's stale "live" flags left on long-finished matches).
const LIVE_LOOKBACK_MS = STRATEGY_CONFIG.LIVE_LOOKBACK_HOURS * HOUR_MS;
// How far ahead to surface not-yet-started matches (for pre-match entries).
const UPCOMING_WINDOW_MS = STRATEGY_CONFIG.UPCOMING_WINDOW_HOURS * HOUR_MS;

interface Amount {
  value: string;
  currency: string;
}

interface RawMarketSide {
  description: string;
  price: string;
  long: boolean;
}

interface RawMarket {
  slug: string;
  marketType?: string;
  sportsMarketType?: string;
  closed?: boolean;
  marketSides?: RawMarketSide[];
}

interface RawEvent {
  slug: string;
  startTime?: string;
  closed?: boolean;
  live?: boolean;
  period?: string;
  score?: string;
  markets?: RawMarket[];
}

interface RawEventsResponse {
  events: RawEvent[];
}

interface RawBboResponse {
  marketData: {
    marketSlug: string;
    currentPx?: Amount | null;
    bestBid?: Amount | null;
    bestAsk?: Amount | null;
  };
}

interface RawMarketResponse {
  market: RawMarket;
}

interface RawSettlementResponse {
  slug: string;
  settlement: number;
}

export interface LiveTennisMatch {
  eventSlug: string;
  marketSlug: string;
  label: string;
  /** Player name on the "long" side, whose price the bbo endpoint quotes directly. */
  longName: string;
  /** Player name on the "short" side; price = 1 - long price. */
  shortName: string;
  /** Completed sets at discovery time — used to only lock the favorite pre-set-1. */
  completedSets: number;
}

export interface PriceReading {
  /** Live price of the market's "long" side (i.e. the raw currentPx), or null if unavailable. */
  longPrice: number | null;
  /** Best bid for the long side (what you'd receive selling long). */
  longBid: number | null;
  /** Best ask for the long side (what you'd pay buying long). */
  longAsk: number | null;
  /** True once the order book has emptied out, which happens on/after resolution. */
  looksResolved: boolean;
}

/** Games in one set, from the score string (always long-player-first). */
export interface SetScore {
  long: number;
  short: number;
}

export interface MatchState {
  period: string | null;
  /** Number of fully completed sets, derived from `period` (S2 => 1, FT => finished). */
  completedSets: number;
  /** Per-completed-set games (long-first). Empty if none/unknown. */
  completedSetScores: SetScore[];
  /** Games so far in the in-progress set (long-first), or null. */
  currentSet: SetScore | null;
  closed: boolean;
  live: boolean;
}

function toNumber(amount: Amount | null | undefined): number | null {
  if (!amount) return null;
  const n = Number(amount.value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Discover trackable ATP/WTA singles matches with an active moneyline market:
 * both currently in-play matches AND matches starting soon (so the pre-match
 * strategy can enter ahead of time). Uses the start-time window to drop the
 * gateway's stale "live" flags on long-finished matches.
 */
export async function discoverTrackableMatches(tags: string[]): Promise<LiveTennisMatch[]> {
  const matches: LiveTennisMatch[] = [];
  const now = Date.now();
  const startMin = new Date(now - LIVE_LOOKBACK_MS).toISOString();
  const startMax = new Date(now + UPCOMING_WINDOW_MS).toISOString();

  for (const tag of tags) {
    const res = await client.get<RawEventsResponse>("/v1/events", {
      query: {
        tagSlug: tag,
        closed: false,
        startTimeMin: startMin,
        startTimeMax: startMax,
        limit: 50,
      },
    });

    for (const event of res.events ?? []) {
      if (event.closed) continue;
      if (event.period === "FT") continue; // finished

      const market = (event.markets ?? []).find((m) => m.marketType === "moneyline");
      if (!market || market.closed) continue;

      const sides = market.marketSides ?? [];
      const longSide = sides.find((s) => s.long);
      const shortSide = sides.find((s) => !s.long);
      if (!longSide || !shortSide) continue;

      matches.push({
        eventSlug: event.slug,
        marketSlug: market.slug,
        label: `${longSide.description} vs ${shortSide.description}`,
        longName: longSide.description,
        shortName: shortSide.description,
        completedSets: completedSetsFromPeriod(event.period, event.score),
      });
    }
  }

  return matches;
}

/** Live best-bid/offer snapshot for a single market. */
export async function getPriceReading(marketSlug: string): Promise<PriceReading> {
  const res = await client.get<RawBboResponse>(`/v1/markets/${marketSlug}/bbo`);
  const md = res.marketData;
  return {
    longPrice: toNumber(md?.currentPx),
    longBid: toNumber(md?.bestBid),
    longAsk: toNumber(md?.bestAsk),
    looksResolved: !md?.bestBid && !md?.bestAsk,
  };
}

/** Parse Polymarket's tennis `period` field into a count of completed sets. */
function completedSetsFromPeriod(period: string | null | undefined, score?: string | null): number {
  if (!period) return 0;
  const p = period.toUpperCase();
  if (p === "NS") return 0; // not started
  if (p === "FT") {
    // Finished — count completed sets from the score string ("6-2, 6-3" => 2).
    return score ? score.split(",").filter((s) => s.trim().length > 0).length : 0;
  }
  const m = p.match(/^S(\d+)$/); // S1 => set 1 in progress => 0 completed
  if (m) return Math.max(0, parseInt(m[1], 10) - 1);
  return 0;
}

/**
 * Parse a score string like "4-6, 7-6(7-5), 7-5, 6-2" or "6-2:30-15" into
 * per-set games (long-player-first). Strips tiebreak "(7-5)" and current-game
 * point suffixes ":30-15". Returns one SetScore per comma-separated set.
 */
function parseScoreSets(score: string | null | undefined): SetScore[] {
  if (!score) return [];
  const out: SetScore[] = [];
  for (const raw of score.split(",")) {
    const cleaned = raw.trim().split(":")[0].replace(/\([^)]*\)/g, "").trim();
    const m = cleaned.match(/^(\d+)\s*-\s*(\d+)$/);
    if (!m) continue;
    out.push({ long: parseInt(m[1], 10), short: parseInt(m[2], 10) });
  }
  return out;
}

/** Live match state (set progress + parsed score) for entry gating. */
export async function getMatchState(eventSlug: string): Promise<MatchState> {
  const res = await client.get<{ event: RawEvent & { score?: string } }>(
    `/v1/events/slug/${eventSlug}`
  );
  const e = res.event;
  const completedSets = completedSetsFromPeriod(e?.period, e?.score);
  const allSets = parseScoreSets(e?.score);
  return {
    period: e?.period ?? null,
    completedSets,
    completedSetScores: allSets.slice(0, completedSets),
    currentSet: allSets[completedSets] ?? null,
    closed: Boolean(e?.closed),
    live: Boolean(e?.live),
  };
}

/** Whether the underlying market has actually closed (authoritative, unlike looksResolved). */
export async function isMarketClosed(marketSlug: string): Promise<boolean> {
  const res = await client.get<RawMarketResponse>(`/v1/market/slug/${marketSlug}`);
  return Boolean(res.market?.closed);
}

/** Final settlement price (1 or 0) for the market's long side. Only call after isMarketClosed. */
export async function getSettlement(marketSlug: string): Promise<number | null> {
  try {
    const res = await client.get<RawSettlementResponse>(`/v1/markets/${marketSlug}/settlement`);
    return typeof res.settlement === "number" ? res.settlement : null;
  } catch {
    return null;
  }
}
