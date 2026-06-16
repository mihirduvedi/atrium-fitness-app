import type { Pattern, RepRange, RuleId, SetLog, SlotState } from '../src';

export function makeSlot(overrides: Partial<SlotState> & { rule: RuleId }): SlotState {
  return {
    slotId: 'slot1',
    exerciseId: 'bb_bench',
    pattern: 'hpress' as Pattern,
    rest_s: 120,
    sets: 3,
    reps: [5, 5] as RepRange,
    stallCycles: 0,
    ...overrides,
  };
}

let day = 0;
export const nextDate = (): string => {
  day += 1;
  return `2026-01-${String(day).padStart(2, '0')}`;
};

/** Build one session's SetLogs: session(slot, weight, [reps per set]). */
export function session(
  exerciseId: string,
  weight: number,
  reps: number[],
  date: string,
): SetLog[] {
  return reps.map((r, i) => ({
    exerciseId,
    sessionDate: date,
    setIndex: i,
    weight,
    reps: r,
  }));
}

/** Scripted history: list of [weight, reps[]] sessions on consecutive dates. */
export function history(exerciseId: string, sessions: [number, number[]][], startDay = 1): SetLog[] {
  return sessions.flatMap(([w, reps], si) =>
    session(exerciseId, w, reps, `2026-02-${String(startDay + si).padStart(2, '0')}`),
  );
}
