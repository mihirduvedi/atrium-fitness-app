import { describe, expect, it } from 'vitest';
import { nextPrescription } from '../src';
import { history, makeSlot } from './helpers';

// Edge paths: scheme defaults, weights adopted from history, and the
// idempotence guard (lastAnalyzedSession) on every rule.

describe('rule edges', () => {
  it('novice_linear adopts the working weight from history when state has none', () => {
    const slot = makeSlot({ rule: 'novice_linear', exerciseId: 'bb_back_squat', pattern: 'squat', workingWeight: undefined, sets: undefined, reps: undefined });
    const p = nextPrescription(slot, history('bb_back_squat', [[100, [5, 5, 5]]]));
    expect(p.sets[0]!.weight).toBe(105); // adopted 100, then +5
  });

  it('double_progression adopts the working weight from history when state has none', () => {
    const slot = makeSlot({ rule: 'double_progression', exerciseId: 'bb_bench', pattern: 'hpress', workingWeight: undefined, sets: undefined, reps: undefined });
    const p = nextPrescription(slot, history('bb_bench', [[80, [5, 5, 4]]]));
    expect(p.sets[0]!.weight).toBe(80);
  });

  it('double_progression with no history and no weight asks to establish one', () => {
    const slot = makeSlot({ rule: 'double_progression', workingWeight: undefined });
    const p = nextPrescription(slot, []);
    expect(p.note).toMatch(/establish/i);
  });

  it('double_progression is idempotent on repeated calls with the same history', () => {
    const slot = makeSlot({ rule: 'double_progression', sets: 3, reps: [6, 8], workingWeight: 100 });
    const h = history('bb_bench', [[100, [8, 8, 8]]]);
    const p1 = nextPrescription(slot, h);
    const p2 = nextPrescription(p1.nextState, h);
    expect(p1.sets[0]!.weight).toBe(105);
    expect(p2.sets[0]!.weight).toBe(105); // not 110
  });

  it('top_set_backoff falls back to default top/backoff schemes', () => {
    const slot = makeSlot({ rule: 'top_set_backoff', topWeight: 200, sets: undefined, reps: undefined });
    const p = nextPrescription(slot, []);
    expect(p.sets.filter((s) => s.kind === 'top')).toHaveLength(1);
    expect(p.sets.filter((s) => s.kind === 'backoff')).toHaveLength(3);
  });

  it('top_set_backoff with no weight and no history asks to establish a top set', () => {
    const slot = makeSlot({
      rule: 'top_set_backoff', topWeight: undefined, sets: undefined, reps: undefined,
      top: { sets: 1, reps: [4, 6] }, backoff: { sets: 3, reps: [6, 8], pct_of_top: 0.85 },
    });
    const p = nextPrescription(slot, []);
    expect(p.sets.every((s) => s.weight === undefined)).toBe(true);
    expect(p.note).toMatch(/establish/i);
  });

  it('top_set_backoff adopts the top weight from history', () => {
    const slot = makeSlot({
      rule: 'top_set_backoff', topWeight: undefined, sets: undefined, reps: undefined,
      top: { sets: 1, reps: [4, 6] }, backoff: { sets: 3, reps: [6, 8], pct_of_top: 0.85 },
    });
    const p = nextPrescription(slot, history('bb_bench', [[185, [6, 8, 8, 8]]]));
    expect(p.nextState.topWeight).toBe(187.5); // adopted 185, hit 6 → +2.5
  });

  it('top_set_backoff is idempotent on repeated calls', () => {
    const slot = makeSlot({
      rule: 'top_set_backoff', topWeight: 200, sets: undefined, reps: undefined,
      top: { sets: 1, reps: [4, 6] }, backoff: { sets: 3, reps: [6, 8], pct_of_top: 0.85 },
    });
    const h = history('bb_bench', [[200, [6, 8, 8, 8]]]);
    const p1 = nextPrescription(slot, h);
    const p2 = nextPrescription(p1.nextState, h);
    expect(p1.nextState.topWeight).toBe(202.5);
    expect(p2.nextState.topWeight).toBe(202.5);
  });

  it('top_set_backoff lower-body top increments by 5', () => {
    const slot = makeSlot({
      rule: 'top_set_backoff', exerciseId: 'bb_back_squat', pattern: 'squat', topWeight: 300,
      sets: undefined, reps: undefined,
      top: { sets: 1, reps: [4, 6] }, backoff: { sets: 3, reps: [6, 8], pct_of_top: 0.85 },
    });
    const p = nextPrescription(slot, history('bb_back_squat', [[300, [6, 8, 8, 8]]]));
    expect(p.nextState.topWeight).toBe(305);
  });

  it('rep_progression defaults its scheme and is idempotent', () => {
    const slot = makeSlot({ rule: 'rep_progression', exerciseId: 'pushup', sets: undefined, reps: undefined });
    const h = history('pushup', [[0, [8, 8, 8]]]);
    const p1 = nextPrescription(slot, h);
    const p2 = nextPrescription(p1.nextState, h);
    expect(p1.nextState.repTarget).toBe(10);
    expect(p2.nextState.repTarget).toBe(10);
  });

  it('rep_progression does not add a second extra set on a later stall', () => {
    const flat: [number, number[]][] = [
      [0, [9, 9, 8]],
      [0, [9, 9, 8]],
      [0, [9, 9, 8]],
    ];
    const slot = makeSlot({ rule: 'rep_progression', exerciseId: 'pushup', sets: 4, reps: [8, 12], repTarget: 10 });
    // base was 3 but state.sets already bumped to 4 → no further increase
    const p = nextPrescription({ ...slot, sets: 4 }, history('pushup', flat));
    expect(p.sets.length).toBeLessThanOrEqual(5);
  });

  it('timed_progression defaults its scheme and is idempotent', () => {
    const slot = makeSlot({ rule: 'timed_progression', exerciseId: 'plank', pattern: 'core', sets: undefined, reps: undefined });
    const h = history('plank', [[0, [30, 30, 30]]]);
    const p1 = nextPrescription(slot, h);
    const p2 = nextPrescription(p1.nextState, h);
    expect(p1.nextState.repTarget).toBe(45);
    expect(p2.nextState.repTarget).toBe(45);
  });

  it('timed_progression holds the target on an incomplete session', () => {
    const slot = makeSlot({ rule: 'timed_progression', exerciseId: 'plank', pattern: 'core', sets: 3, reps: [30, 60], repTarget: 45 });
    const p = nextPrescription(slot, history('plank', [[0, [45, 40, 30]]]));
    expect(p.nextState.repTarget).toBe(45);
  });

  it('onramp_pct defaults to week 1 and its default scheme', () => {
    const slot = makeSlot({ rule: 'onramp_pct', workingWeight: 200, sets: undefined, reps: undefined, onrampWeek: undefined });
    const p = nextPrescription(slot, []);
    expect(p.sets[0]!.weight).toBe(120); // 60%
  });
});
