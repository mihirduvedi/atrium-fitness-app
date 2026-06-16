import { describe, expect, it } from 'vitest';
import { detectStalls, shouldDeload } from '../src';
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
