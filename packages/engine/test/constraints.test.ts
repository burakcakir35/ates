import { describe, expect, it } from 'vitest';
import {
  COIN_IDS,
  autoPick,
  betProbability,
  complementaryGroup,
  isCounterBet,
  payoutMultiplier,
} from '../src';
import type { BetSelection, BetTypeId } from '../src';

const COMP_SETS: { name: string; members: { type: BetTypeId; selection: BetSelection }[] }[] = [
  {
    name: 'last-char digit/letter',
    members: [
      { type: 'LAST_CHAR_DIGIT', selection: {} },
      { type: 'LAST_CHAR_LETTER', selection: {} },
    ],
  },
  {
    name: 'last-char parity',
    members: [
      { type: 'LAST_CHAR_PARITY', selection: { parity: 'even' } },
      { type: 'LAST_CHAR_PARITY', selection: { parity: 'odd' } },
    ],
  },
  {
    name: 'first-char range',
    members: [
      { type: 'FIRST_CHAR_RANGE', selection: { range: 'low' } },
      { type: 'FIRST_CHAR_RANGE', selection: { range: 'high' } },
    ],
  },
  {
    name: 'sum parity',
    members: [
      { type: 'SUM_PARITY', selection: { parity: 'even' } },
      { type: 'SUM_PARITY', selection: { parity: 'odd' } },
    ],
  },
];

describe('B1 odds math: no risk-free profit in any complementary set', () => {
  it('probabilities of each complementary set sum to exactly 1 on every coin', () => {
    for (const coin of COIN_IDS) {
      for (const set of COMP_SETS) {
        const sum = set.members.reduce(
          (s, m) => s + betProbability(m.type, coin, m.selection),
          0,
        );
        expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
      }
    }
  });

  it('no Dutch book: sum of inverse odds > 1 (house edge intact)', () => {
    for (const coin of COIN_IDS) {
      for (const set of COMP_SETS) {
        const inv = set.members.reduce(
          (s, m) => s + 1 / payoutMultiplier(m.type, coin, m.selection),
          0,
        );
        // 1/0.94 = 1.0638; any value > 1 means covering the whole set cannot
        // guarantee a profit no matter how stakes are split.
        expect(inv).toBeGreaterThan(1);
      }
    }
  });

  it('50/50 sets pay strictly less than the combined stake (guaranteed loss)', () => {
    for (const coin of COIN_IDS) {
      for (const set of COMP_SETS) {
        const ps = set.members.map((m) => betProbability(m.type, coin, m.selection));
        const isEven = ps.every((p) => Math.abs(p - 0.5) < 1e-9);
        if (!isEven) continue;
        // 1 unit on each member -> stake = 2; each outcome returns one multiplier.
        for (const m of set.members) {
          expect(payoutMultiplier(m.type, coin, m.selection)).toBeLessThan(2);
        }
      }
    }
  });
});

describe('complementaryGroup / isCounterBet', () => {
  it('flags opposite members of the same partition as counter-bets', () => {
    expect(
      isCounterBet(
        { type: 'LAST_CHAR_PARITY', selection: { parity: 'even' } },
        { type: 'LAST_CHAR_PARITY', selection: { parity: 'odd' } },
      ),
    ).toBe(true);
    expect(
      isCounterBet(
        { type: 'LAST_CHAR_DIGIT', selection: {} },
        { type: 'LAST_CHAR_LETTER', selection: {} },
      ),
    ).toBe(true);
    expect(
      isCounterBet(
        { type: 'FIRST_CHAR_RANGE', selection: { range: 'low' } },
        { type: 'FIRST_CHAR_RANGE', selection: { range: 'high' } },
      ),
    ).toBe(true);
  });

  it('does not flag the same member twice or unrelated groups', () => {
    expect(
      isCounterBet(
        { type: 'LAST_CHAR_PARITY', selection: { parity: 'even' } },
        { type: 'LAST_CHAR_PARITY', selection: { parity: 'even' } },
      ),
    ).toBe(false);
    expect(
      isCounterBet(
        { type: 'LAST_CHAR_PARITY', selection: { parity: 'even' } },
        { type: 'SUM_PARITY', selection: { parity: 'odd' } },
      ),
    ).toBe(false);
    expect(
      isCounterBet(
        { type: 'LAST_CHAR_DIGIT', selection: {} },
        { type: 'FIRST_CHAR_RANGE', selection: { range: 'low' } },
      ),
    ).toBe(false);
  });

  it('non-partition bets have no group', () => {
    expect(complementaryGroup('SUM_MOD', { mod: 10, residue: 0 })).toBeNull();
    expect(complementaryGroup('EXACT_LAST_CHAR', { char: 'a' })).toBeNull();
  });
});

describe('autoPick never assembles a guaranteed-win set', () => {
  it('contains at most one member per complementary group', () => {
    for (let trial = 0; trial < 200; trial += 1) {
      const picks = autoPick(20);
      const memberByGroup = new Map<string, string>();
      for (const p of picks) {
        const g = complementaryGroup(p.type, p.selection);
        if (!g) continue;
        const seen = memberByGroup.get(g.group);
        if (seen) {
          expect(seen).toBe(g.member);
        } else {
          memberByGroup.set(g.group, g.member);
        }
      }
    }
  });
});
