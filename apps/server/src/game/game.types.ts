import {
  BeaconHashes,
  BetSelection,
  BetTypeId,
  ChainId,
  PlacedBet,
} from '@ates/engine';
import { Currency, RoundPhase } from '../config';

export interface Player {
  id: string;
  name: string;
  currency: Currency;
  balance: number;
  /** Consecutive rounds with at least one winning bet. */
  streak: number;
}

export interface ActiveBet extends PlacedBet {
  betType: BetTypeId;
}

export interface Round {
  id: string;
  index: number;
  phase: RoundPhase;
  winningChain: ChainId;
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
  winningChain: ChainId;
  commitHash: string;
  phaseEndsAt: number;
  totalStaked: number;
  betCount: number;
  jackpot: { major: number; grand: number };
}
