import { STRATEGY_CONFIG, type StrategyConfig, type StrategyName } from "./config";

export type Side = "long" | "short";

/** Price of a given market side, from the market's raw long-side price. */
export function sidePrice(longPrice: number, side: Side): number {
  return side === "long" ? longPrice : 1 - longPrice;
}

/**
 * For a strategy, decide which market side (if any) it should track for this
 * match, based on the two sides' opening prices. Returns null if the match
 * doesn't fit the strategy (e.g. no clear favorite/underdog).
 */
export function sideToTrack(
  cfg: StrategyConfig,
  longOpening: number
): Side | null {
  const shortOpening = 1 - longOpening;
  const favoriteSide: Side = longOpening >= shortOpening ? "long" : "short";
  const favoriteOpening = Math.max(longOpening, shortOpening);

  // Need a clear enough favorite for either strategy to be meaningful.
  if (favoriteOpening < cfg.openingThreshold) return null;

  if (cfg.track === "favorite") return favoriteSide;
  // underdog = the other side
  return favoriteSide === "long" ? "short" : "long";
}

export type EntryDecision = { action: "enter" } | { action: "wait" };

/** Should we open a simulated position now, given the tracked side's prices? */
export function decideEntry(
  cfg: StrategyConfig,
  currentPrice: number,
  openingPrice: number
): EntryDecision {
  if (currentPrice < cfg.entryMin || currentPrice > cfg.entryMax) {
    return { action: "wait" };
  }
  if (cfg.entryDirection === "dip" && !(currentPrice < openingPrice)) {
    return { action: "wait" };
  }
  if (cfg.entryDirection === "rise" && !(currentPrice > openingPrice)) {
    return { action: "wait" };
  }
  return { action: "enter" };
}

export type ExitDecision =
  | { action: "take_profit" }
  | { action: "stop_loss" }
  | { action: "hold" };

/** Relative (% move from entry) take-profit / stop-loss. */
export function decideExit(
  cfg: StrategyConfig,
  currentPrice: number,
  entryPrice: number
): ExitDecision {
  if (currentPrice >= entryPrice * (1 + cfg.takeProfitPct)) {
    return { action: "take_profit" };
  }
  if (currentPrice <= entryPrice * (1 - cfg.stopLossPct)) {
    return { action: "stop_loss" };
  }
  return { action: "hold" };
}

/** P/L for a simulated long position of flat USD stake; prices in [0,1]. */
export function computePnl(entryPrice: number, exitPrice: number, stakeUsd: number): number {
  const shares = stakeUsd / entryPrice;
  return shares * (exitPrice - entryPrice);
}

export function getStrategyConfig(name: StrategyName): StrategyConfig {
  return STRATEGY_CONFIG.strategies[name];
}
