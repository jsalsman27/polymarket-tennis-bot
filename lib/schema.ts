import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";

export const trackedMatches = sqliteTable("tracked_matches", {
  id: text("id").primaryKey(),
  eventSlug: text("event_slug").notNull(),
  marketSlug: text("market_slug").notNull(),
  label: text("label").notNull(),
  openingPrice: real("opening_price").notNull(),
  favoriteSide: text("favorite_side", { enum: ["long", "short"] }).notNull(),
  favoriteName: text("favorite_name").notNull(),
  status: text("status", {
    enum: ["watching", "entered", "exited", "resolved", "abandoned"],
  })
    .notNull()
    .default("watching"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const trades = sqliteTable("trades", {
  id: text("id").primaryKey(),
  matchId: text("match_id")
    .notNull()
    .references(() => trackedMatches.id),
  eventSlug: text("event_slug").notNull(),
  marketSlug: text("market_slug").notNull(),
  label: text("label").notNull(),
  entryPrice: real("entry_price").notNull(),
  entryAt: integer("entry_at").notNull(),
  exitPrice: real("exit_price"),
  exitAt: integer("exit_at"),
  exitReason: text("exit_reason", {
    enum: ["take_profit", "stop_loss", "resolution_win", "resolution_loss"],
  }),
  stake: real("stake").notNull(),
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
