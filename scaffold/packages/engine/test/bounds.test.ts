import { describe, expect, it } from 'vitest';
import { nextPrescription, validateChange, type SessionPlan } from '../src';
import { makeSlot } from './helpers';

function plan(): SessionPlan {
  const bench = nextPrescription(
    makeSlot({ rule: 'double_progression', slotId: 'bench', exerciseId: 'bb_bench', pattern: 'hpress', sets: 4, reps: [6, 8], workingWeight: 100 }),
    [],
  );
  const curl = nextPrescription(
    makeSlot({ rule: 'double_progression', slotId: 'curl', exerciseId: 'db_curl', pattern: 'biceps', sets: 2, reps: [10, 12], workingWeight: 25 }),
    [],
  );
  return { programDayId: 'd', name: 'Upper', weekIndex: 1, prescriptions: [bench, curl] };
}

const mutate = (p: SessionPlan, fn: (draft: SessionPlan) => void): SessionPlan => {
  const draft = structuredClone(p);
  fn(draft);
  return draft;
};

describe('validateChange — the LLM gate (safety_bounds.hard_rule)', () => {
  it('accepts an unchanged plan', () => {
    const cur = plan();
    expect(validateChange(structuredClone(cur), cur)).toMatchObject({ ok: true });
  });

  it('accepts a load change within the 5% bound', () => {
    const cur = plan();
    const ok = mutate(cur, (d) => d.prescriptions[0]!.sets.forEach((s) => (s.weight = 105)));
    expect(validateChange(ok, cur)).toMatchObject({ ok: true });
  });

  it('rejects a load jump above 5%', () => {
    const cur = plan();
    const bad = mutate(cur, (d) => d.prescriptions[0]!.sets.forEach((s) => (s.weight = 110)));
    const r = validateChange(bad, cur);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations[0]).toMatch(/max allowed jump/);
  });

  it('rejects target reps below the compound rep floor (3)', () => {
    const cur = plan();
    const bad = mutate(cur, (d) => (d.prescriptions[0]!.sets[0]!.targetReps = [2, 5]));
    const r = validateChange(bad, cur);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations[0]).toMatch(/rep floor/);
  });

  it('allows low-rep targets on isolation slots (floor is compounds-only)', () => {
    const cur = plan();
    const ok = mutate(cur, (d) => (d.prescriptions[1]!.sets[0]!.targetReps = [2, 5]));
    expect(validateChange(ok, cur)).toMatchObject({ ok: true });
  });

  it('rejects proposals that invent slots', () => {
    const cur = plan();
    const bad = mutate(cur, (d) => {
      const extra = structuredClone(d.prescriptions[0]!);
      extra.slotId = 'sneaky-new-slot';
      d.prescriptions.push(extra);
    });
    const r = validateChange(bad, cur);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations[0]).toMatch(/invent/);
  });

  it('rejects weekly sets above 22 per pattern (with weekly context)', () => {
    const cur = plan();
    const r = validateChange(structuredClone(cur), cur, { weeklySetsByPattern: { hpress: 19 } });
    expect(r.ok).toBe(false); // 4 in-session + 19 elsewhere = 23 > 22
    if (!r.ok) expect(r.violations[0]).toMatch(/exceeds max/);
  });

  it('rejects weekly sets below the plan minimum of 6 (with weekly context)', () => {
    const cur = plan();
    const bad = mutate(cur, (d) => (d.prescriptions[0]!.sets = d.prescriptions[0]!.sets.slice(0, 1)));
    const r = validateChange(bad, cur, { weeklySetsByPattern: { hpress: 2 } });
    expect(r.ok).toBe(false); // 1 + 2 = 3 < 6
    if (!r.ok) expect(r.violations[0]).toMatch(/below plan minimum/);
  });

  it('collects every violation, not just the first', () => {
    const cur = plan();
    const bad = mutate(cur, (d) => {
      d.prescriptions[0]!.sets.forEach((s) => (s.weight = 150));
      d.prescriptions[0]!.sets[0]!.targetReps = [1, 3];
    });
    const r = validateChange(bad, cur);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.length).toBeGreaterThanOrEqual(2);
  });
});
