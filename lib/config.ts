/**
 * Tunable strategy constants for the tennis swing bot (v1, paper trading only).
 *
 * Three strategies run in parallel, every trade tagged with which one made it
 * so the dashboard can compare them:
 *
 *  - favorite_dip:       buy the pre-match favorite after a price DIP once a
 *                        set has completed (bet the favorite recovers).
 *  - underdog_momentum:  buy a cheap underdog that has won a set and is RISING
 *                        off its opening (confirmed momentum), take profit early.
 *  - underdog_pre_match: buy a cheap underdog BEFORE/at the start (no signal),
 *                        then ride it with a trailing exit — sell once it slips
 *                        off its peak. Highest variance; the exit is the edge.
 *
 * "Wide open, log everything": entries cast a wide net, every trade is tagged
 * and bucketed by entry price, so the DATA reveals the best rails.
 *
 * Exits are RELATIVE (% from entry) or TRAILING (% off the peak since entry),
 * never fixed price zones — those don't scale across a wide entry range.
 */

export type StrategyName = "favorite_dip" | "underdog_momentum" | "underdog_pre_match";

export interface StrategyConfig {
  enabled: boolean;
  /** Which side of the match this strategy trades, by its opening price. */
  track: "favorite" | "underdog";
  /** A side only counts as favorite/underdog if the favorite's opening clears this. */
  openingThreshold: number;
  /** Buy only if the tracked side's current price falls in this (wide) band. */
  entryMin: number;
  entryMax: number;
  /** Directional confirmation vs. opening: "dip" (fell), "rise" (climbed), "none". */
  entryDirection: "dip" | "rise" | "none";
  /** Require at least this many COMPLETED sets before entering. */
  minCompletedSets: number;
  /** Optional: do NOT enter once more than this many sets have completed. */
  maxCompletedSets?: number;
  /** Exit style: fixed %-from-entry, or trailing %-off-peak. */
  exitStyle: "relative" | "trailing";
  /** Relative exit: take profit once up this fraction from entry. */
  takeProfitPct?: number;
  /** Relative exit: stop loss once down this fraction from entry. */
  stopLossPct?: number;
  /** Trailing exit: sell once price falls this fraction below its peak since entry. */
  trailPct?: number;
}

/**
 * Real-world friction so paper P/L isn't rosy. Both modeled from live data:
 *  - spread: buy at the ask, sell at the bid (from the bbo endpoint)
 *  - fees:   Polymarket's exact taker formula, Fee = coeff × shares × p × (1-p)
 * No fee/spread on hold-to-resolution (settlement isn't a taker trade).
 * Taker assumed on both legs (conservative; resting limits could earn the rebate).
 */
export const FRICTION = {
  applySpread: true,
  applyFees: true,
  takerFeeCoeff: 0.06,
} as const;

export const STRATEGY_CONFIG = {
  // Flat stake per simulated trade (USD).
  STAKE_USD: 2,

  // Max (match × strategy) positions tracked at once. Divided by the 3
  // strategies, this is ~20 distinct matches. Kept within Polymarket's
  // 60-requests/minute limit thanks to per-cycle price/state caching (each
  // match is fetched once per poll and shared across its strategy units).
  MAX_CONCURRENT: 60,

  // How far ahead to look for not-yet-started matches (for pre-match entries).
  UPCOMING_WINDOW_HOURS: 3,

  // How far back a match's start can be and still be considered live (drops the
  // Polymarket gateway's stale "live" flags on long-finished matches).
  LIVE_LOOKBACK_HOURS: 12,

  POLL_INTERVAL_MINUTES: 5,

  strategies: {
    favorite_dip: {
      enabled: true,
      track: "favorite",
      openingThreshold: 0.55,
      entryMin: 0.12,
      entryMax: 0.45,
      entryDirection: "dip",
      minCompletedSets: 1,
      exitStyle: "relative",
      takeProfitPct: 0.35,
      stopLossPct: 0.3,
    },
    underdog_momentum: {
      enabled: true,
      track: "underdog",
      openingThreshold: 0.55,
      entryMin: 0.1,
      entryMax: 0.55,
      entryDirection: "rise",
      minCompletedSets: 1,
      exitStyle: "relative",
      takeProfitPct: 0.35,
      stopLossPct: 0.3,
    },
    underdog_pre_match: {
      enabled: true,
      track: "underdog",
      openingThreshold: 0.55, // favorite >= 0.55, so underdog <= 0.45
      entryMin: 0.1,
      entryMax: 0.45,
      entryDirection: "none", // no signal — this is the pre-match longshot bet
      minCompletedSets: 0,
      maxCompletedSets: 0, // only enter before set 1 finishes (pre-match / early)
      exitStyle: "trailing",
      trailPct: 0.18, // sell once it slips 18% off its highest price since entry
    },
  } satisfies Record<StrategyName, StrategyConfig>,
} as const;

export const STRATEGY_NAMES = Object.keys(STRATEGY_CONFIG.strategies) as StrategyName[];
