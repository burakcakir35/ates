import { describe, it, expect } from 'vitest';
import {
  captureBeacon,
  commit,
  computeResultHash,
  deriveWinningTxid,
  generateServerSeed,
  verifyRound,
  CommitRevealRound,
} from '../src/fairness';
import { generateTxid } from '../src/txid';

describe('fairness commit/reveal', () => {
  it('commit is sha256 of the seed', () => {
    const seed = generateServerSeed();
    expect(commit(seed)).toHaveLength(64);
    expect(commit(seed)).toBe(commit(seed));
  });

  it('result hash is deterministic given the same inputs', () => {
    const seed = 'abc';
    const beacon = captureBeacon();
    const a = computeResultHash(seed, beacon, 'round-1');
    const b = computeResultHash(seed, beacon, 'round-1');
    expect(a).toBe(b);
  });

  it('result hash changes with the round id', () => {
    const seed = 'abc';
    const beacon = captureBeacon();
    expect(computeResultHash(seed, beacon, 'r1')).not.toBe(
      computeResultHash(seed, beacon, 'r2'),
    );
  });

  it('verifyRound accepts an honest round and rejects tampering', () => {
    const serverSeed = generateServerSeed();
    const commitHash = commit(serverSeed);
    const beacon = captureBeacon();
    const roundId = 'round-42';
    const resultHash = computeResultHash(serverSeed, beacon, roundId);
    const winningChain = 'ETH' as const;
    const winningTxid = deriveWinningTxid(resultHash, winningChain);

    const round: CommitRevealRound = {
      roundId,
      serverSeed,
      commitHash,
      beacon,
      resultHash,
      winningChain,
      winningTxid,
    };

    expect(verifyRound(round)).toBe(true);

    const tampered = { ...round, winningTxid: generateTxid('ETH', 'other') };
    expect(verifyRound(tampered)).toBe(false);

    const tamperedSeed = { ...round, serverSeed: generateServerSeed() };
    expect(verifyRound(tamperedSeed)).toBe(false);
  });
});
