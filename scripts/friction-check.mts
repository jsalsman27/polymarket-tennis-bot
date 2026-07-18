/**
 * Sanity check for the friction math (spread fills + taker fees + net P/L).
 * Run: npx tsx scripts/friction-check.mts
 */
import { buyFill, sellFill, takerFee, computePnl } from "../lib/strategy";
import { STRATEGY_CONFIG } from "../lib/config";

const stake = STRATEGY_CONFIG.STAKE_USD;

// Scenario: underdog_momentum on the SHORT side.
// Favorite (long) currently mid 0.60, book 0.59 / 0.61 -> underdog mid = 0.40.
const side = "short" as const;
const longMid = 0.6;
const longBid = 0.59;
const longAsk = 0.61;
const underdogMid = 1 - longMid; // 0.40

const entryFill = buyFill(side, underdogMid, longBid, longAsk); // 1 - 0.59 = 0.41
const shares = stake / entryFill;
const entryFee = takerFee(shares, entryFill);

// Underdog rises; favorite (long) now 0.44 / 0.46 -> underdog mid ~0.55.
const longBid2 = 0.44;
const longAsk2 = 0.46;
const exitMid = 1 - 0.45; // ~0.55
const exitFill = sellFill(side, exitMid, longBid2, longAsk2); // 1 - 0.46 = 0.54
const exitFee = takerFee(shares, exitFill);

const gross = computePnl(entryFill, exitFill, stake);
const net = gross - entryFee - exitFee;

console.log("stake                :", stake);
console.log("underdog mid (buy)   :", underdogMid, " -> entry fill (ask):", entryFill.toFixed(4));
console.log("shares               :", shares.toFixed(3));
console.log("entry fee            :", entryFee.toFixed(4));
console.log("underdog mid (sell)  :", exitMid, " -> exit fill (bid):", exitFill.toFixed(4));
console.log("exit fee             :", exitFee.toFixed(4));
console.log("gross P/L            :", gross.toFixed(4));
console.log("NET P/L (after fric) :", net.toFixed(4), `(${((net / stake) * 100).toFixed(1)}% of stake)`);

// Compare: same move with NO friction (fill at mid, no fees) to show the drag.
const gEntry = underdogMid;
const gShares = stake / gEntry;
const gExit = exitMid;
const grossNoFric = gShares * (gExit - gEntry);
console.log("\nfrictionless P/L     :", grossNoFric.toFixed(4), `(${((grossNoFric / stake) * 100).toFixed(1)}% of stake)`);
console.log("friction drag        :", (grossNoFric - net).toFixed(4));
