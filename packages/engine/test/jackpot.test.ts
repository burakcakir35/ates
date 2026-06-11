import { describe, it, expect } from 'vitest';
import {
  DEFAULT_JACKPOT_CONFIG,
  contribute,
  hasIdenticalTail,
  initJackpot,
  tierForStreak,
} from '../src/jackpot';
import { settleRound, PlacedBet, maxExposure } from '../src/settlement';

describe('jackpot', () => {
  it('contributes the configured rate split between major and grand', () => {
    const pools = initJackpot(DEFAULT_JACKPOT_CONFIG);
    const before = { ...pools };
    contribute(pools, 100, DEFAULT_JACKPOT_CONFIG);
    // 4% of 100 = 4, split 40/60
    expect(pools.major - before.major).toBeCloseTo(1.6);
    expect(pools.grand - before.grand).toBeCloseTo(2.4);
  });

  it('detects identical trailing characters', () => {
    expect(hasIdenticalTail('BTC', 'a'.repeat(64), 5)).toBe(true);
    expect(hasIdenticalTail('BTC', 'b'.repeat(59) + 'a'.repeat(5), 5)).toBe(true);
    expect(hasIdenticalTail('BTC', 'a'.repeat(59) + 'abcde', 5)).toBe(false);
  });

  it('maps streaks to tiers', () => {
    expect(tierForStreak(2, DEFAULT_JACKPOT_CONFIG)).toBe('NONE');
    expect(tierForStreak(3, DEFAULT_JACKPOT_CONFIG)).toBe('MINI');
    expect(tierForStreak(5, DEFAULT_JACKPOT_CONFIG)).toBe('MINOR');
    expect(tierForStreak(6, DEFAULT_JACKPOT_CONFIG)).toBe('MAJOR');
    expect(tierForStreak(7, DEFAULT_JACKPOT_CONFIG)).toBe('GRAND');
  });
});

describe('settlement helpers', () => {
  it('maxExposure sums potential payouts', () => {
    const bets: PlacedBet[] = [
      { id: '1', playerId: 'a', type: 'LAST_CHAR_DIGIT', selection: {}, amount: 10 },
      { id: '2', playerId: 'b', type: 'EXACT_LAST_CHAR', selection: { char: 'a' }, amount: 1 },
    ];
    const exposure = maxExposure(bets, 'BTC', 0.06);
    expect(exposure).toBeGreaterThan(0);
  });

  it('settleRound pays winners and zeroes losers', () => {
    const txid = '0'.repeat(63) + '5'; // last char digit
    const bets: PlacedBet[] = [
      { id: '1', playerId: 'a', type: 'LAST_CHAR_DIGIT', selection: {}, amount: 10 },
      { id: '2', playerId: 'b', type: 'LAST_CHAR_LETTER', selection: {}, amount: 10 },
    ];
    const s = settleRound(bets, 'BTC', txid, 0.06);
    const winner = s.results.find((r) => r.betId === '1');
    const loser = s.results.find((r) => r.betId === '2');
    expect(winner?.won).toBe(true);
    expect(winner?.payout).toBeGreaterThan(10);
    expect(loser?.won).toBe(false);
    expect(loser?.payout).toBe(0);
  });
});
