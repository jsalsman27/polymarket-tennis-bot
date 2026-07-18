/**
 * Tunable strategy constants for the tennis swing bot (v1, paper trading only).
 *
 * Two strategies run in parallel, every trade tagged with which one made it so
 * the dashboard can compare them:
 *
 *  - favorite_dip:       buy the pre-match favorite after a price DIP
 *                        (mean-reversion — bet the favorite recovers).
 *  - underdog_momentum:  buy a cheap pre-match underdog that is RISING off its
 *                        opening (longshot + momentum), and take profit early.
 *
 * "Wide open, log everything" mode: entries cast a wide net and exits are
 * RELATIVE (% move from entry) rather than fixed price zones, because a fixed
 * target like "sell at 0.50" is meaningless once you enter anywhere from 0.10
 * to 0.55. Relative exits scale across the whole range and match the
 * "lock in profit once it's worth it" mindset.
 *
 * Adjust freely after reviewing results — the engine reads everything from here.
 */

export type StrategyName = "favorite_dip" | "underdog_momentum";

export interface StrategyConfig {
  enabled: boolean;
  /** Which side of the match this strategy trades, by its opening price. */
  track: "favorite" | "underdog";
  /** A side only counts as favorite/underdog if its opening price clears this. */
  openingThreshold: number;
  /** Buy only if the tracked side's current price falls in this (wide) band. */
  entryMin: number;
  entryMax: number;
  /**
   * Directional confirmation vs. the opening price:
   *  - "dip":       enter only if current < opening (favorite has fallen)
   *  - "rise":      enter only if current > opening (underdog has climbed)
   *  - "none":      no directional filter
   */
  entryDirection: "dip" | "rise" | "none";
  /** Take profit once price is up this fraction from entry (0.35 = +35%). */
  takeProfitPct: number;
  /** Stop loss once price is down this fraction from entry (0.30 = -30%). */
  stopLossPct: number;
  /**
   * Require at least this many COMPLETED sets before entering — the real
   * signal. favorite_dip wants set 1 finished (favorite behind); underdog
   * momentum wants the underdog to have actually won a set. Gating on real
   * set state (not just price) filters mid-set noise and avoids buying into a
   * set-1 injury collapse.
   */
  minCompletedSets: number;
}

/**
 * Real-world friction so paper P/L isn't rosy. Both are modeled from live data:
 *  - spread: buy at the ask, sell at the bid (from the bbo endpoint)
 *  - fees:   Polymarket's exact taker formula, Fee = coeff × shares × p × (1-p)
 *
 * No fee/spread is applied to hold-to-resolution exits, because settlement is
 * not a taker trade on Polymarket.
 *
 * Taker (not maker) is assumed on both legs as the conservative case; resting
 * limit orders could instead earn the maker rebate, but assuming taker keeps
 * the simulation honest rather than optimistic.
 */
export const FRICTION = {
  applySpread: true,
  applyFees: true,
  takerFeeCoeff: 0.06,
} as const;

export const STRATEGY_CONFIG = {
  // Flat stake per simulated trade (USD).
  STAKE_USD: 2,

  // Max number of (match × strategy) positions tracked at once. Raised well
  // above the original 3–4 because this is paper trading — no capital limit,
  // and more concurrent tracking means more learning data per day.
  MAX_CONCURRENT: 20,

  // How often the poll runs (informational; real schedule is the GitHub Action).
  POLL_INTERVAL_MINUTES: 5,

  strategies: {
    favorite_dip: {
      enabled: true,
      track: "favorite",
      openingThreshold: 0.55,
      entryMin: 0.12,
      entryMax: 0.45,
      entryDirection: "dip",
      takeProfitPct: 0.35,
      stopLossPct: 0.3,
      minCompletedSets: 1,
    },
    underdog_momentum: {
      enabled: true,
      track: "underdog",
      openingThreshold: 0.55, // favorite side must clear this, so underdog <= 0.45
      entryMin: 0.1,
      entryMax: 0.55,
      entryDirection: "rise",
      takeProfitPct: 0.35,
      stopLossPct: 0.3,
      minCompletedSets: 1,
    },
  } satisfies Record<StrategyName, StrategyConfig>,
} as const;

export const STRATEGY_NAMES = Object.keys(
  STRATEGY_CONFIG.strategies
) as StrategyName[];
