import { ChainId } from './chains';
import { stripPrefix } from './txid';

export interface JackpotConfig {
  /** Fraction of every bet that flows to the progressive pools. */
  contributionRate: number;
  /** Split of the contribution that goes to Major (rest goes to Grand). */
  majorShare: number;
  /** Seed (reset) value the Grand pool returns to after it drops. */
  grandSeed: number;
  /** Seed value for the Major pool. */
  majorSeed: number;
  /** Fixed Mini payout, as a multiple of the bet. */
  miniMultiplier: number;
  /** Fixed Minor payout, as a multiple of the bet. */
  minorMultiplier: number;
  /** Streak length that triggers the Grand jackpot. */
  grandStreak: number;
  /** Number of trailing identical characters that also triggers Grand. */
  grandTailLength: number;
}

export const DEFAULT_JACKPOT_CONFIG: JackpotConfig = {
  contributionRate: 0.04,
  majorShare: 0.4,
  grandSeed: 1000,
  majorSeed: 250,
  miniMultiplier: 10,
  minorMultiplier: 20,
  grandStreak: 7,
  grandTailLength: 5,
};

export interface JackpotPools {
  major: number;
  grand: number;
}

export function initJackpot(config: JackpotConfig): JackpotPools {
  return { major: config.majorSeed, grand: config.grandSeed };
}

/** Add a bet's contribution to the progressive pools (mutates and returns). */
export function contribute(
  pools: JackpotPools,
  betAmount: number,
  config: JackpotConfig,
): JackpotPools {
  const total = betAmount * config.contributionRate;
  pools.major += total * config.majorShare;
  pools.grand += total * (1 - config.majorShare);
  return pools;
}

/** True if the winning txid's last N characters are all identical. */
export function hasIdenticalTail(
  chain: ChainId,
  winningTxid: string,
  tailLength: number,
): boolean {
  const bare = stripPrefix(chain, winningTxid);
  if (bare.length < tailLength) {
    return false;
  }
  const tail = bare.slice(-tailLength);
  return [...tail].every((c) => c === tail[0]);
}

export type JackpotTier = 'NONE' | 'MINI' | 'MINOR' | 'MAJOR' | 'GRAND';

/**
 * Map a player's current win streak to a jackpot tier. Each step in the streak
 * is an easy (~40-50%) prediction, so reaching 7 is rare but achievable.
 */
export function tierForStreak(streak: number, config: JackpotConfig): JackpotTier {
  if (streak >= config.grandStreak) {
    return 'GRAND';
  }
  if (streak >= config.grandStreak - 1) {
    return 'MAJOR';
  }
  if (streak >= 5) {
    return 'MINOR';
  }
  if (streak >= 3) {
    return 'MINI';
  }
  return 'NONE';
}
