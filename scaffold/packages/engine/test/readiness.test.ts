import { describe, expect, it } from 'vitest';
import { applyReadiness, nextPrescription, type SessionPlan } from '../src';
import { history, makeSlot } from './helpers';

function demoSession(): SessionPlan {
  const top = nextPrescription(
    makeSlot({
      rule: 'top_set_backoff',
      slotId: 'bench',
      exerciseId: 'bb_bench',
      pattern: 'hpress',
      sets: undefined,
      reps: undefined,
      top: { sets: 1, reps: [4, 6] },
      backoff: { sets: 3, reps: [6, 8], pct_of_top: 0.85 },
      topWeight: 200,
    }),
    [],
  );
  const row = nextPrescription(
    makeSlot({ rule: 'double_progression', slotId: 'row', exerciseId: 'bb_row', pattern: 'hpull', sets: 4, reps: [6, 8], workingWeight: 100 }),
    [],
  );
  const curl = nextPrescription(
    makeSlot({ rule: 'double_progression', slotId: 'curl', exerciseId: 'db_curl', pattern: 'biceps', sets: 2, reps: [10, 12], workingWeight: 25 }),
    [],
  );
  return { programDayId: 'd1', name: 'Upper — Strength', weekIndex: 1, prescriptions: [top, row, curl] };
}

describe('applyReadiness', () => {
  it('green: session as planned', () => {
    const s = demoSession();
    const out = applyReadiness(s, 'green');
    expect(out.readinessApplied).toBe('green');
    expect(out.prescriptions).toEqual(s.prescriptions);
  });

  it('yellow: removes exactly one back-off/accessory set per compound slot, loads unchanged', () => {
    const out = applyReadiness(demoSession(), 'yellow');
    const [top, row, curl] = out.prescriptions;
    expect(top!.sets).toHaveLength(3); // 1 top + 2 backoffs
    expect(top!.sets[0]).toMatchObject({ kind: 'top', weight: 200 });
    expect(row!.sets).toHaveLength(3); // 4 → 3
    expect(row!.sets.every((s) => s.weight === 100)).toBe(true); // loads unchanged
    expect(curl!.sets).toHaveLength(2); // isolation untouched
  });

  it('red: 80% loads, volume −30%, no top sets', () => {
    const out = applyReadiness(demoSession(), 'red');
    const [top, row, curl] = out.prescriptions;
    expect(top!.sets.every((s) => s.kind !== 'top')).toBe(true);
    expect(top!.sets).toHaveLength(2); // 3 backoffs → round(2.1) = 2
    expect(top!.sets.every((s) => s.weight === 135)).toBe(true); // round(170 × 0.8 = 136) → 135
    expect(row!.sets).toHaveLength(3); // round(4 × 0.7 = 2.8) → 3
    expect(row!.sets.every((s) => s.weight === 80)).toBe(true);
    expect(curl!.sets).toHaveLength(1); // round(1.4) = 1
    expect(curl!.sets[0]!.weight).toBe(20); // 25 × 0.8
  });

  it('never increases load or volume for any readiness value', () => {
    const s = demoSession();
    for (const r of ['green', 'yellow', 'red'] as const) {
      const out = applyReadiness(s, r);
      for (const p of out.prescriptions) {
        const before = s.prescriptions.find((x) => x.slotId === p.slotId)!;
        expect(p.sets.length).toBeLessThanOrEqual(before.sets.length);
        const maxBefore = Math.max(...before.sets.map((x) => x.weight ?? 0));
        const maxAfter = Math.max(...p.sets.map((x) => x.weight ?? 0));
        expect(maxAfter).toBeLessThanOrEqual(maxBefore);
      }
    }
  });
});
