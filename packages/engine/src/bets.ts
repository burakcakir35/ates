import { ChainId, getChain } from './chains';
import { charValue, digitSum, stripPrefix } from './txid';

export type BetTypeId =
  | 'LAST_CHAR_DIGIT'
  | 'LAST_CHAR_LETTER'
  | 'LAST_CHAR_PARITY'
  | 'FIRST_CHAR_RANGE'
  | 'SUM_PARITY'
  | 'SUM_MOD'
  | 'EXACT_LAST_CHAR';

export interface BetSelection {
  /** For LAST_CHAR_PARITY / SUM_PARITY: 'even' | 'odd'. */
  parity?: 'even' | 'odd';
  /** For FIRST_CHAR_RANGE: 'low' | 'high'. */
  range?: 'low' | 'high';
  /** For SUM_MOD: modulus. */
  mod?: number;
  /** For SUM_MOD: target residue. */
  residue?: number;
  /** For EXACT_LAST_CHAR: the predicted character. */
  char?: string;
}

const DIGIT_RE = /[0-9]/;

function countDigits(alphabet: string): number {
  return [...alphabet].filter((c) => DIGIT_RE.test(c)).length;
}

function lastChar(chain: ChainId, txid: string): string {
  const bare = stripPrefix(chain, txid);
  return bare[bare.length - 1];
}

function firstChar(chain: ChainId, txid: string): string {
  const bare = stripPrefix(chain, txid);
  return bare[0];
}

/** Returns true if the bet wins for the given winning txid. */
export function evaluateBet(
  type: BetTypeId,
  chain: ChainId,
  selection: BetSelection,
  winningTxid: string,
): boolean {
  const spec = getChain(chain);
  switch (type) {
    case 'LAST_CHAR_DIGIT':
      return DIGIT_RE.test(lastChar(chain, winningTxid));
    case 'LAST_CHAR_LETTER':
      return !DIGIT_RE.test(lastChar(chain, winningTxid));
    case 'LAST_CHAR_PARITY': {
      const v = charValue(chain, lastChar(chain, winningTxid));
      return selection.parity === 'even' ? v % 2 === 0 : v % 2 === 1;
    }
    case 'FIRST_CHAR_RANGE': {
      const v = charValue(chain, firstChar(chain, winningTxid));
      const half = Math.floor(spec.alphabet.length / 2);
      return selection.range === 'low' ? v < half : v >= half;
    }
    case 'SUM_PARITY': {
      const s = digitSum(chain, winningTxid);
      return selection.parity === 'even' ? s % 2 === 0 : s % 2 === 1;
    }
    case 'SUM_MOD': {
      if (!selection.mod || selection.residue === undefined) {
        throw new Error('SUM_MOD requires mod and residue');
      }
      return digitSum(chain, winningTxid) % selection.mod === selection.residue;
    }
    case 'EXACT_LAST_CHAR': {
      if (!selection.char) {
        throw new Error('EXACT_LAST_CHAR requires char');
      }
      return lastChar(chain, winningTxid) === selection.char;
    }
    default:
      throw new Error(`Unknown bet type: ${type}`);
  }
}

/** Probability of winning the bet, derived analytically from the alphabet. */
export function betProbability(
  type: BetTypeId,
  chain: ChainId,
  selection: BetSelection,
): number {
  const spec = getChain(chain);
  const L = spec.alphabet.length;
  switch (type) {
    case 'LAST_CHAR_DIGIT':
      return countDigits(spec.alphabet) / L;
    case 'LAST_CHAR_LETTER':
      return (L - countDigits(spec.alphabet)) / L;
    case 'LAST_CHAR_PARITY': {
      const even = Math.ceil(L / 2);
      const count = selection.parity === 'even' ? even : L - even;
      return count / L;
    }
    case 'FIRST_CHAR_RANGE': {
      const half = Math.floor(L / 2);
      const count = selection.range === 'low' ? half : L - half;
      return count / L;
    }
    case 'SUM_PARITY':
      // Sum of many uniform symbols is effectively a fair coin.
      return 0.5;
    case 'SUM_MOD': {
      if (!selection.mod) {
        throw new Error('SUM_MOD requires mod');
      }
      return 1 / selection.mod;
    }
    case 'EXACT_LAST_CHAR':
      return 1 / L;
    default:
      throw new Error(`Unknown bet type: ${type}`);
  }
}

/**
 * Payout multiplier for a winning bet, including the house edge.
 * multiplier = (1 / probability) * (1 - houseEdge)
 */
export function payoutMultiplier(
  type: BetTypeId,
  chain: ChainId,
  selection: BetSelection,
  houseEdge = 0.06,
): number {
  const p = betProbability(type, chain, selection);
  if (p <= 0) {
    throw new Error('probability must be > 0');
  }
  const raw = (1 / p) * (1 - houseEdge);
  return Math.round(raw * 100) / 100;
}
