import { describe, expect, it } from 'vitest';
import {
  AUTO_PICK_SPACE,
  autoPick,
  evaluateBet,
  generateTxid,
  payoutMultiplier,
  sha256Hex,
} from '../src';

describe('autoPick', () => {
  it('produces the requested number of valid picks', () => {
    const picks = autoPick(5);
    expect(picks).toHaveLength(5);
    for (const p of picks) {
      expect(
        AUTO_PICK_SPACE.some(
          (s) =>
            s.type === p.type &&
            JSON.stringify(s.selection) === JSON.stringify(p.selection),
        ),
      ).toBe(true);
    }
  });

  it('rejects invalid counts', () => {
    expect(() => autoPick(0)).toThrow();
    expect(() => autoPick(21)).toThrow();
    expect(() => autoPick(2.5)).toThrow();
  });

  it('uses exactly the manual odds tables (same multiplier per pick)', () => {
    for (const p of autoPick(20)) {
      const manual = AUTO_PICK_SPACE.find(
        (s) =>
          s.type === p.type &&
          JSON.stringify(s.selection) === JSON.stringify(p.selection),
      )!;
      expect(payoutMultiplier(p.type, 'BTC', p.selection)).toBe(
        payoutMultiplier(manual.type, 'BTC', manual.selection),
      );
    }
  });

  it('fairness: 10k auto picks vs 10k manual picks give the same RTP', () => {
    const N = 10000;
    const stake = 1;
    let autoReturn = 0;
    let manualReturn = 0;
    for (let i = 0; i < N; i += 1) {
      const txid = generateTxid('BTC', sha256Hex(`fair-${i}`));
      const auto = autoPick(1)[0];
      if (evaluateBet(auto.type, 'BTC', auto.selection, txid)) {
        autoReturn += stake * payoutMultiplier(auto.type, 'BTC', auto.selection);
      }
      const manual = AUTO_PICK_SPACE[i % AUTO_PICK_SPACE.length];
      if (evaluateBet(manual.type, 'BTC', manual.selection, txid)) {
        manualReturn +=
          stake * payoutMultiplier(manual.type, 'BTC', manual.selection);
      }
    }
    const autoRtp = autoReturn / N;
    const manualRtp = manualReturn / N;
    // Both should sit near the 0.94 target; allow Monte-Carlo noise.
    expect(Math.abs(autoRtp - 0.94)).toBeLessThan(0.05);
    expect(Math.abs(manualRtp - 0.94)).toBeLessThan(0.05);
    expect(Math.abs(autoRtp - manualRtp)).toBeLessThan(0.08);
  });

  it('picks are spread over the whole space (random, not constant)', () => {
    const seen = new Set(
      autoPick(20)
        .concat(autoPick(20), autoPick(20))
        .map((p) => `${p.type}:${JSON.stringify(p.selection)}`),
    );
    expect(seen.size).toBeGreaterThan(3);
  });
});
