import { sqliteTable, text, real, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * A tracking unit is one (match × strategy) pair — the same match can be
 * tracked simultaneously by favorite_dip (on the favorite side) and by
 * underdog_momentum (on the underdog side), which are opposite positions.
 */
export const trackedMatches = sqliteTable(
  "tracked_matches",
  {
    id: text("id").primaryKey(),
    tour: text("tour", { enum: ["main", "itf"] }).notNull().default("main"),
    strategy: text("strategy", {
      enum: [
      "back_favorite",
      "back_favorite_hold",
      "favorite_dip",
      "underdog_momentum",
      "underdog_pre_match",
    ],
    }).notNull(),
    eventSlug: text("event_slug").notNull(),
    marketSlug: text("market_slug").notNull(),
    label: text("label").notNull(),
    // Which market side this unit trades, and that side's first-observed price.
    side: text("side", { enum: ["long", "short"] }).notNull(),
    playerName: text("player_name").notNull(),
    openingPrice: real("opening_price").notNull(),
    status: text("status", {
      enum: ["watching", "entered", "exited", "resolved", "abandoned"],
    })
      .notNull()
      .default("watching"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("tracked_market_strategy_idx").on(t.marketSlug, t.strategy)]
);

export const trades = sqliteTable("trades", {
  id: text("id").primaryKey(),
  matchId: text("match_id")
    .notNull()
    .references(() => trackedMatches.id),
  tour: text("tour", { enum: ["main", "itf"] }).notNull().default("main"),
  strategy: text("strategy", {
    enum: [
      "back_favorite",
      "back_favorite_hold",
      "favorite_dip",
      "underdog_momentum",
      "underdog_pre_match",
    ],
  }).notNull(),
  eventSlug: text("event_slug").notNull(),
  marketSlug: text("market_slug").notNull(),
  label: text("label").notNull(),
  playerName: text("player_name").notNull(),
  entryPrice: real("entry_price").notNull(),
  entryAt: integer("entry_at").notNull(),
  /** Highest price of the tracked side seen since entry (for trailing exits). */
  peakPrice: real("peak_price"),
  exitPrice: real("exit_price"),
  exitAt: integer("exit_at"),
  exitReason: text("exit_reason", {
    enum: ["take_profit", "stop_loss", "trail_stop", "resolution_win", "resolution_loss"],
  }),
  stake: real("stake").notNull(),
  /** Total taker fees paid across entry + exit legs (USD). */
  fees: real("fees").notNull().default(0),
  /** Net P/L, after spread (fills at bid/ask) and fees. */
  pnl: real("pnl"),
  tradeDate: text("trade_date").notNull(),
});

export const priceSnapshots = sqliteTable("price_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  matchId: text("match_id")
    .notNull()
    .references(() => trackedMatches.id),
  price: real("price").notNull(),
  observedAt: integer("observed_at").notNull(),
});
