import {
  doubleProgression,
  noviceLinear,
  onrampPct,
  repProgression,
  timedProgression,
  topSetBackoff,
} from './rules';
import type { Prescription, SetLog, SlotState } from './types';
import { groupSessions } from './util';

/**
 * Dispatch to the slot's progression rule (Part D contract). Pure: callers
 * persist prescription.nextState after planning the session.
 *
 * A pain-flagged slot freezes progression entirely (safety_bounds.pain_flag):
 * the last prescription is repeated verbatim and the user is pointed at a
 * professional.
 */
export function nextPrescription(slot: SlotState, history: SetLog[]): Prescription {
  const sessions = groupSessions(history, slot.exerciseId);

  if (slot.painFlagged) {
    const frozen = dispatch({ ...slot, lastAnalyzedSession: sessions[sessions.length - 1]?.date }, history);
    return {
      ...frozen,
      nextState: { ...slot },
      note: 'progression frozen — pain reported on this lift; consider seeing a professional',
    };
  }
  return dispatch(slot, history);
}

function dispatch(slot: SlotState, history: SetLog[]): Prescription {
  const sessions = groupSessions(history, slot.exerciseId);
  switch (slot.rule) {
    case 'novice_linear':
      return noviceLinear(slot, sessions);
    case 'double_progression':
      return doubleProgression(slot, sessions);
    case 'top_set_backoff':
      return topSetBackoff(slot, sessions);
    case 'rep_progression':
      return repProgression(slot, sessions);
    case 'timed_progression':
      return timedProgression(slot, sessions);
    case 'onramp_pct':
      return onrampPct(slot, sessions);
  }
}
