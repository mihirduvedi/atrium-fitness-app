import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyReadiness,
  COMPOUND_PATTERNS,
  data,
  instantiateProgram,
  maxAllowedJump,
  nextPrescription,
  safetyBounds,
  type Readiness,
  type SessionPlan,
  type SetLog,
  type SlotState,
} from '../src';
import { makeSlot } from './helpers';

// Part D test requirement 2: safety property tests — for ANY history,
// prescriptions never violate safety_bounds.
//
// One documented deviation: max_session_load_jump_pct (5%) has a one-plate
// (2.5 lb) floor below 50 lb, because plates quantize — see maxAllowedJump.
// Every assertion here uses maxAllowedJump as the executable form of the
// bound.

/** Arbitrary history: 0–8 sessions of 1–6 sets with arbitrary loads/reps. */
const arbHistory = (exerciseId: string): fc.Arbitrary<SetLog[]> =>
  fc
    .array(
      fc.record({
        weight: fc.float({ min: 0, max: 500, noNaN: true }).map((w) => Math.round(w * 2) / 2),
        reps: fc.array(fc.integer({ min: 0, max: 20 }), { minLength: 1, maxLength: 6 }),
      }),
      { maxLength: 8 },
    )
    .map((sessions) =>
      sessions.flatMap(({ weight, reps }, si) =>
        reps.map((r, i) => ({
          exerciseId,
          sessionDate: `2026-03-${String(si + 1).padStart(2, '0')}`,
          setIndex: i,
          weight,
          reps: r,
        })),
      ),
    );

const arbWeight = fc.float({ min: Math.fround(20), max: Math.fround(500), noNaN: true }).map((w) => Math.round(w / 2.5) * 2.5);

function maxPrescribed(slot: SlotState, history: SetLog[]): { prescribed: number; baseline: number } | null {
  const p = nextPrescription(slot, history);
  const weights = p.sets.map((s) => s.weight).filter((w): w is number => w !== undefined);
  if (weights.length === 0) return null;
  const own = slot.rule === 'top_set_backoff' ? slot.topWeight : slot.workingWeight;
  const lastDate = history.reduce((m, s) => (s.sessionDate > m ? s.sessionDate : m), '');
  const lastMax = Math.max(0, ...history.filter((s) => s.sessionDate === lastDate).map((s) => s.weight));
  const baseline = own ?? lastMax;
  return { prescribed: Math.max(...weights), baseline };
}

describe('safety properties (fast-check)', () => {
  it('novice_linear never jumps the load beyond the bound, for ANY history', () => {
    fc.assert(
      fc.property(arbWeight, arbHistory('bb_back_squat'), (w, h) => {
        const slot = makeSlot({ rule: 'novice_linear', exerciseId: 'bb_back_squat', pattern: 'squat', sets: 3, reps: [5, 5], workingWeight: w });
        const r = maxPrescribed(slot, h);
        if (!r) return true;
        return r.prescribed <= r.baseline + maxAllowedJump(r.baseline) + 1e-9;
      }),
      { numRuns: 500 },
    );
  });

  it('double_progression never jumps the load beyond the bound, for ANY history', () => {
    fc.assert(
      fc.property(arbWeight, arbHistory('bb_bench'), (w, h) => {
        const slot = makeSlot({ rule: 'double_progression', exerciseId: 'bb_bench', pattern: 'hpress', sets: 4, reps: [6, 8], workingWeight: w });
        const r = maxPrescribed(slot, h);
        if (!r) return true;
        return r.prescribed <= r.baseline + maxAllowedJump(r.baseline) + 1e-9;
      }),
      { numRuns: 500 },
    );
  });

  it('top_set_backoff never raises the top beyond the bound, for ANY history', () => {
    fc.assert(
      fc.property(arbWeight, arbHistory('bb_bench'), (w, h) => {
        const slot = makeSlot({
          rule: 'top_set_backoff', exerciseId: 'bb_bench', pattern: 'hpress',
          sets: undefined, reps: undefined,
          top: { sets: 1, reps: [4, 6] }, backoff: { sets: 3, reps: [6, 8], pct_of_top: 0.85 },
          topWeight: w,
        });
        const p = nextPrescription(slot, h);
        const next = p.nextState.topWeight;
        return next === undefined || next <= w + maxAllowedJump(w) + 1e-9;
      }),
      { numRuns: 500 },
    );
  });

  it('rule chains never violate the bound across consecutive sessions (stateful walk)', () => {
    // simulate N sessions where the user performs exactly what was prescribed
    // minus an arbitrary shortfall, persisting nextState each time
    fc.assert(
      fc.property(
        arbWeight,
        fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 1, maxLength: 12 }),
        (w, shortfalls) => {
          let slot = makeSlot({ rule: 'novice_linear', exerciseId: 'bb_back_squat', pattern: 'squat', sets: 3, reps: [5, 5], workingWeight: w });
          const history: SetLog[] = [];
          let day = 1;
          for (const short of shortfalls) {
            const before = slot.rule === 'top_set_backoff' ? slot.topWeight! : slot.workingWeight!;
            const p = nextPrescription(slot, history);
            for (const set of p.sets) {
              if (set.weight !== undefined && set.weight > before + maxAllowedJump(before) + 1e-9) return false;
            }
            const date = `2026-04-${String(day++).padStart(2, '0')}`;
            for (const set of p.sets) {
              history.push({
                exerciseId: slot.exerciseId,
                sessionDate: date,
                setIndex: set.setIndex,
                weight: set.weight ?? 0,
                reps: Math.max(0, set.targetReps[1] - short),
              });
            }
            slot = p.nextState;
          }
          return true;
        },
      ),
      { numRuns: 300 },
    );
  });

  it('rep floor: every compound prescription in every archetype targets ≥ 3 reps', () => {
    for (const a of data.archetypes) {
      const plan = instantiateProgram(a.id, 'full_gym', 'intermediate');
      for (const day of plan.days)
        for (const slot of day.slots) {
          const p = nextPrescription({ ...slot.state, workingWeight: 100, topWeight: 100 }, []);
          if (COMPOUND_PATTERNS.has(slot.pattern) && slot.rule !== 'timed_progression') {
            for (const set of p.sets) {
              expect(set.targetReps[0], `${a.id}/${slot.exerciseId}`).toBeGreaterThanOrEqual(safetyBounds.rep_floor_compounds);
            }
          }
        }
    }
  });

  it('weekly volume: no archetype prescribes more than 22 weekly sets of any pattern', () => {
    for (const a of data.archetypes) {
      const weeklyMultiplier = a.structure === 'alternate_AB' ? 1.5 : 1;
      const plan = instantiateProgram(a.id, 'full_gym', 'intermediate');
      const perPattern = new Map<string, number>();
      for (const day of plan.days)
        for (const slot of day.slots) {
          const p = nextPrescription({ ...slot.state, workingWeight: 100, topWeight: 100 }, []);
          perPattern.set(slot.pattern, (perPattern.get(slot.pattern) ?? 0) + p.sets.length);
        }
      for (const [pattern, sets] of perPattern) {
        expect(sets * weeklyMultiplier, `${a.id}/${pattern}`).toBeLessThanOrEqual(safetyBounds.max_weekly_sets_per_muscle);
      }
    }
  });

  it('readiness NEVER increases load or volume, for ANY plan and readiness', () => {
    const arbPlan: fc.Arbitrary<SessionPlan> = fc
      .array(
        fc.record({
          slotId: fc.string({ minLength: 1, maxLength: 6 }),
          weight: arbWeight,
          sets: fc.integer({ min: 1, max: 6 }),
          isTop: fc.boolean(),
        }),
        { minLength: 1, maxLength: 6 },
      )
      .map((slots) => ({
        programDayId: 'd',
        name: 'p',
        weekIndex: 1,
        prescriptions: slots.map((s, i) => {
          const slot = makeSlot({
            rule: s.isTop ? 'top_set_backoff' : 'double_progression',
            slotId: `${s.slotId}${i}`,
            ...(s.isTop
              ? { sets: undefined, reps: undefined, top: { sets: 1, reps: [4, 6] as const }, backoff: { sets: s.sets, reps: [6, 8] as const, pct_of_top: 0.85 }, topWeight: s.weight }
              : { sets: s.sets, reps: [6, 8] as const, workingWeight: s.weight }),
          });
          return nextPrescription(slot, []);
        }),
      }));

    fc.assert(
      fc.property(arbPlan, fc.constantFrom<Readiness>('green', 'yellow', 'red'), (plan, readiness) => {
        const out = applyReadiness(plan, readiness);
        for (const p of out.prescriptions) {
          const before = plan.prescriptions.find((x) => x.slotId === p.slotId)!;
          if (p.sets.length > before.sets.length) return false;
          const maxBefore = Math.max(0, ...before.sets.map((s) => s.weight ?? 0));
          const maxAfter = Math.max(0, ...p.sets.map((s) => s.weight ?? 0));
          if (maxAfter > maxBefore + 1e-9) return false;
        }
        return true;
      }),
      { numRuns: 500 },
    );
  });
});
