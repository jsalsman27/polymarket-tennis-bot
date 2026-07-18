import { STRATEGY_CONFIG } from "./config";
import type { FavoriteSide } from "./polymarket";

function inZone(price: number, zone: { min: number; max: number }): boolean {
  return price >= zone.min && price <= zone.max;
}

/**
 * Decide which side is the pre-match favorite from the first observed price.
 * Returns null if there's no clear favorite (price too close to 0.50) —
 * such matches are skipped rather than guessed at.
 */
export function determineFavoriteSide(openingLongPrice: number): FavoriteSide | null {
  if (openingLongPrice > STRATEGY_CONFIG.FAVORITE_MIN_OPENING_PRICE) return "long";
  if (1 - openingLongPrice > STRATEGY_CONFIG.FAVORITE_MIN_OPENING_PRICE) return "short";
  return null;
}

export type EntryDecision = { action: "enter" } | { action: "wait" };

/** For a match still being watched (no position yet). */
export function decideEntry(favoritePrice: number): EntryDecision {
  if (inZone(favoritePrice, STRATEGY_CONFIG.ENTRY_ZONE)) {
    return { action: "enter" };
  }
  return { action: "wait" };
}

export type ExitDecision =
  | { action: "take_profit" }
  | { action: "stop_loss" }
  | { action: "hold" };

/** For a match with an open simulated position. */
export function decideExit(favoritePrice: number): ExitDecision {
  if (inZone(favoritePrice, STRATEGY_CONFIG.TAKE_PROFIT_ZONE)) {
    return { action: "take_profit" };
  }
  if (inZone(favoritePrice, STRATEGY_CONFIG.STOP_LOSS_ZONE)) {
    return { action: "stop_loss" };
  }
  return { action: "hold" };
}

/** P/L for a simulated long position sized in flat USD stake, entry/exit both in [0,1]. */
export function computePnl(entryPrice: number, exitPrice: number, stakeUsd: number): number {
  const shares = stakeUsd / entryPrice;
  return shares * (exitPrice - entryPrice);
}
