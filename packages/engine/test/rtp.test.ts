import { describe, it, expect } from 'vitest';
import { generateTxid } from '../src/txid';
import { settleRound, PlacedBet } from '../src/settlement';
import { betProbability, payoutMultiplier } from '../src/bets';

/**
 * Monte-Carlo fairness check: the realised RTP of a bet over many rounds must
 * converge to (probability * payoutMultiplier), i.e. ~94% with a 6% edge.
 */
describe('RTP simulation', () => {
  it('LAST_CHAR_DIGIT on BTC converges to ~93.75% RTP', () => {
    const N = 40000;
    let staked = 0;
    let paid = 0;
    for (let i = 0; i < N; i += 1) {
      const txid = generateTxid('BTC', `rtp-${i}`);
      const bets: PlacedBet[] = [
        { id: `b${i}`, playerId: 'p', type: 'LAST_CHAR_DIGIT', selection: {}, amount: 1 },
      ];
      const s = settleRound(bets, 'BTC', txid, 0.06);
      staked += s.totalStaked;
      paid += s.totalPaidOut;
    }
    const rtp = paid / staked;
    const expected =
      betProbability('LAST_CHAR_DIGIT', 'BTC', {}) *
      payoutMultiplier('LAST_CHAR_DIGIT', 'BTC', {}, 0.06);
    expect(rtp).toBeGreaterThan(expected - 0.03);
    expect(rtp).toBeLessThan(expected + 0.03);
  });

  it('empirical last-char-digit frequency matches 10/16 for hex', () => {
    const N = 40000;
    let digits = 0;
    for (let i = 0; i < N; i += 1) {
      const txid = generateTxid('ETH', `freq-${i}`);
      const last = txid[txid.length - 1];
      if (/[0-9]/.test(last)) {
        digits += 1;
      }
    }
    expect(digits / N).toBeGreaterThan(10 / 16 - 0.03);
    expect(digits / N).toBeLessThan(10 / 16 + 0.03);
  });
});
