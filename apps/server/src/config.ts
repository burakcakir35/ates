import { ChainId } from '@ates/engine';

export const GAME_CONFIG = {
  /** Chains the round picker can choose a winning chain from. */
  chains: ['BTC', 'ETH', 'TRX', 'SOL'] as ChainId[],
  /** Betting window in milliseconds (admin-configurable in production). */
  bettingMs: 20000,
  /** "Computing result" suspense window. */
  lockingMs: 3000,
  /** How long the result stays on screen before the next round. */
  resultMs: 6000,
  /** House edge applied to every payout (RTP = 1 - houseEdge). */
  houseEdge: 0.06,
  /** Starting play-money balance for a new player. */
  startingBalance: 1000,
  /** Minimum bet (0.50 USD equivalent in the spec). */
  minBet: 0.5,
  /** Per-player max bet (risk control). */
  maxBet: 500,
  /** Max total payout the house will expose itself to in a single round. */
  maxRoundExposure: 50000,
  /** Supported fiat play-money currencies. */
  currencies: ['USD', 'EUR', 'TRY', 'GBP'] as const,
};

export type Currency = (typeof GAME_CONFIG.currencies)[number];

export type RoundPhase = 'betting' | 'locking' | 'result';
