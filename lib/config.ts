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

export type StrategyName =
  | "back_favorite"
  | "back_favorite_hold"
  | "favorite_dip"
  | "underdog_momentum"
  | "underdog_pre_match";

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
  /**
   * Optional minimum move size (fraction of opening) the dip/rise must clear —
   * filters tiny noise wiggles so entries require a MEANINGFUL move. e.g. 0.10
   * on a rise means current must be >= opening × 1.10.
   */
  minMovePct?: number;
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
  /**
   * Recoverability gate (favorite mean-reversion). If true, only enter when the
   * tracked side actually LOST set 1 but competitively — won at least
   * `minGamesInLostSet` games in it. Fades panic on a close set (recoverable),
   * skips genuine blowouts (0-6/1-6, where the low price is correct).
   */
  requireRecoverableSet1?: boolean;
  minGamesInLostSet?: number;
  /**
   * If true, only enter when the tracked (favorite) side is LEADING on sets —
   * has won more completed sets than the opponent. Backs a favorite who's
   * already ahead / closing the match out (much higher, steadier win prob),
   * which is the user's real edge and far less prone to catastrophic gaps.
   */
  requireLeadingOnSets?: boolean;
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

/**
 * Tours are kept as SEPARATE paper "books" so lower-tier ITF results (thinner,
 * choppier markets) don't muddy the clean main-tour (ATP/WTA) data. Each book
 * has its own bankroll, stake, and concurrency cap, and its own dashboard
 * section. The same three strategies run inside both books.
 */
export type TourName = "main" | "itf";

export interface TourConfig {
  label: string;
  /** Polymarket sport tags that belong to this book. */
  tags: string[];
  /** Flat stake per simulated trade (USD) in this book. */
  stake: number;
  /** Starting paper bankroll (USD); balance = bankroll + net P/L. */
  startingBankroll: number;
  /** Max (match × strategy) positions tracked at once in this book. */
  maxConcurrent: number;
}

export const TOURS = {
  main: {
    label: "Main Tour · ATP + WTA",
    tags: ["atp", "wta"],
    stake: 2,
    startingBankroll: 10,
    maxConcurrent: 18,
  },
  itf: {
    label: "ITF Tour",
    // itfme only — the user's real trades were +$58 on itfme, -$10 on itfwo.
    tags: ["itfme"],
    stake: 2,
    startingBankroll: 10,
    maxConcurrent: 18,
  },
} satisfies Record<TourName, TourConfig>;

export const TOUR_NAMES = Object.keys(TOURS) as TourName[];

/**
 * Max candidate price-probes per tour per poll. ITF has hundreds of (often
 * book-less) markets; without this, discovery could fire hundreds of bbo calls
 * chasing fills and blow Polymarket's 60-req/min limit. Fill resumes next poll.
 */
export const DISCOVERY_PROBE_BUDGET = 22;

export const STRATEGY_CONFIG = {
  // Flat stake fallback (per-tour `stake` overrides this in the engine).
  STAKE_USD: 2,

  // How far ahead to look for not-yet-started matches (for pre-match entries).
  UPCOMING_WINDOW_HOURS: 3,

  // How far back a match's start can be and still be considered live (drops the
  // Polymarket gateway's stale "live" flags on long-finished matches).
  LIVE_LOOKBACK_HOURS: 12,

  POLL_INTERVAL_MINUTES: 5,

  strategies: {
    /**
     * THE strategy — mechanizes the user's real edge (from 256 of their trades:
     * favorites +$240, longshots -$95; their best bands 0.7-0.9 were LEADING
     * favorites) plus their own insight: only back a favorite once they're
     * AHEAD ON SETS (won set 1 / closing the match out). That's a much higher,
     * steadier win prob, exploits favorite-longshot bias at the extreme, and
     * almost never suffers the -97% catastrophe gaps that wreck stops.
     * Exit: hold WINNERS to resolution (they win -> $1.0; no TP set), while a
     * tight -15% stop cuts the ones that turn (backed by the 1-min fast loop).
     */
    back_favorite: {
      enabled: true,
      track: "favorite",
      openingThreshold: 0.55,
      entryMin: 0.6,
      // Cap at 0.88 (fill guard rejects asks above this): above it there's
      // almost no upside left. No TP, so the price nearing 1.0 isn't a problem.
      entryMax: 0.88,
      entryDirection: "none",
      minCompletedSets: 1, // must have a completed set to be "leading"
      requireLeadingOnSets: true, // the key: only back a favorite who's AHEAD
      exitStyle: "relative",
      // No takeProfitPct -> winners ride to resolution (favorite closes it out).
      stopLossPct: 0.15, // cut the ones that turn, small
    },
    /**
     * A/B twin of back_favorite: identical entry (leading favorites), but NO
     * stop-loss — holds every position to resolution. Tests whether the -15%
     * stop is cutting eventual winners (then this beats it) or correctly cutting
     * losers (then back_favorite beats it). Same markets => clean head-to-head.
     */
    back_favorite_hold: {
      enabled: true,
      track: "favorite",
      openingThreshold: 0.55,
      entryMin: 0.6,
      entryMax: 0.88,
      entryDirection: "none",
      minCompletedSets: 1,
      requireLeadingOnSets: true,
      exitStyle: "relative",
      // No takeProfitPct AND no stopLossPct -> pure hold to resolution.
    },
    // --- Disabled: the user's data proved these are net losers. Kept for
    //     reference / possible re-test, but they don't trade. ---
    favorite_dip: {
      enabled: false, // buying the crater (0.2-0.4) LOST in the user's real trades
      track: "favorite",
      // Only STRONG favorites (opened >= 0.68) that CRATERED into 0.20-0.40 —
      // a genuine overreaction to dropping set 1, not a close match.
      openingThreshold: 0.68,
      entryMin: 0.2,
      entryMax: 0.4,
      entryDirection: "dip",
      minCompletedSets: 1,
      // Score gate: favorite must have lost set 1 competitively (>=4 games),
      // i.e. a recoverable 4-6/5-7/6-7 — not a 0-6/1-6 blowout.
      requireRecoverableSet1: true,
      minGamesInLostSet: 4,
      exitStyle: "relative",
      takeProfitPct: 0.35,
      stopLossPct: 0.3,
    },
    underdog_momentum: {
      enabled: false, // buying underdogs was the user's -$95 leak
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
      enabled: false, // buying cheap dogs pre-match was part of the -$95 leak
      track: "underdog",
      openingThreshold: 0.55, // favorite >= 0.55, so underdog <= 0.45
      entryMin: 0.1,
      entryMax: 0.45,
      // Selective now: only buy a cheap underdog that shows EARLY STRENGTH —
      // its price climbing >=10% off where we first saw it, before set 1 ends.
      // (Indiscriminate "buy every dog" (entryDirection none) lost badly: the
      // mechanical version had no edge because most cheap dogs just drift down.)
      entryDirection: "rise",
      minMovePct: 0.1,
      minCompletedSets: 0,
      maxCompletedSets: 0, // still an early/pre-match entry (before set 1 finishes)
      exitStyle: "trailing",
      trailPct: 0.18, // sell once it slips 18% off its highest price since entry
    },
  } satisfies Record<StrategyName, StrategyConfig>,
} as const;

export const STRATEGY_NAMES = Object.keys(STRATEGY_CONFIG.strategies) as StrategyName[];

/** Only the strategies currently turned on — used for the dashboard. */
export const ENABLED_STRATEGY_NAMES = STRATEGY_NAMES.filter(
  (n) => STRATEGY_CONFIG.strategies[n].enabled
);
