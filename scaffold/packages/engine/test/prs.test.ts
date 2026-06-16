import { describe, expect, it } from 'vitest';
import { detectPRs, epley1RM, type SetLog, type WorkoutLog } from '../src';
import { history } from './helpers';

const workout = (date: string, sets: Omit<SetLog, 'sessionDate'>[]): WorkoutLog => ({
  workoutId: 'w1',
  date,
  sets: sets.map((s) => ({ ...s, sessionDate: date })),
});

describe('detectPRs', () => {
  // prior best: 100×8 (e1RM 126.7), session volume 1600
  const prior = history('bb_bench', [[100, [8, 8]]], 1); // 2026-02-01

  it('detects all four PR types', () => {
    const w = workout('2026-02-08', [
      { exerciseId: 'bb_bench', setIndex: 0, weight: 105, reps: 7 },
      { exerciseId: 'bb_bench', setIndex: 1, weight: 100, reps: 9 },
    ]);
    const prs = detectPRs(w, prior);
    const byType = Object.fromEntries(prs.map((p) => [p.type, p]));

    expect(byType.weight).toMatchObject({ value: 105, previous: 100 });
    expect(byType.reps_at_weight).toMatchObject({ value: 9, previous: 8 });
    expect(byType.e1rm).toMatchObject({ value: 130, previous: 126.7 }); // 100×9 Epley
    expect(byType.session_volume).toMatchObject({ value: 105 * 7 + 100 * 9, previous: 1600 });
  });

  it('a first-ever performance establishes baselines silently (no PRs)', () => {
    const w = workout('2026-02-08', [{ exerciseId: 'bb_bench', setIndex: 0, weight: 225, reps: 5 }]);
    expect(detectPRs(w, [])).toEqual([]);
  });

  it('warmup sets never count', () => {
    const w = workout('2026-02-08', [
      { exerciseId: 'bb_bench', setIndex: 0, weight: 200, reps: 1, isWarmup: true },
      { exerciseId: 'bb_bench', setIndex: 1, weight: 100, reps: 8 },
    ]);
    expect(detectPRs(w, prior).filter((p) => p.type === 'weight')).toEqual([]);
  });

  it('no PRs when the workout merely matches history', () => {
    const w = workout('2026-02-08', [
      { exerciseId: 'bb_bench', setIndex: 0, weight: 100, reps: 8 },
      { exerciseId: 'bb_bench', setIndex: 1, weight: 100, reps: 8 },
    ]);
    expect(detectPRs(w, prior)).toEqual([]);
  });

  it('history on or after the workout date is ignored', () => {
    const future = history('bb_bench', [[300, [10, 10]]], 20); // 2026-02-20
    const w = workout('2026-02-08', [{ exerciseId: 'bb_bench', setIndex: 0, weight: 105, reps: 8 }]);
    const prs = detectPRs(w, [...prior, ...future]);
    expect(prs.find((p) => p.type === 'weight')).toMatchObject({ value: 105, previous: 100 });
  });

  it('uses Epley for e1RM and treats 1 rep as the weight itself', () => {
    expect(epley1RM(100, 10)).toBeCloseTo(133.33, 1);
    expect(epley1RM(315, 1)).toBe(315);
  });
});
