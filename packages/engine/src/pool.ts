import { ChainId, COIN_IDS } from './chains';
import { SeededRng } from './rng';

export const COIN_POOL_SIZE = 20;

/**
 * Deterministically select the round's coin pool from the candidate catalogue.
 *
 * The seed is the public commit hash plus the round id, so the pool is fixed at
 * commit time (before any bet) and anyone can re-derive it afterwards from the
 * same public inputs — the operator cannot swap coins in or out mid-round.
 */
export function selectCoinPool(
  commitHash: string,
  roundId: string,
  size = COIN_POOL_SIZE,
  catalogue: ChainId[] = COIN_IDS,
): ChainId[] {
  if (size > catalogue.length) {
    throw new Error('pool size exceeds catalogue');
  }
  const rng = new SeededRng(`${commitHash}|${roundId}|coin-pool`);
  const deck = [...catalogue];
  // Fisher–Yates shuffle driven by the deterministic rng.
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = rng.nextInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck.slice(0, size);
}

/**
 * Pick the winning coin out of the round's pool from the result hash, which is
 * only computable after the beacon is captured at lock time.
 */
export function selectWinningCoin(
  resultHash: string,
  pool: ChainId[],
): ChainId {
  if (pool.length === 0) {
    throw new Error('empty coin pool');
  }
  const rng = new SeededRng(`${resultHash}|winning-coin`);
  return pool[rng.nextInt(pool.length)];
}
