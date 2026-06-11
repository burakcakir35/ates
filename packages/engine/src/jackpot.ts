import { ChainId } from './chains';
import { stripPrefix } from './txid';

export interface JackpotConfig {
  /** Fraction of every bet that flows to the progressive pools. */
  contributionRate: number;
  /** Split of the contribution that goes to Major (rest goes to Grand). */
  majorShare: number;
  /**
   * Bootstrap value the Grand pool starts at. NOTE: pools are NOT reset to a
   * seed after a payout — they drop to 0 and refill only from contributions, so
   * the house never mints jackpot money. A non-zero seed is a one-time operator
   * bootstrap only (kept at 0 by default to make "house never mints" airtight).
   */
  grandSeed: number;
  /** One-time bootstrap value for the Major pool (see grandSeed). */
  majorSeed: number;
  /** Target Mini payout as a multiple of the bet (capped at the pool balance). */
  miniMultiplier: number;
  /** Target Minor payout as a multiple of the bet (capped at the pool balance). */
  minorMultiplier: number;
  /** Streak length that triggers the Grand jackpot. */
  grandStreak: number;
  /** Number of trailing identical characters that also triggers Grand. */
  grandTailLength: number;
}

export const DEFAULT_JACKPOT_CONFIG: JackpotConfig = {
  contributionRate: 0.04,
  majorShare: 0.4,
  // Pools start empty and are funded purely by player contributions; the house
  // never pre-funds or reseeds them. This guarantees that cumulative jackpot
  // payouts can never exceed cumulative contributions (< the house edge).
  grandSeed: 0,
  majorSeed: 0,
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

export interface PoolDraw {
  /** Amount actually paid out (never more than the pool held). */
  paid: number;
  /** Remaining pool balance after the draw (never negative). */
  remaining: number;
  /** True if the request was clipped because the pool was short. */
  capped: boolean;
}

/**
 * Draw up to `requested` from a pool balance. The pool is the only funding
 * source for jackpots, so a payout can never exceed what the pool holds: the
 * house never mints money and the pool never goes negative.
 */
export function drawFromPool(available: number, requested: number): PoolDraw {
  const pool = Math.max(0, available);
  const want = Math.max(0, requested);
  const paid = Math.min(want, pool);
  return { paid, remaining: pool - paid, capped: paid < want };
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

export type AwardTier = JackpotTier | 'GRAND_TAIL';

/** One player's result for a round, used to resolve jackpots (USD). */
export interface PlayerRoundOutcome {
  playerId: string;
  /** Total USD this player staked across all their bets this round. */
  stakeUsd: number;
  /** Whether the player won at least one bet (extends their streak). */
  won: boolean;
}

export interface JackpotAwardUsd {
  playerId: string;
  tier: AwardTier;
  amountUsd: number;
}

export interface JackpotResolution {
  awards: JackpotAwardUsd[];
  /** Total USD paid out from the pools this round. */
  paidUsd: number;
  /** How many awards were clipped because their pool was short. */
  cappedCount: number;
}

/**
 * Resolve jackpot tiers for a round in USD. This is the single source of truth
 * for jackpot economics and is intentionally pure (mutates only the passed-in
 * `pools` and `streaks`) so it can be Monte-Carlo tested.
 *
 * Every tier — MINI/MINOR included — is paid strictly from the progressive
 * pools, capped at the pool balance. The house never mints jackpot money, so
 * cumulative payouts can never exceed cumulative contributions, which are a
 * fraction (contributionRate) of stakes below the house edge. No player
 * strategy can therefore drive the house negative.
 */
export function resolveJackpots(
  pools: JackpotPools,
  streaks: Map<string, number>,
  outcomes: PlayerRoundOutcome[],
  hasTail: boolean,
  config: JackpotConfig,
): JackpotResolution {
  const awards: JackpotAwardUsd[] = [];
  let paidUsd = 0;
  let cappedCount = 0;

  const pay = (
    playerId: string,
    tier: AwardTier,
    pool: 'major' | 'grand',
    requestedUsd: number,
  ): void => {
    const draw = drawFromPool(pools[pool], requestedUsd);
    pools[pool] = draw.remaining;
    if (draw.capped) {
      cappedCount += 1;
    }
    if (draw.paid > 0) {
      paidUsd += draw.paid;
      awards.push({ playerId, tier, amountUsd: draw.paid });
    }
  };

  for (const o of outcomes) {
    const streak = (streaks.get(o.playerId) ?? 0) + (o.won ? 1 : 0);
    if (!o.won) {
      streaks.set(o.playerId, 0);
      continue;
    }
    streaks.set(o.playerId, streak);

    if (streak === 3) {
      pay(o.playerId, 'MINI', 'major', o.stakeUsd * config.miniMultiplier);
    } else if (streak === 5) {
      pay(o.playerId, 'MINOR', 'major', o.stakeUsd * config.minorMultiplier);
    } else if (streak === config.grandStreak - 1) {
      pay(o.playerId, 'MAJOR', 'major', pools.major);
    } else if (streak >= config.grandStreak) {
      pay(o.playerId, 'GRAND', 'grand', pools.grand);
      streaks.set(o.playerId, 0);
    }
  }

  if (hasTail) {
    const winners = outcomes.filter((o) => o.won);
    if (winners.length > 0) {
      const shareUsd = pools.grand / winners.length;
      for (const o of winners) {
        pay(o.playerId, 'GRAND_TAIL', 'grand', shareUsd);
      }
    }
  }

  return { awards, paidUsd, cappedCount };
}
