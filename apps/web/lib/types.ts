export type ChainId = 'BTC' | 'ETH' | 'TRX' | 'SOL';
export type RoundPhase = 'betting' | 'locking' | 'result';

export interface PublicRoundState {
  roundId: string;
  index: number;
  phase: RoundPhase;
  winningChain: ChainId;
  commitHash: string;
  phaseEndsAt: number;
  totalStaked: number;
  betCount: number;
  jackpot: { major: number; grand: number };
}

export interface PlayerInfo {
  id: string;
  name: string;
  currency: string;
  balance: number;
  streak: number;
}

export interface BetResult {
  betId: string;
  playerId: string;
  won: boolean;
  multiplier: number;
  payout: number;
}

export interface JackpotAward {
  playerId: string;
  tier: string;
  amount: number;
}

export interface SettledRound {
  roundId: string;
  index: number;
  winningChain: ChainId;
  winningTxid: string;
  serverSeed: string;
  commitHash: string;
  resultHash: string;
  totalStaked: number;
  totalPaidOut: number;
  housePnl: number;
  awards: JackpotAward[];
  settledAt: number;
}

export interface BetCatalogueItem {
  type: string;
  multipliers: Record<ChainId, number>;
}

export const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:4000';
