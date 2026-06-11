import { randomInt } from 'crypto';
import { BetSelection, BetTypeId } from './bets';

export interface AutoPick {
  type: BetTypeId;
  selection: BetSelection;
}

/**
 * The pickable bet space for auto-pick: exactly the same options a player can
 * select by hand, so auto-picked bets use the identical probability/odds tables
 * (fairness rule: auto-pick gives no advantage or disadvantage).
 */
export const AUTO_PICK_SPACE: AutoPick[] = [
  { type: 'LAST_CHAR_DIGIT', selection: {} },
  { type: 'LAST_CHAR_LETTER', selection: {} },
  { type: 'LAST_CHAR_PARITY', selection: { parity: 'even' } },
  { type: 'LAST_CHAR_PARITY', selection: { parity: 'odd' } },
  { type: 'FIRST_CHAR_RANGE', selection: { range: 'low' } },
  { type: 'FIRST_CHAR_RANGE', selection: { range: 'high' } },
  { type: 'SUM_PARITY', selection: { parity: 'even' } },
  { type: 'SUM_PARITY', selection: { parity: 'odd' } },
];

/** Generate `count` uniformly random picks from the manual bet space. */
export function autoPick(count: number): AutoPick[] {
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    throw new Error('count must be an integer between 1 and 20');
  }
  const picks: AutoPick[] = [];
  for (let i = 0; i < count; i += 1) {
    const choice = AUTO_PICK_SPACE[randomInt(AUTO_PICK_SPACE.length)];
    picks.push({ type: choice.type, selection: { ...choice.selection } });
  }
  return picks;
}
