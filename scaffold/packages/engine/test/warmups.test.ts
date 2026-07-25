import { describe, expect, it } from 'vitest';
import { nextPrescription, renderWarmups, type SessionPlan } from '../src';
import { makeSlot } from './helpers';

function sessionPlan(): SessionPlan {
  const bench = nextPrescription(
    makeSlot({
      rule: 'top_set_backoff',
      slotId: 'bench',
      exerciseId: 'bb_bench',
      pattern: 'hpress',
      top: { sets: 1, reps: [4, 6] },
      backoff: { sets: 3, reps: [6, 8], pct_of_top: 0.85 },
      topWeight: 200,
    }),
    [],
  );
  const row = nextPrescription(
    makeSlot({
      rule: 'double_progression',
      slotId: 'row',
      exerciseId: 'bb_row',
      pattern: 'hpull',
      sets: 4,
      reps: [6, 8],
      workingWeight: 100,
    }),
    [],
  );
  const curl = nextPrescription(
    makeSlot({
      rule: 'double_progression',
      slotId: 'curl',
      exerciseId: 'db_curl',
      pattern: 'biceps',
      sets: 2,
      reps: [10, 12],
      workingWeight: 25,
    }),
    [],
  );
  return { programDayId: 'd1', name: 'Upper', weekIndex: 1, prescriptions: [bench, row, curl] };
}

describe('renderWarmups', () => {
  it('prepends first-compound, later-compound, and isolation warmups without changing work indices', () => {
    const out = renderWarmups(sessionPlan());
    const [bench, row, curl] = out.prescriptions;

    expect(bench!.sets.filter((s) => s.isWarmup).map((s) => [s.setIndex, s.weight, s.targetReps[0]])).toEqual([
      [-4, 80, 10],
      [-3, 110, 5],
      [-2, 140, 3],
      [-1, 170, 1],
    ]);
    expect(bench!.sets.filter((s) => !s.isWarmup).map((s) => s.setIndex)).toEqual([0, 1, 2, 3]);

    expect(row!.sets.filter((s) => s.isWarmup).map((s) => [s.setIndex, s.weight, s.targetReps[0]])).toEqual([
      [-2, 60, 5],
      [-1, 80, 2],
    ]);
    expect(curl!.sets.filter((s) => s.isWarmup).map((s) => [s.setIndex, s.weight, s.targetReps[0]])).toEqual([
      [-1, 12.5, 10],
    ]);
  });

  it('renders empty-bar warmups for unknown-load barbell compounds', () => {
    const plan: SessionPlan = {
      programDayId: 'd1',
      name: 'Upper',
      weekIndex: 1,
      prescriptions: [
        nextPrescription(makeSlot({ rule: 'double_progression', workingWeight: undefined }), []),
      ],
    };
    expect(renderWarmups(plan).prescriptions[0]!.sets.filter((s) => s.isWarmup)).toEqual([
      { setIndex: -1, weight: 45, targetReps: [10, 10], kind: 'warmup', isWarmup: true },
    ]);
  });

  it('does not invent warmups when a non-barbell working load is unknown', () => {
    const plan: SessionPlan = {
      programDayId: 'd1',
      name: 'Upper',
      weekIndex: 1,
      prescriptions: [
        nextPrescription(makeSlot({
          rule: 'double_progression',
          exerciseId: 'db_curl',
          pattern: 'biceps',
          workingWeight: undefined,
        }), []),
      ],
    };
    expect(renderWarmups(plan).prescriptions[0]!.sets.some((s) => s.isWarmup)).toBe(false);
  });
});
