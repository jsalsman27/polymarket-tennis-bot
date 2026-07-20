import { STRATEGY_CONFIG, FRICTION, type StrategyConfig, type StrategyName } from "./config";

export type Side = "long" | "short";

/** Price of a given market side, from the market's raw long-side price. */
export function sidePrice(longPrice: number, side: Side): number {
  return side === "long" ? longPrice : 1 - longPrice;
}

/**
 * Executable BUY price for a side, given the long side's bid/ask.
 * Buying long pays the long ask; buying short pays (1 - long bid).
 * Falls back to the mid price if the book side is missing (thin market).
 */
export function buyFill(
  side: Side,
  mid: number,
  longBid: number | null,
  longAsk: number | null
): number {
  if (!FRICTION.applySpread) return mid;
  if (side === "long") return longAsk ?? mid;
  return longBid !== null ? 1 - longBid : mid;
}

/**
 * Executable SELL price for a side. Selling long receives the long bid;
 * selling short receives (1 - long ask). Falls back to mid if missing.
 */
export function sellFill(
  side: Side,
  mid: number,
  longBid: number | null,
  longAsk: number | null
): number {
  if (!FRICTION.applySpread) return mid;
  if (side === "long") return longBid ?? mid;
  return longAsk !== null ? 1 - longAsk : mid;
}

/** Polymarket taker fee for a fill: Fee = coeff × contracts × p × (1 - p). */
export function takerFee(shares: number, fillPrice: number): number {
  if (!FRICTION.applyFees) return 0;
  const p = Math.min(Math.max(fillPrice, 0), 1);
  const fee = FRICTION.takerFeeCoeff * shares * p * (1 - p);
  return Math.round(fee * 100) / 100; // round to the cent
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

export interface ScoreContext {
  /**
   * If the tracked side LOST set 1, how many games they won in it (0-6);
   * null if they didn't lose set 1, or the score is unknown.
   */
  gamesInLostSet1: number | null;
}

/** Should we open a simulated position now, given the tracked side's prices? */
export function decideEntry(
  cfg: StrategyConfig,
  currentPrice: number,
  openingPrice: number,
  completedSets: number,
  score?: ScoreContext
): EntryDecision {
  // Set-state gate: min (real-signal) and optional max (pre-match only).
  if (completedSets < cfg.minCompletedSets) return { action: "wait" };
  if (cfg.maxCompletedSets !== undefined && completedSets > cfg.maxCompletedSets) {
    return { action: "wait" };
  }
  if (currentPrice < cfg.entryMin || currentPrice > cfg.entryMax) {
    return { action: "wait" };
  }
  const move = cfg.minMovePct ?? 0;
  if (cfg.entryDirection === "dip") {
    if (!(currentPrice <= openingPrice * (1 - move))) return { action: "wait" };
  }
  if (cfg.entryDirection === "rise") {
    if (!(currentPrice >= openingPrice * (1 + move))) return { action: "wait" };
  }
  // Recoverability gate: only fade a favorite who lost set 1 competitively.
  if (cfg.requireRecoverableSet1) {
    const g = score?.gamesInLostSet1;
    if (g === null || g === undefined) return { action: "wait" };
    if (g < (cfg.minGamesInLostSet ?? 4)) return { action: "wait" };
  }
  return { action: "enter" };
}

export type ExitDecision =
  | { action: "take_profit" }
  | { action: "stop_loss" }
  | { action: "trail_stop" }
  | { action: "hold" };

/**
 * Exit decision, honoring the strategy's exit style:
 *  - "relative": fixed take-profit / stop-loss vs. entry.
 *  - "trailing": sell once price slips trailPct below its peak since entry
 *    (ride momentum, exit on stall/drop). `peakPrice` is the high-water mark.
 */
export function decideExit(
  cfg: StrategyConfig,
  currentPrice: number,
  entryPrice: number,
  peakPrice: number
): ExitDecision {
  if (cfg.exitStyle === "trailing") {
    const trail = cfg.trailPct ?? 0.15;
    if (currentPrice <= peakPrice * (1 - trail)) {
      return { action: "trail_stop" };
    }
    return { action: "hold" };
  }

  // relative
  const tp = cfg.takeProfitPct ?? Infinity;
  const sl = cfg.stopLossPct ?? Infinity;
  if (currentPrice >= entryPrice * (1 + tp)) return { action: "take_profit" };
  if (currentPrice <= entryPrice * (1 - sl)) return { action: "stop_loss" };
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
