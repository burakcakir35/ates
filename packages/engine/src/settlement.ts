import { ChainId } from './chains';
import {
  BetSelection,
  BetTypeId,
  evaluateBet,
  payoutMultiplier,
} from './bets';

export interface PlacedBet {
  id: string;
  playerId: string;
  type: BetTypeId;
  selection: BetSelection;
  amount: number;
}

export interface BetResult {
  betId: string;
  playerId: string;
  won: boolean;
  multiplier: number;
  /** Total returned to the player (stake * multiplier when won, else 0). */
  payout: number;
}

export interface RoundSettlement {
  winningChain: ChainId;
  winningTxid: string;
  results: BetResult[];
  totalStaked: number;
  totalPaidOut: number;
  /** Operator profit/loss for the round (positive = house wins). */
  housePnl: number;
}

/**
 * Settle every bet in a shared round against the single winning txid.
 * Pure function: no side effects, fully deterministic.
 */
export function settleRound(
  bets: PlacedBet[],
  winningChain: ChainId,
  winningTxid: string,
  houseEdge = 0.06,
): RoundSettlement {
  const results: BetResult[] = [];
  let totalStaked = 0;
  let totalPaidOut = 0;

  for (const bet of bets) {
    const won = evaluateBet(bet.type, winningChain, bet.selection, winningTxid);
    const multiplier = won
      ? payoutMultiplier(bet.type, winningChain, bet.selection, houseEdge)
      : 0;
    const payout = won ? Math.round(bet.amount * multiplier * 100) / 100 : 0;
    totalStaked += bet.amount;
    totalPaidOut += payout;
    results.push({
      betId: bet.id,
      playerId: bet.playerId,
      won,
      multiplier,
      payout,
    });
  }

  return {
    winningChain,
    winningTxid,
    results,
    totalStaked: Math.round(totalStaked * 100) / 100,
    totalPaidOut: Math.round(totalPaidOut * 100) / 100,
    housePnl: Math.round((totalStaked - totalPaidOut) * 100) / 100,
  };
}

/**
 * Maximum the house could pay out for a set of pending bets, used by the risk
 * engine to cap exposure before a round locks.
 */
export function maxExposure(
  bets: PlacedBet[],
  winningChain: ChainId,
  houseEdge = 0.06,
): number {
  let max = 0;
  for (const bet of bets) {
    const m = payoutMultiplier(bet.type, winningChain, bet.selection, houseEdge);
    max += bet.amount * m;
  }
  return Math.round(max * 100) / 100;
}
