import { createHash, randomBytes } from 'crypto';
import { ChainId, CHAIN_IDS } from './chains';
import { generateTxid } from './txid';

/** Per-chain beacon hash captured at lock time (simulated in the prototype). */
export type BeaconHashes = Record<ChainId, string>;

export interface CommitRevealRound {
  roundId: string;
  /** Secret, revealed only after the round ends. */
  serverSeed: string;
  /** Public commitment published at round start: sha256(serverSeed). */
  commitHash: string;
  /** Multi-chain beacon hashes captured when bets lock. */
  beacon: BeaconHashes;
  /** Final combined result hash. */
  resultHash: string;
  /** The winning TXID derived from resultHash, per the round's chain. */
  winningChain: ChainId;
  winningTxid: string;
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function generateServerSeed(): string {
  return randomBytes(32).toString('hex');
}

export function commit(serverSeed: string): string {
  return sha256Hex(serverSeed);
}

/**
 * Simulate the multi-chain block-hash beacon. In production these would be the
 * future block hashes from Solana/ETH/BTC/USDT that are unknowable until after
 * bets lock. Here we generate them at lock time from fresh entropy so they are
 * equally unknowable to anyone (including the operator) before the lock.
 */
export function captureBeacon(): BeaconHashes {
  const beacon = {} as BeaconHashes;
  for (const chain of CHAIN_IDS) {
    beacon[chain] = randomBytes(32).toString('hex');
  }
  return beacon;
}

/**
 * Combine the secret server seed with the public beacon hashes and round id.
 * Neither party can compute this before the beacon is captured at lock time,
 * and anyone can recompute it afterwards from the revealed seed.
 */
export function computeResultHash(
  serverSeed: string,
  beacon: BeaconHashes,
  roundId: string,
): string {
  const beaconPart = CHAIN_IDS.map((c) => beacon[c]).join('|');
  return sha256Hex(`${serverSeed}|${beaconPart}|${roundId}`);
}

/**
 * Derive the winning TXID for the round from the result hash. The result hash
 * seeds the deterministic TXID generator for the winning chain.
 */
export function deriveWinningTxid(
  resultHash: string,
  winningChain: ChainId,
): string {
  return generateTxid(winningChain, resultHash);
}

/**
 * Re-run the whole derivation from public + revealed inputs. Used by the
 * verification endpoint so a player can independently confirm a result.
 */
export function verifyRound(round: CommitRevealRound): boolean {
  if (commit(round.serverSeed) !== round.commitHash) {
    return false;
  }
  const resultHash = computeResultHash(
    round.serverSeed,
    round.beacon,
    round.roundId,
  );
  if (resultHash !== round.resultHash) {
    return false;
  }
  const txid = deriveWinningTxid(resultHash, round.winningChain);
  return txid === round.winningTxid;
}
