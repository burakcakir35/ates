import { describe, it, expect } from 'vitest';
import { CHAINS } from '../src/chains';
import { charValue, digitSum, generateTxid, stripPrefix } from '../src/txid';

describe('txid generation', () => {
  it('is deterministic for a given chain + seed', () => {
    expect(generateTxid('BTC', 'seed')).toBe(generateTxid('BTC', 'seed'));
  });

  it('produces the correct length and alphabet per chain', () => {
    for (const spec of Object.values(CHAINS)) {
      const txid = generateTxid(spec.id, 'seed-xyz');
      const bare = stripPrefix(spec.id, txid);
      expect(bare).toHaveLength(spec.length);
      for (const ch of bare) {
        expect(spec.alphabet).toContain(ch);
      }
      if (spec.prefix) {
        expect(txid.startsWith(spec.prefix)).toBe(true);
      }
    }
  });

  it('ETH txid carries the 0x prefix and 64 hex chars', () => {
    const txid = generateTxid('ETH', 's');
    expect(txid).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('charValue and digitSum work on the bare hash', () => {
    expect(charValue('BTC', 'a')).toBe(10);
    expect(charValue('BTC', '0')).toBe(0);
    const txid = generateTxid('BTC', 'sum-seed');
    expect(digitSum('BTC', txid)).toBeGreaterThan(0);
  });

  it('rejects characters outside the alphabet', () => {
    expect(() => charValue('SOL', '0')).toThrow();
  });
});
