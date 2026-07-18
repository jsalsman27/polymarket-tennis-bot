/**
 * Tunable strategy constants for the tennis swing bot (v1, paper trading only).
 * Adjust these after reviewing simulated results — core logic should not need to change.
 */
export const STRATEGY_CONFIG = {
  // Entry: buy the pre-match favorite when its price drops into this zone
  // (proxy signal for "favorite lost set 1").
  ENTRY_ZONE: { min: 0.28, max: 0.35 },

  // Exit - take profit: sell when price recovers into this zone.
  TAKE_PROFIT_ZONE: { min: 0.48, max: 0.52 },

  // Exit - stop loss: sell if price falls into this zone.
  STOP_LOSS_ZONE: { min: 0.15, max: 0.18 },

  // Only consider a market a candidate favorite-to-track if its opening
  // (first-observed) price is above this threshold.
  FAVORITE_MIN_OPENING_PRICE: 0.5,

  // Flat stake per simulated trade (USD).
  STAKE_USD: 2,

  // Max number of matches tracked concurrently.
  MAX_CONCURRENT_MATCHES: 4,

  // How often the cron job polls (informational; actual schedule lives in vercel.json).
  POLL_INTERVAL_MINUTES: 5,
} as const;
