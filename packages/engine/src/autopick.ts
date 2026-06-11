import { randomInt } from 'crypto';
import { BetSelection, BetTypeId } from './bets';
import { complementaryGroup } from './constraints';

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

/**
 * Generate `count` uniformly random picks from the manual bet space.
 *
 * Picks honour the same counter-bet rule as manual play: the first time a
 * complementary group is drawn its side is locked in, and later draws that land
 * on the opposite side reuse the locked side instead. This means auto-pick can
 * never assemble a guaranteed-win set, exactly like a player betting by hand.
 */
export function autoPick(count: number): AutoPick[] {
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    throw new Error('count must be an integer between 1 and 20');
  }
  const picks: AutoPick[] = [];
  const lockedMember = new Map<string, AutoPick>();
  for (let i = 0; i < count; i += 1) {
    let choice = AUTO_PICK_SPACE[randomInt(AUTO_PICK_SPACE.length)];
    const group = complementaryGroup(choice.type, choice.selection);
    if (group) {
      const locked = lockedMember.get(group.group);
      if (locked) {
        choice = locked;
      } else {
        lockedMember.set(group.group, choice);
      }
    }
    picks.push({ type: choice.type, selection: { ...choice.selection } });
  }
  return picks;
}
