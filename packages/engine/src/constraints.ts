import { BetSelection, BetTypeId } from './bets';

/**
 * Identifies the complementary (mutually exclusive + collectively exhaustive)
 * outcome a bet belongs to.
 *
 * Betting on two different members of the same group in one round guarantees
 * that exactly one wins regardless of the outcome — a risk-free win that the
 * player can use to keep a jackpot streak alive forever. Such combinations are
 * forbidden; this helper is the single source of truth for what counts as
 * "opposite sides of the same coin".
 */
export interface ComplementaryGroup {
  /** Stable id of the exhaustive partition (e.g. last character class). */
  group: string;
  /** Which side of that partition this bet covers. */
  member: string;
}

export function complementaryGroup(
  type: BetTypeId,
  selection: BetSelection,
): ComplementaryGroup | null {
  switch (type) {
    case 'LAST_CHAR_DIGIT':
      return { group: 'last-char-class', member: 'digit' };
    case 'LAST_CHAR_LETTER':
      return { group: 'last-char-class', member: 'letter' };
    case 'LAST_CHAR_PARITY':
      return selection.parity
        ? { group: 'last-char-parity', member: selection.parity }
        : null;
    case 'FIRST_CHAR_RANGE':
      return selection.range
        ? { group: 'first-char-range', member: selection.range }
        : null;
    case 'SUM_PARITY':
      return selection.parity
        ? { group: 'sum-parity', member: selection.parity }
        : null;
    default:
      // SUM_MOD / EXACT_LAST_CHAR are not part of a binary exhaustive partition.
      return null;
  }
}

/**
 * True if `candidate` would, together with an already-placed bet, cover both
 * sides of the same exhaustive partition (i.e. a guaranteed-win counter-bet).
 */
export function isCounterBet(
  existing: { type: BetTypeId; selection: BetSelection },
  candidate: { type: BetTypeId; selection: BetSelection },
): boolean {
  const a = complementaryGroup(existing.type, existing.selection);
  const b = complementaryGroup(candidate.type, candidate.selection);
  return a !== null && b !== null && a.group === b.group && a.member !== b.member;
}
