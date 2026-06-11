import { describe, expect, it } from 'vitest';
import {
  COIN_IDS,
  COIN_POOL_SIZE,
  captureBeacon,
  commit,
  computeResultHash,
  deriveWinningTxid,
  generateServerSeed,
  selectCoinPool,
  selectWinningCoin,
  sha256Hex,
  verifyRound,
} from '../src';

function buildRound(roundId: string) {
  const serverSeed = generateServerSeed();
  const commitHash = commit(serverSeed);
  const coinPool = selectCoinPool(commitHash, roundId);
  const beacon = captureBeacon();
  const resultHash = computeResultHash(serverSeed, beacon, roundId);
  const winningChain = selectWinningCoin(resultHash, coinPool);
  const winningTxid = deriveWinningTxid(resultHash, winningChain);
  return {
    roundId,
    serverSeed,
    commitHash,
    coinPool,
    beacon,
    resultHash,
    winningChain,
    winningTxid,
  };
}

describe('coin pool selection', () => {
  it('selects 20 unique coins from the catalogue', () => {
    const pool = selectCoinPool(sha256Hex('seed'), 'round-1');
    expect(pool).toHaveLength(COIN_POOL_SIZE);
    expect(new Set(pool).size).toBe(COIN_POOL_SIZE);
    for (const coin of pool) {
      expect(COIN_IDS).toContain(coin);
    }
  });

  it('is deterministic: same inputs -> identical pool', () => {
    const a = selectCoinPool(sha256Hex('seed'), 'round-1');
    const b = selectCoinPool(sha256Hex('seed'), 'round-1');
    expect(a).toEqual(b);
  });

  it('changes with the round id (unpredictable per round)', () => {
    const pools = new Set(
      Array.from({ length: 10 }, (_, i) =>
        selectCoinPool(sha256Hex('seed'), `round-${i}`).join(','),
      ),
    );
    expect(pools.size).toBeGreaterThan(1);
  });

  it('changes with the commit hash', () => {
    const a = selectCoinPool(sha256Hex('seed-a'), 'round-1');
    const b = selectCoinPool(sha256Hex('seed-b'), 'round-1');
    expect(a.join(',')).not.toBe(b.join(','));
  });

  it('winning coin is drawn from the pool deterministically', () => {
    const pool = selectCoinPool(sha256Hex('seed'), 'round-1');
    const w1 = selectWinningCoin(sha256Hex('result'), pool);
    const w2 = selectWinningCoin(sha256Hex('result'), pool);
    expect(w1).toBe(w2);
    expect(pool).toContain(w1);
  });

  it('winning coin distribution covers the pool (not constant)', () => {
    const pool = selectCoinPool(sha256Hex('seed'), 'round-1');
    const winners = new Set(
      Array.from({ length: 200 }, (_, i) =>
        selectWinningCoin(sha256Hex(`r-${i}`), pool),
      ),
    );
    expect(winners.size).toBeGreaterThan(10);
  });
});

describe('verifyRound with coin pool', () => {
  it('verifies an honest round including the pool selection', () => {
    expect(verifyRound(buildRound('round-ok'))).toBe(true);
  });

  it('fails when the pool is tampered with', () => {
    const r = buildRound('round-tamper-pool');
    const swapped = [...r.coinPool];
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    expect(verifyRound({ ...r, coinPool: swapped })).toBe(false);
  });

  it('fails when a pool coin is replaced', () => {
    const r = buildRound('round-replace-coin');
    const outside = COIN_IDS.find((c) => !r.coinPool.includes(c))!;
    const replaced = [outside, ...r.coinPool.slice(1)];
    expect(verifyRound({ ...r, coinPool: replaced })).toBe(false);
  });

  it('fails when the round id is changed (pool no longer matches)', () => {
    const r = buildRound('round-original');
    expect(verifyRound({ ...r, roundId: 'round-forged' })).toBe(false);
  });

  it('fails when the winning chain is not the pool-derived one', () => {
    const r = buildRound('round-wrong-winner');
    const other = r.coinPool.find((c) => c !== r.winningChain)!;
    expect(
      verifyRound({
        ...r,
        winningChain: other,
        winningTxid: deriveWinningTxid(r.resultHash, other),
      }),
    ).toBe(false);
  });
});
