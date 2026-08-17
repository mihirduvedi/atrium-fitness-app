import { describe, expect, it } from 'vitest';
import {
  applySessionDeload,
  detectStalls,
  shouldDeload,
  validateChange,
  type SessionPlan,
} from '../src';
import { history, makeSlot } from './helpers';

describe('detectStalls', () => {
  it('reports a novice stall after 2 consecutive fails and at-risk after 1', () => {
    const slot = makeSlot({ rule: 'novice_linear', exerciseId: 'bb_back_squat', pattern: 'squat', sets: 3, reps: [5, 5], workingWeight: 100 });
    const oneFail = detectStalls([slot], history('bb_back_squat', [[100, [5, 4, 3]]]));
    expect(oneFail.stalled).toHaveLength(0);
    expect(oneFail.atRisk).toHaveLength(1);

    const twoFails = detectStalls(
      [slot],
      history('bb_back_squat', [
        [100, [5, 4, 3]],
        [100, [5, 4, 4]],
      ]),
    );
    expect(twoFails.stalled).toHaveLength(1);
    expect(twoFails.stalled[0]!.reason).toMatch(/2 consecutive/);
  });

  it('reports a double-progression stall after 3 flat sessions', () => {
    const slot = makeSlot({ rule: 'double_progression', exerciseId: 'bb_bench', pattern: 'hpress', sets: 4, reps: [6, 8], workingWeight: 100 });
    const flat: [number, number[]][] = [
      [100, [7, 7, 6, 6]],
      [100, [7, 7, 6, 6]],
      [100, [7, 7, 6, 6]],
    ];
    const r = detectStalls([slot], history('bb_bench', flat));
    expect(r.stalled).toHaveLength(1);
  });

  it('reports a top-set stall on flat e1RM across 3 sessions', () => {
    const slot = makeSlot({
      rule: 'top_set_backoff', exerciseId: 'bb_bench', pattern: 'hpress',
      top: { sets: 1, reps: [4, 6] }, backoff: { sets: 3, reps: [6, 8], pct_of_top: 0.85 }, topWeight: 200,
      sets: undefined, reps: undefined,
    });
    const flat: [number, number[]][] = [
      [200, [5, 8, 8, 8]],
      [200, [5, 8, 8, 8]],
      [200, [5, 8, 8, 8]],
    ];
    expect(detectStalls([slot], history('bb_bench', flat)).stalled).toHaveLength(1);
  });

  it('a progressing lift never stalls', () => {
    const slot = makeSlot({ rule: 'double_progression', exerciseId: 'bb_bench', pattern: 'hpress', sets: 4, reps: [6, 8], workingWeight: 100 });
    const progressing: [number, number[]][] = [
      [100, [7, 7, 6, 6]],
      [100, [8, 7, 7, 6]],
      [100, [8, 8, 8, 8]],
    ];
    const r = detectStalls([slot], history('bb_bench', progressing));
    expect(r.stalled).toHaveLength(0);
    expect(r.atRisk).toHaveLength(0);
  });
});

describe('shouldDeload', () => {
  const noStalls = { stalled: [], atRisk: [] };
  const stall = (id: string) => ({ slotId: id, exerciseId: 'x', rule: 'double_progression' as const, reason: 'r' });

  it('triggers on 2+ stalls in the same week', () => {
    const d = shouldDeload(3, { stalled: [stall('a'), stall('b')], atRisk: [] }, []);
    expect(d).toMatchObject({ deload: true, reason: 'two_plus_stalls_same_week' });
    expect(d.prescription).toEqual({ volumePct: -40, intensityPct: -10, dropTopSets: true, weeks: 1 });
  });

  it('triggers on readiness red 3+ days', () => {
    const d = shouldDeload(3, noStalls, ['red', 'green', 'red', 'yellow', 'red']);
    expect(d).toMatchObject({ deload: true, reason: 'readiness_red_3plus' });
  });

  it('mandatory deload in week 7 when none was triggered earlier', () => {
    expect(shouldDeload(7, noStalls, ['green'])).toMatchObject({ deload: true, reason: 'scheduled_week_7' });
    expect(shouldDeload(7, noStalls, [], { deloadAlreadyThisBlock: true })).toMatchObject({ deload: false });
  });

  it('otherwise: no deload', () => {
    expect(shouldDeload(5, { stalled: [stall('a')], atRisk: [] }, ['red', 'red', 'green'])).toMatchObject({ deload: false, reason: 'none' });
  });
});

describe('applySessionDeload', () => {
  const plan = (): SessionPlan => ({
    programDayId: 'upper',
    name: 'Upper Strength',
    weekIndex: 7,
    prescriptions: [
      {
        slotId: 'bench',
        exerciseId: 'bb_bench',
        rule: 'top_set_backoff',
        rest_s: 180,
        sets: [
          { setIndex: -2, weight: 45, targetReps: [5, 5], kind: 'warmup', isWarmup: true },
          { setIndex: -1, weight: 135, targetReps: [3, 3], kind: 'warmup', isWarmup: true },
          { setIndex: 0, weight: 200, targetReps: [4, 6], kind: 'top' },
          { setIndex: 1, weight: 170, targetReps: [6, 8], kind: 'backoff' },
          { setIndex: 2, weight: 170, targetReps: [6, 8], kind: 'backoff' },
          { setIndex: 3, weight: 170, targetReps: [6, 8], kind: 'backoff' },
        ],
        nextState: makeSlot({
          slotId: 'bench',
          exerciseId: 'bb_bench',
          pattern: 'hpress',
          rule: 'top_set_backoff',
          top: { sets: 1, reps: [4, 6] },
          backoff: { sets: 3, reps: [6, 8], pct_of_top: 0.85 },
          topWeight: 200,
          sets: undefined,
          reps: undefined,
        }),
      },
      {
        slotId: 'row',
        exerciseId: 'bb_row',
        rule: 'double_progression',
        rest_s: 150,
        sets: [0, 1, 2].map((setIndex) => ({
          setIndex,
          weight: 135,
          targetReps: [6, 8] as const,
          kind: 'work' as const,
        })),
        nextState: makeSlot({
          slotId: 'row',
          exerciseId: 'bb_row',
          pattern: 'hpull',
          rule: 'double_progression',
          sets: 3,
          reps: [6, 8],
          workingWeight: 135,
        }),
      },
    ],
  });

  it('drops top sets, lowers load, and approximates a 40% working-set reduction', () => {
    const current = plan();
    const deloaded = applySessionDeload(current);
    const bench = deloaded.prescriptions[0]!;
    const row = deloaded.prescriptions[1]!;

    expect(bench.sets.some((set) => set.kind === 'top')).toBe(false);
    expect(bench.sets.filter((set) => !set.isWarmup)).toHaveLength(2);
    expect(bench.sets.filter((set) => !set.isWarmup).map((set) => set.weight)).toEqual([152.5, 152.5]);
    expect(bench.sets.filter((set) => set.isWarmup).map((set) => set.weight)).toEqual([40, 122.5]);
    expect(row.sets).toHaveLength(2);
    expect(row.sets.map((set) => set.weight)).toEqual([122.5, 122.5]);
    expect(bench.sets.map((set) => set.setIndex)).toEqual([-2, -1, 0, 1]);
    expect(row.sets.map((set) => set.setIndex)).toEqual([0, 1]);
    expect(deloaded.notes).toContain('Engine session deload: one workout only');
    expect(validateChange(deloaded, current)).toMatchObject({ ok: true });
  });

  it('preserves plan identity, rep ranges, rest, progression state, and input immutability', () => {
    const current = plan();
    const snapshot = JSON.stringify(current);
    const deloaded = applySessionDeload(current);

    expect(JSON.stringify(current)).toBe(snapshot);
    expect(deloaded.programDayId).toBe(current.programDayId);
    expect(deloaded.prescriptions.map((item) => item.exerciseId)).toEqual(
      current.prescriptions.map((item) => item.exerciseId),
    );
    expect(deloaded.prescriptions.map((item) => item.rest_s)).toEqual(
      current.prescriptions.map((item) => item.rest_s),
    );
    expect(deloaded.prescriptions.map((item) => item.nextState)).toEqual(
      current.prescriptions.map((item) => item.nextState),
    );
    expect(deloaded.prescriptions[0]!.sets.filter((set) => !set.isWarmup).every((set) => (
      set.targetReps[0] === 6 && set.targetReps[1] === 8
    ))).toBe(true);
  });

  it('keeps top-only movements usable by converting one lowered set to ordinary work', () => {
    const current = plan();
    current.prescriptions[0] = {
      ...current.prescriptions[0]!,
      sets: [
        { setIndex: -1, weight: 45, targetReps: [5, 5], kind: 'warmup', isWarmup: true },
        { setIndex: 0, weight: 200, targetReps: [4, 6], kind: 'top' },
        { setIndex: 1, weight: 190, targetReps: [4, 6], kind: 'top' },
      ],
    };

    const deloaded = applySessionDeload(current);
    const bench = deloaded.prescriptions[0]!;
    expect(bench.sets).toEqual([
      { setIndex: -1, weight: 40, targetReps: [5, 5], kind: 'warmup', isWarmup: true },
      { setIndex: 0, weight: 180, targetReps: [4, 6], kind: 'work' },
    ]);
    expect(bench.sets.some((set) => set.kind === 'top')).toBe(false);
    expect(bench.sets.filter((set) => !set.isWarmup)).toHaveLength(1);
    expect(validateChange(deloaded, current)).toMatchObject({ ok: true });
  });
});
