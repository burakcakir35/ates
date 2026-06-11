import { randomBytes } from 'crypto';
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_JACKPOT_CONFIG,
  JackpotPools,
  contribute,
  drawFromPool,
  hasIdenticalTail,
  initJackpot,
  resolveJackpots,
} from '../src/jackpot';
import { deriveWinningTxid } from '../src/fairness';
import { settleRound, PlacedBet } from '../src/settlement';

describe('drawFromPool', () => {
  it('pays the full request when the pool can cover it', () => {
    const d = drawFromPool(100, 30);
    expect(d).toEqual({ paid: 30, remaining: 70, capped: false });
  });

  it('caps the payout at the pool balance and never goes negative', () => {
    const d = drawFromPool(10, 250);
    expect(d.paid).toBe(10);
    expect(d.remaining).toBe(0);
    expect(d.capped).toBe(true);
  });

  it('pays nothing from an empty pool', () => {
    const d = drawFromPool(0, 50);
    expect(d).toEqual({ paid: 0, remaining: 0, capped: true });
  });
});

describe('resolveJackpots — pool funded, never minted', () => {
  it('caps a MINI payout at the (empty) major pool and pays 0', () => {
    const pools: JackpotPools = { major: 0, grand: 0 };
    const streaks = new Map([['p', 2]]);
    const res = resolveJackpots(
      pools,
      streaks,
      [{ playerId: 'p', stakeUsd: 1, won: true }],
      false,
      DEFAULT_JACKPOT_CONFIG,
    );
    expect(streaks.get('p')).toBe(3); // streak still advanced
    expect(res.paidUsd).toBe(0); // but nothing minted from an empty pool
    expect(res.cappedCount).toBe(1);
    expect(pools.major).toBe(0);
  });

  it('MINI draws from the major pool and leaves it non-negative', () => {
    const pools: JackpotPools = { major: 4, grand: 0 };
    const streaks = new Map([['p', 2]]);
    const res = resolveJackpots(
      pools,
      streaks,
      [{ playerId: 'p', stakeUsd: 1, won: true }], // wants 1*10 = 10
      false,
      DEFAULT_JACKPOT_CONFIG,
    );
    expect(res.paidUsd).toBe(4); // capped at the 4 the pool held
    expect(pools.major).toBe(0);
    expect(res.cappedCount).toBe(1);
  });

  it('a loss resets the streak and pays nothing', () => {
    const pools: JackpotPools = { major: 100, grand: 100 };
    const streaks = new Map([['p', 4]]);
    const res = resolveJackpots(
      pools,
      streaks,
      [{ playerId: 'p', stakeUsd: 1, won: false }],
      false,
      DEFAULT_JACKPOT_CONFIG,
    );
    expect(streaks.get('p')).toBe(0);
    expect(res.paidUsd).toBe(0);
    expect(pools).toEqual({ major: 100, grand: 100 });
  });
});

/**
 * Long-horizon Monte-Carlo of the *exact* economic loop a single-side streak
 * farmer plays: bet one ~50/50 side every round, real settlement odds, jackpots
 * funded only from the pools. Proves the structural fix: the house can never go
 * negative and total RTP stays around 94%.
 */
describe('streak-farming long-run economics', () => {
  it('house P&L stays positive and jackpot payouts never exceed contributions', () => {
    const cfg = DEFAULT_JACKPOT_CONFIG;
    const pools = initJackpot(cfg);
    const streaks = new Map<string, number>();
    const stake = 1;
    const rounds = 200_000;

    let totalStaked = 0;
    let regularPaid = 0;
    let jackpotPaid = 0;
    let contributions = 0;
    let worstJackpotNet = Infinity;

    for (let i = 0; i < rounds; i += 1) {
      const resultHash = randomBytes(32).toString('hex');
      const txid = deriveWinningTxid(resultHash, 'BTC');

      // Single-side streak farm: always bet "last char even".
      const bets: PlacedBet[] = [
        {
          id: String(i),
          playerId: 'farmer',
          type: 'LAST_CHAR_PARITY',
          selection: { parity: 'even' },
          amount: stake,
        },
      ];
      const s = settleRound(bets, 'BTC', txid, 0.06);
      const won = s.results[0].won;

      totalStaked += stake;
      regularPaid += s.totalPaidOut;
      contributions += stake * cfg.contributionRate;
      contribute(pools, stake, cfg);

      const res = resolveJackpots(
        pools,
        streaks,
        [{ playerId: 'farmer', stakeUsd: stake, won }],
        hasIdenticalTail('BTC', txid, cfg.grandTailLength),
        cfg,
      );
      jackpotPaid += res.paidUsd;

      // Pools can never go negative.
      expect(pools.major).toBeGreaterThanOrEqual(0);
      expect(pools.grand).toBeGreaterThanOrEqual(0);

      // The jackpot subsystem alone never spends more than it has collected:
      // cumulative contributions minus cumulative payouts (== the pools) stays
      // non-negative every single round. This is the "no minting" guarantee.
      worstJackpotNet = Math.min(worstJackpotNet, contributions - jackpotPaid);
    }

    const totalReturned = regularPaid + jackpotPaid;
    const rtp = totalReturned / totalStaked;
    const housePnl = totalStaked - totalReturned;

    // The core guarantee: jackpots are funded only from contributions, so they
    // can never exceed them (pools start at 0 and are never minted/reseeded).
    expect(jackpotPaid).toBeLessThanOrEqual(contributions + 1e-6);
    expect(worstJackpotNet).toBeGreaterThanOrEqual(-1e-6);
    // House keeps a positive edge over the long run regardless of strategy.
    expect(housePnl).toBeGreaterThan(0);
    // Total effective RTP stays in a tight band around the 94% target — never
    // the >100% (player-favoured) regime the old minted-jackpot allowed. The
    // jackpot share rides on top of the 94% base, bounded by the 4% pool.
    expect(rtp).toBeGreaterThan(0.9);
    expect(rtp).toBeLessThan(0.99);
  });
});
