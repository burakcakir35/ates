import { describe, it, expect } from 'vitest';
import {
  betProbability,
  evaluateBet,
  payoutMultiplier,
} from '../src/bets';

describe('bet probabilities (hex chains)', () => {
  it('last char digit/letter match the hex distribution', () => {
    expect(betProbability('LAST_CHAR_DIGIT', 'BTC', {})).toBeCloseTo(10 / 16);
    expect(betProbability('LAST_CHAR_LETTER', 'BTC', {})).toBeCloseTo(6 / 16);
  });

  it('exact last char is 1/16 for hex and 1/58 for base58', () => {
    expect(betProbability('EXACT_LAST_CHAR', 'BTC', { char: 'a' })).toBeCloseTo(
      1 / 16,
    );
    expect(betProbability('EXACT_LAST_CHAR', 'SOL', { char: 'a' })).toBeCloseTo(
      1 / 58,
    );
  });

  it('last char digit differs between BTC (10/16) and SOL (9/58)', () => {
    expect(betProbability('LAST_CHAR_DIGIT', 'SOL', {})).toBeCloseTo(9 / 58);
  });

  it('payout multiplier embeds the house edge (RTP 94%)', () => {
    // p = 10/16 => fair 1.6 => *0.94 = 1.504 -> 1.5
    expect(payoutMultiplier('LAST_CHAR_DIGIT', 'BTC', {}, 0.06)).toBeCloseTo(
      1.5,
    );
  });
});

describe('bet evaluation', () => {
  it('evaluates last-char digit vs letter consistently', () => {
    // Build a txid ending in a known char by brute searching seeds is overkill;
    // instead test the predicate directly via a crafted result.
    const digitTxid = '0x' + 'a'.repeat(63) + '5';
    const letterTxid = '0x' + '5'.repeat(63) + 'a';
    expect(evaluateBet('LAST_CHAR_DIGIT', 'ETH', {}, digitTxid)).toBe(true);
    expect(evaluateBet('LAST_CHAR_LETTER', 'ETH', {}, digitTxid)).toBe(false);
    expect(evaluateBet('LAST_CHAR_LETTER', 'ETH', {}, letterTxid)).toBe(true);
  });

  it('exact last char matches only the predicted character', () => {
    const txid = 'f'.repeat(64);
    expect(evaluateBet('EXACT_LAST_CHAR', 'BTC', { char: 'f' }, txid)).toBe(true);
    expect(evaluateBet('EXACT_LAST_CHAR', 'BTC', { char: 'e' }, txid)).toBe(
      false,
    );
  });

  it('sum mod selects the right residue', () => {
    const txid = '0'.repeat(63) + '7'; // digit sum = 7
    expect(
      evaluateBet('SUM_MOD', 'BTC', { mod: 10, residue: 7 }, txid),
    ).toBe(true);
    expect(
      evaluateBet('SUM_MOD', 'BTC', { mod: 10, residue: 3 }, txid),
    ).toBe(false);
  });
});
