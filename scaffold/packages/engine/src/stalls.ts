import { doubleProgressionStalled, topSetStalled } from './rules';
import type { SetLog, SlotStall, SlotState, StallReport } from './types';
import { groupSessions, maxWeight, type SessionGroup } from './util';

/**
 * Detect stalls per the slot's rule's stall definition (Part D). atRisk =
 * one failed/flat session away from stalling — the coach's early-warning
 * input, never an automatic action.
 */
export function detectStalls(slots: SlotState[], history: SetLog[]): StallReport {
  const stalled: SlotStall[] = [];
  const atRisk: SlotStall[] = [];

  for (const slot of slots) {
    const sessions = groupSessions(history, slot.exerciseId);
    if (sessions.length === 0) continue;
    const entry = (reason: string): SlotStall => ({
      slotId: slot.slotId,
      exerciseId: slot.exerciseId,
      rule: slot.rule,
      reason,
    });

    switch (slot.rule) {
      case 'novice_linear': {
        const fails = trailingNoviceFails(slot, sessions);
        if (fails >= 2) stalled.push(entry('2 consecutive failed sessions'));
        else if (fails === 1) atRisk.push(entry('1 failed session — one more is a stall'));
        break;
      }
      case 'double_progression':
      case 'rep_progression': {
        if (doubleProgressionStalled(sessions)) {
          stalled.push(entry('no rep or load increase across 3 consecutive sessions'));
        } else if (flatPairs(sessions) === 1) {
          atRisk.push(entry('flat last session — one more without progress is a stall'));
        }
        break;
      }
      case 'top_set_backoff': {
        if (topSetStalled(sessions)) stalled.push(entry('top-set e1RM flat or down across 3 sessions'));
        break;
      }
      default:
        break; // timed/onramp don't stall in a load sense
    }
  }
  return { stalled, atRisk };
}

function trailingNoviceFails(slot: SlotState, sessions: SessionGroup[]): number {
  const target = slot.reps?.[0] ?? 5;
  const setCount = slot.sets ?? 3;
  const last = sessions[sessions.length - 1];
  if (!last) return 0;
  const anchor = maxWeight(last.sets);
  let n = 0;
  for (let i = sessions.length - 1; i >= 0; i--) {
    const s = sessions[i]!;
    const failed = s.sets.length < setCount || s.sets.some((x) => x.reps < target);
    if (failed && Math.abs(maxWeight(s.sets) - anchor) < 2.5) n++;
    else break;
  }
  return n;
}

/** Trailing consecutive session pairs with no rep or load increase. */
function flatPairs(sessions: SessionGroup[]): number {
  let n = 0;
  for (let i = sessions.length - 1; i > 0; i--) {
    const prev = sessions[i - 1]!;
    const cur = sessions[i]!;
    const flat =
      maxWeight(cur.sets) <= maxWeight(prev.sets) &&
      cur.sets.reduce((t, s) => t + s.reps, 0) <= prev.sets.reduce((t, s) => t + s.reps, 0);
    if (flat) n++;
    else break;
  }
  return n;
}
