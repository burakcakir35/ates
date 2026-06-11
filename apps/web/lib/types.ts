export type ChainId = string;
export type RoundPhase = 'betting' | 'locking' | 'result';

export interface PoolCoin {
  id: ChainId;
  name: string;
}

export interface PublicRoundState {
  roundId: string;
  index: number;
  phase: RoundPhase;
  coinPool: PoolCoin[];
  /** Null while betting: the winner is drawn from the pool after the lock. */
  winningChain: ChainId | null;
  commitHash: string;
  phaseEndsAt: number;
  totalStaked: number;
  betCount: number;
  jackpot: { major: number; grand: number };
  multiplierRanges: Record<string, { min: number; max: number }>;
}

export interface PlayerInfo {
  id: string;
  name: string;
  currency: string;
  balance: number;
  streak: number;
}

export interface BetLimits {
  min: number;
  max: number;
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
  coinPool: ChainId[];
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
  multipliers: Record<string, number>;
}

export interface WalletTx {
  id: string;
  type: 'deposit' | 'withdraw';
  coin: string;
  coinAmount: number;
  rate: number;
  fiatAmount: number;
  currency: string;
  at: number;
}

export const CURRENCY_SYMBOL: Record<string, string> = {
  USD: '$',
  EUR: '€',
  TRY: '₺',
  GBP: '£',
};

export const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:4000';
