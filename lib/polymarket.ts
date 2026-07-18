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

const client = new PolymarketUS();

// Tennis tours to watch. ITF tour tags (itfm/itfw) exist too but tend to have
// thin liquidity; start with the two main tours and extend TENNIS_TAGS if needed.
const TENNIS_TAGS = ["atp", "wta"] as const;

// The gateway occasionally leaves `live: true` set on events well after they've
// actually finished (observed empirically). Ignore anything whose reported
// start time is older than this, as a defensive staleness guard.
const STALE_EVENT_MAX_AGE_MS = 8 * 60 * 60 * 1000;

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
}

export interface PriceReading {
  /** Live price of the market's "long" side (i.e. the raw currentPx), or null if unavailable. */
  longPrice: number | null;
  /** True once the order book has emptied out, which happens on/after resolution. */
  looksResolved: boolean;
}

function toNumber(amount: Amount | null | undefined): number | null {
  if (!amount) return null;
  const n = Number(amount.value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Discover currently in-play ATP/WTA singles matches with an active
 * moneyline market. Filters out stale "live" flags left over from finished
 * matches (see STALE_EVENT_MAX_AGE_MS above).
 */
export async function discoverLiveTennisMatches(): Promise<LiveTennisMatch[]> {
  const matches: LiveTennisMatch[] = [];

  for (const tag of TENNIS_TAGS) {
    const res = await client.get<RawEventsResponse>("/v1/events", {
      query: { tagSlug: tag, live: true, closed: false, limit: 25 },
    });

    for (const event of res.events ?? []) {
      if (!event.live || event.closed) continue;
      if (event.period === "FT") continue;

      const startedAt = event.startTime ? new Date(event.startTime).getTime() : 0;
      if (!startedAt || Date.now() - startedAt > STALE_EVENT_MAX_AGE_MS) continue;

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
    looksResolved: !md?.bestBid && !md?.bestAsk,
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
