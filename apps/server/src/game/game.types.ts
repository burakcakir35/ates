import {
  BeaconHashes,
  BetSelection,
  BetTypeId,
  ChainId,
  PlacedBet,
} from '@ates/engine';
import { Currency, RoundPhase } from '../config';

export interface WalletTx {
  id: string;
  type: 'deposit' | 'withdraw';
  coin: string;
  coinAmount: number;
  /** Rate used: 1 coin = X fiat (audit trail). */
  rate: number;
  fiatAmount: number;
  currency: Currency;
  at: number;
}

export interface Player {
  id: string;
  name: string;
  currency: Currency;
  balance: number;
  /** Consecutive rounds with at least one winning bet. */
  streak: number;
  /** Deposit/withdraw audit trail (mock conversions). */
  transactions: WalletTx[];
}

export interface ActiveBet extends PlacedBet {
  betType: BetTypeId;
  /** Stake normalized to USD for risk/exposure and pool accounting. */
  amountUsd: number;
}

export interface Round {
  id: string;
  index: number;
  phase: RoundPhase;
  /** The round's 20-coin pool, fixed at commit time. */
  coinPool: ChainId[];
  /** Winning coin, drawn from the pool after the beacon is captured. */
  winningChain?: ChainId;
  serverSeed: string;
  commitHash: string;
  beacon?: BeaconHashes;
  resultHash?: string;
  winningTxid?: string;
  bets: ActiveBet[];
  /** Epoch ms when the current phase ends. */
  phaseEndsAt: number;
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
  beacon: BeaconHashes;
  totalStaked: number;
  totalPaidOut: number;
  housePnl: number;
  awards: JackpotAward[];
  settledAt: number;
}

export interface PlaceBetInput {
  playerId: string;
  type: BetTypeId;
  selection: BetSelection;
  amount: number;
}

export interface PublicRoundState {
  roundId: string;
  index: number;
  phase: RoundPhase;
  coinPool: { id: ChainId; name: string }[];
  /** Null while betting: the winner is only drawn after the beacon lock. */
  winningChain: ChainId | null;
  commitHash: string;
  phaseEndsAt: number;
  totalStaked: number;
  betCount: number;
  jackpot: { major: number; grand: number };
  /** Per bet type: min/max payout multiplier across this round's pool. */
  multiplierRanges: Record<string, { min: number; max: number }>;
}
