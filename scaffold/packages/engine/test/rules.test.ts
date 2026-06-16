import { describe, expect, it } from 'vitest';
import { nextPrescription } from '../src';
import { history, makeSlot } from './helpers';

// Part D test requirement 1: unit per rule against scripted histories,
// asserting exact next-session prescriptions.

describe('novice_linear', () => {
  const squat = () =>
    makeSlot({ rule: 'novice_linear', exerciseId: 'bb_back_squat', pattern: 'squat', sets: 3, reps: [5, 5], workingWeight: 100 });

  it('prescribes the working weight with no history', () => {
    const p = nextPrescription(squat(), []);
    expect(p.sets).toHaveLength(3);
    expect(p.sets.every((s) => s.weight === 100)).toBe(true);
    expect(p.sets.every((s) => s.targetReps[0] === 5)).toBe(true);
  });

  it('asks to establish a weight when none is known', () => {
    const p = nextPrescription(makeSlot({ rule: 'novice_linear', workingWeight: undefined }), []);
    expect(p.sets.every((s) => s.weight === undefined)).toBe(true);
    expect(p.note).toMatch(/establish/i);
  });

  it('adds 5 lb to lower-body lifts after a complete session', () => {
    const p = nextPrescription(squat(), history('bb_back_squat', [[100, [5, 5, 5]]]));
    expect(p.sets.every((s) => s.weight === 105)).toBe(true);
    expect(p.nextState.workingWeight).toBe(105);
  });

  it('adds 2.5 lb to upper-body lifts after a complete session', () => {
    const bench = makeSlot({ rule: 'novice_linear', exerciseId: 'bb_bench', pattern: 'hpress', workingWeight: 100 });
    const p = nextPrescription(bench, history('bb_bench', [[100, [5, 5, 5]]]));
    expect(p.sets.every((s) => s.weight === 102.5)).toBe(true);
  });

  it('clamps the jump to the 5% safety bound on heavy lifts (already within bound)', () => {
    const heavy = { ...squat(), workingWeight: 400 };
    const p = nextPrescription(heavy, history('bb_back_squat', [[400, [5, 5, 5]]]));
    expect(p.sets[0]!.weight).toBe(405); // 5 lb = 1.25% — fine
  });

  it('repeats the same load after one failed session', () => {
    const p = nextPrescription(squat(), history('bb_back_squat', [[100, [5, 4, 3]]]));
    expect(p.sets.every((s) => s.weight === 100)).toBe(true);
    expect(p.note).toMatch(/repeat/i);
  });

  it('micro-deloads 10% after 2 consecutive failed sessions', () => {
    const p = nextPrescription(
      squat(),
      history('bb_back_squat', [
        [100, [5, 4, 3]],
        [100, [5, 4, 4]],
      ]),
    );
    expect(p.sets.every((s) => s.weight === 90)).toBe(true);
    expect(p.nextState.stallCycles).toBe(1);
    expect(p.note).toMatch(/micro-deload/i);
  });

  it('one fail at the deloaded weight does not immediately re-stall', () => {
    const p = nextPrescription(
      { ...squat(), workingWeight: 90, stallCycles: 1 },
      history('bb_back_squat', [
        [100, [5, 4, 3]],
        [100, [5, 4, 4]],
        [90, [5, 5, 4]],
      ]),
    );
    expect(p.sets.every((s) => s.weight === 90)).toBe(true); // repeat, not deload
    expect(p.nextState.stallCycles).toBe(1);
  });

  it('graduates to double progression on the 3rd stall cycle', () => {
    const p = nextPrescription(
      { ...squat(), stallCycles: 2 },
      history('bb_back_squat', [
        [100, [5, 4, 3]],
        [100, [5, 4, 4]],
      ]),
    );
    expect(p.nextState.rule).toBe('double_progression');
    expect(p.nextState.stallCycles).toBe(3);
    expect(p.sets.every((s) => s.weight === 90)).toBe(true);
    expect(p.note).toMatch(/graduated/i);
  });

  it('is idempotent: same history twice does not double-apply', () => {
    const h = history('bb_back_squat', [[100, [5, 5, 5]]]);
    const p1 = nextPrescription(squat(), h);
    const p2 = nextPrescription(p1.nextState, h);
    expect(p2.sets.every((s) => s.weight === 105)).toBe(true); // not 110
    expect(p2.nextState.workingWeight).toBe(105);
  });
});

describe('double_progression', () => {
  const bench = () =>
    makeSlot({ rule: 'double_progression', exerciseId: 'bb_bench', pattern: 'hpress', sets: 4, reps: [6, 8], workingWeight: 100 });

  it('holds the load while inside the rep range', () => {
    const p = nextPrescription(bench(), history('bb_bench', [[100, [8, 8, 7, 6]]]));
    expect(p.sets.every((s) => s.weight === 100)).toBe(true);
    expect(p.sets.every((s) => s.targetReps[0] === 6 && s.targetReps[1] === 8)).toBe(true);
  });

  it('adds load when ALL sets hit the top of the range', () => {
    const p = nextPrescription(bench(), history('bb_bench', [[100, [8, 8, 8, 8]]]));
    expect(p.sets.every((s) => s.weight === 105)).toBe(true); // upper-body +5
  });

  it('adds 10 lb on lower-body compounds (within the 5% bound)', () => {
    const press = makeSlot({ rule: 'double_progression', exerciseId: 'leg_press', pattern: 'squat', sets: 3, reps: [10, 12], workingWeight: 270 });
    const p = nextPrescription(press, history('leg_press', [[270, [12, 12, 12]]]));
    expect(p.sets[0]!.weight).toBe(280); // 10 ≤ 5% of 270 = 13.5
  });

  it('clamps the lower-body increment when 10 lb would exceed 5%', () => {
    const press = makeSlot({ rule: 'double_progression', exerciseId: 'leg_press', pattern: 'squat', sets: 3, reps: [10, 12], workingWeight: 150 });
    const p = nextPrescription(press, history('leg_press', [[150, [12, 12, 12]]]));
    // 5% of 150 = 7.5 → quantized to 7.5
    expect(p.sets[0]!.weight).toBe(157.5);
  });

  it('uses the 2.5 lb isolation increment', () => {
    const curl = makeSlot({ rule: 'double_progression', exerciseId: 'db_curl', pattern: 'biceps', sets: 2, reps: [10, 12], workingWeight: 25 });
    const p = nextPrescription(curl, history('db_curl', [[25, [12, 12]]]));
    expect(p.sets[0]!.weight).toBe(27.5);
  });

  it('first stall suggests a ladder swap (no load change)', () => {
    const flat: [number, number[]][] = [
      [100, [7, 7, 6, 6]],
      [100, [7, 7, 6, 6]],
      [100, [7, 7, 6, 6]],
    ];
    const p = nextPrescription(bench(), history('bb_bench', flat));
    expect(p.nextState.pendingVariationAdvance).toBe(true);
    expect(p.nextState.lastStallAction).toBe('swap');
    expect(p.sets.every((s) => s.weight === 100)).toBe(true);
  });

  it('second stall micro-deloads 7.5% (alternation)', () => {
    const flat: [number, number[]][] = [
      [100, [7, 7, 6, 6]],
      [100, [7, 7, 6, 6]],
      [100, [7, 7, 6, 6]],
    ];
    const p = nextPrescription({ ...bench(), lastStallAction: 'swap' }, history('bb_bench', flat));
    expect(p.nextState.lastStallAction).toBe('deload');
    expect(p.sets.every((s) => s.weight === 92.5)).toBe(true); // 100 × 0.925
  });
});

describe('top_set_backoff', () => {
  const bench = () =>
    makeSlot({
      rule: 'top_set_backoff',
      exerciseId: 'bb_bench',
      pattern: 'hpress',
      sets: undefined,
      reps: undefined,
      top: { sets: 1, reps: [4, 6] },
      backoff: { sets: 3, reps: [6, 8], pct_of_top: 0.85 },
      topWeight: 200,
    });

  it('prescribes top + back-offs at 85%', () => {
    const p = nextPrescription(bench(), []);
    expect(p.sets).toHaveLength(4);
    expect(p.sets[0]).toMatchObject({ kind: 'top', weight: 200 });
    expect(p.sets.slice(1).every((s) => s.kind === 'backoff' && s.weight === 170)).toBe(true);
  });

  it('raises the top when the top-rep target is hit', () => {
    const p = nextPrescription(bench(), history('bb_bench', [[200, [6, 8, 8, 7]]]));
    expect(p.sets[0]!.weight).toBe(202.5);
    expect(p.nextState.topWeight).toBe(202.5);
    expect(p.sets[1]!.weight).toBe(172.5); // round(202.5 × 0.85 = 172.1) → 172.5
  });

  it('holds the top while reps are below target', () => {
    const p = nextPrescription(bench(), history('bb_bench', [[200, [5, 8, 8, 8]]]));
    expect(p.sets[0]!.weight).toBe(200);
  });

  it('flat e1RM across 3 sessions triggers a lift deload week (−15%, −1 set)', () => {
    const flat: [number, number[]][] = [
      [200, [5, 8, 8, 8]],
      [200, [5, 8, 8, 8]],
      [200, [5, 8, 8, 8]],
    ];
    const p = nextPrescription(bench(), history('bb_bench', flat));
    expect(p.sets[0]).toMatchObject({ kind: 'top', weight: 170 }); // 200 × 0.85
    expect(p.sets.filter((s) => s.kind === 'backoff')).toHaveLength(2); // −1 set
    expect(p.nextState.stallRecovery).toBe('deload');
  });

  it('after the deload week, resumes at 80% back-offs for one week, then normal', () => {
    const flat: [number, number[]][] = [
      [200, [5, 8, 8, 8]],
      [200, [5, 8, 8, 8]],
      [200, [5, 8, 8, 8]],
    ];
    const stallP = nextPrescription(bench(), history('bb_bench', flat));
    // user performs the deload session
    const h2 = [...history('bb_bench', flat), ...history('bb_bench', [[170, [6, 8, 8]]], 10)];
    const resumeP = nextPrescription(stallP.nextState, h2);
    expect(resumeP.sets[0]!.weight).toBe(200); // back to the pre-deload top
    expect(resumeP.sets[1]!.weight).toBe(160); // 200 × 0.80
    expect(resumeP.sets.filter((s) => s.kind === 'backoff')).toHaveLength(3);
    expect(resumeP.nextState.stallRecovery).toBe('resume080');

    // resume week performed → stallRecovery clears, normal rules apply
    const h3 = [...h2, ...history('bb_bench', [[200, [6, 8, 8, 8]]], 20)];
    const normalP = nextPrescription(resumeP.nextState, h3);
    expect(normalP.nextState.stallRecovery).toBeUndefined();
    expect(normalP.sets[0]!.weight).toBe(202.5); // hit 6 on the resume top → progress
    expect(normalP.sets[1]!.weight).toBe(172.5);
  });
});

describe('rep_progression', () => {
  const pushup = () =>
    makeSlot({ rule: 'rep_progression', exerciseId: 'pushup', pattern: 'hpress', sets: 3, reps: [8, 12], workingWeight: undefined });

  it('starts at the bottom of the range', () => {
    const p = nextPrescription(pushup(), []);
    expect(p.sets.every((s) => s.targetReps[0] === 8 && s.weight === undefined)).toBe(true);
  });

  it('adds 2 reps per set after a completed session', () => {
    const p = nextPrescription(pushup(), history('pushup', [[0, [8, 8, 8]]]));
    expect(p.nextState.repTarget).toBe(10);
    expect(p.sets.every((s) => s.targetReps[0] === 10)).toBe(true);
  });

  it('caps at 15 then advances the variation and resets', () => {
    const slot = { ...pushup(), repTarget: 15 };
    const p = nextPrescription(slot, history('pushup', [[0, [15, 15, 15]]]));
    expect(p.nextState.pendingVariationAdvance).toBe(true);
    expect(p.nextState.repTarget).toBe(8);
    expect(p.note).toMatch(/advance/i);
  });

  it('adds one set (max +1) after three flat sessions', () => {
    const slot = { ...pushup(), repTarget: 10 };
    const flat: [number, number[]][] = [
      [0, [9, 9, 8]],
      [0, [9, 9, 8]],
      [0, [9, 9, 8]],
    ];
    const p = nextPrescription(slot, history('pushup', flat));
    expect(p.sets).toHaveLength(4);
    expect(p.nextState.sets).toBe(4);
  });
});

describe('timed_progression', () => {
  const plank = () =>
    makeSlot({ rule: 'timed_progression', exerciseId: 'plank', pattern: 'core', sets: 3, reps: [30, 60] });

  it('starts at the bottom of the time range', () => {
    const p = nextPrescription(plank(), []);
    expect(p.sets.every((s) => s.targetSeconds === 30)).toBe(true);
  });

  it('adds 15s after a completed session', () => {
    const p = nextPrescription(plank(), history('plank', [[0, [30, 30, 30]]]));
    expect(p.nextState.repTarget).toBe(45);
    expect(p.sets.every((s) => s.targetSeconds === 45)).toBe(true);
  });

  it('advances the variation at the 75s cap', () => {
    const slot = { ...plank(), repTarget: 75 };
    const p = nextPrescription(slot, history('plank', [[0, [75, 75, 75]]]));
    expect(p.nextState.pendingVariationAdvance).toBe(true);
    expect(p.nextState.repTarget).toBe(30);
  });

  it('renders conditioning blocks as a fixed duration', () => {
    const cond = makeSlot({
      rule: 'timed_progression',
      exerciseId: 'bike_intervals',
      pattern: 'cond',
      sets: undefined,
      reps: undefined,
      duration_min: 10,
    });
    const p = nextPrescription(cond, []);
    expect(p.sets).toHaveLength(1);
    expect(p.sets[0]!.targetSeconds).toBe(600);
  });
});

describe('onramp_pct', () => {
  const squat = (week: number, weight?: number) =>
    makeSlot({ rule: 'onramp_pct', exerciseId: 'bb_back_squat', pattern: 'squat', sets: 3, reps: [8, 8], workingWeight: weight, onrampWeek: week });

  it.each([
    [1, 0.6, 120],
    [2, 0.7, 140],
    [3, 0.8, 160],
    [4, 0.9, 180],
  ])('week %i prescribes %f of last-known loads', (week, _pct, expected) => {
    const p = nextPrescription(squat(week, 200), []);
    expect(p.sets.every((s) => s.weight === expected)).toBe(true);
    expect(p.note).toMatch(/No PR attempts/);
  });

  it('caps at RPE 6 when no load is known', () => {
    const p = nextPrescription(squat(1, undefined), []);
    expect(p.sets.every((s) => s.weight === undefined)).toBe(true);
    expect(p.note).toMatch(/RPE 6/);
  });

  it('graduates at week 5', () => {
    const p = nextPrescription(squat(5, 200), []);
    expect(p.note).toMatch(/graduate/i);
    expect(p.sets.every((s) => s.weight === 200)).toBe(true);
  });
});

describe('pain flag', () => {
  it('freezes progression entirely', () => {
    const slot = makeSlot({ rule: 'novice_linear', exerciseId: 'bb_back_squat', pattern: 'squat', workingWeight: 100, painFlagged: true });
    const p = nextPrescription(slot, history('bb_back_squat', [[100, [5, 5, 5]]]));
    expect(p.sets.every((s) => s.weight === 100)).toBe(true); // no +5
    expect(p.nextState).toEqual(slot); // state untouched
    expect(p.note).toMatch(/professional/i);
  });
});
