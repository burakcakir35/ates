import { ChainId, getChain } from './chains';
import { SeededRng } from './rng';

/**
 * Deterministically generate a TXID-shaped string for a chain from a seed.
 *
 * NOTE: This is a *simulated* TXID for the play-money prototype. It mimics the
 * statistical properties of a real transaction hash (uniform over the chain's
 * alphabet) so the odds maths is identical, but it is not a real on-chain hash.
 */
export function generateTxid(chain: ChainId, seed: string): string {
  const spec = getChain(chain);
  const rng = new SeededRng(seed);
  const alphabet = spec.alphabet;
  let out = '';
  for (let i = 0; i < spec.length; i += 1) {
    out += alphabet[rng.nextInt(alphabet.length)];
  }
  return spec.prefix + out;
}

/** Strip the chain prefix (e.g. "0x") from a txid, returning the bare hash. */
export function stripPrefix(chain: ChainId, txid: string): string {
  const spec = getChain(chain);
  if (spec.prefix && txid.startsWith(spec.prefix)) {
    return txid.slice(spec.prefix.length);
  }
  return txid;
}

/** Numeric value of a single character within a chain's alphabet. */
export function charValue(chain: ChainId, ch: string): number {
  const spec = getChain(chain);
  const idx = spec.alphabet.indexOf(ch);
  if (idx < 0) {
    throw new Error(`Character "${ch}" is not in the ${chain} alphabet`);
  }
  return idx;
}

/** Sum of the numeric values of every character in the bare hash. */
export function digitSum(chain: ChainId, txid: string): number {
  const bare = stripPrefix(chain, txid);
  let sum = 0;
  for (const ch of bare) {
    sum += charValue(chain, ch);
  }
  return sum;
}
