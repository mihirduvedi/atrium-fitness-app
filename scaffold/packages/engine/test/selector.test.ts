import { describe, expect, it } from 'vitest';
import {
  archetypeById,
  instantiateProgram,
  resolveExercise,
  selectArchetype,
  exerciseCatalog,
  data,
  type DaysPerWeek,
  type EquipmentAccess,
  type Experience,
  type Goal,
  type OnboardingAnswers,
} from '../src';

const GOALS: Goal[] = ['strength', 'muscle', 'fat_loss', 'general'];
const EXPERIENCE: Experience[] = ['new', 'returning', 'intermediate', 'advanced'];
const EQUIPMENT: EquipmentAccess[] = ['full_gym', 'home_barbell', 'dumbbell', 'bodyweight'];
const DAYS: DaysPerWeek[] = [2, 3, 4, 5, 6];

describe('selectArchetype — exhaustiveness (Part D requirement 4)', () => {
  it('every onboarding combination resolves to a valid archetype', () => {
    for (const goal of GOALS)
      for (const experience of EXPERIENCE)
        for (const days_per_week of DAYS)
          for (const equipment of EQUIPMENT) {
            const answers: OnboardingAnswers = { goal, experience, days_per_week, equipment };
            const id = selectArchetype(answers);
            expect(archetypeById.has(id), JSON.stringify(answers)).toBe(true);
          }
  });

  it("no 'new' user is ever assigned more than 4 days", () => {
    for (const goal of GOALS)
      for (const days_per_week of DAYS)
        for (const equipment of EQUIPMENT) {
          const id = selectArchetype({ goal, experience: 'new', days_per_week, equipment });
          expect(archetypeById.get(id)!.days_per_week, `${goal}/${days_per_week}/${equipment} → ${id}`).toBeLessThanOrEqual(4);
        }
  });

  it('matches the matrix on its named cases', () => {
    expect(selectArchetype({ goal: 'strength', experience: 'returning', days_per_week: 4, equipment: 'full_gym' })).toBe('return3');
    expect(selectArchetype({ goal: 'strength', experience: 'intermediate', days_per_week: 4, equipment: 'full_gym' })).toBe('ul4_strength');
    expect(selectArchetype({ goal: 'muscle', experience: 'intermediate', days_per_week: 4, equipment: 'full_gym' })).toBe('ul4_hypertrophy');
    expect(selectArchetype({ goal: 'general', experience: 'new', days_per_week: 3, equipment: 'full_gym' })).toBe('fb3_novice_linear');
    expect(selectArchetype({ goal: 'general', experience: 'intermediate', days_per_week: 2, equipment: 'full_gym' })).toBe('fb2_busy');
    expect(selectArchetype({ goal: 'fat_loss', experience: 'intermediate', days_per_week: 3, equipment: 'full_gym' })).toBe('cut3_fullbody');
    expect(selectArchetype({ goal: 'fat_loss', experience: 'new', days_per_week: 3, equipment: 'dumbbell' })).toBe('db_cut3');
    expect(selectArchetype({ goal: 'muscle', experience: 'advanced', days_per_week: 6, equipment: 'full_gym' })).toBe('ppl6');
    expect(selectArchetype({ goal: 'muscle', experience: 'intermediate', days_per_week: 6, equipment: 'full_gym' })).toBe('ppl_ul5');
    expect(selectArchetype({ goal: 'strength', experience: 'advanced', days_per_week: 3, equipment: 'home_barbell' })).toBe('str3_topset');
    expect(selectArchetype({ goal: 'muscle', experience: 'new', days_per_week: 5, equipment: 'bodyweight' })).toBe('bw_fb3');
  });
});

describe('instantiateProgram / resolveExercise', () => {
  it('keeps catalog primaries for a full-gym intermediate', () => {
    const plan = instantiateProgram('ul4_strength', 'full_gym', 'intermediate');
    expect(plan.days).toHaveLength(4);
    expect(plan.days[0]!.slots[0]!.exerciseId).toBe('bb_bench');
    expect(plan.days[1]!.slots[0]!.exerciseId).toBe('bb_back_squat');
  });

  it('applies the novice level cap: experience new only gets level ≤ 1 exercises', () => {
    for (const a of data.archetypes) {
      const plan = instantiateProgram(a.id, 'full_gym', 'new');
      for (const day of plan.days)
        for (const slot of day.slots) {
          expect(exerciseCatalog[slot.exerciseId]!.level, `${a.id}/${slot.exerciseId}`).toBeLessThanOrEqual(1);
        }
    }
  });

  it('walks the swap ladder when equipment rules an exercise out', () => {
    // leg_press is machine-only; at home with a barbell the ladder yields a barbell/bodyweight squat
    const slot = { pattern: 'squat' as const, primary: 'leg_press', rule: 'double_progression' as const, rest_s: 120, sets: 3, reps: [10, 12] as const };
    const resolved = resolveExercise(slot, 'home_barbell', 'intermediate');
    expect(exerciseCatalog[resolved]!.equipment).not.toBe('machine');
    expect(exerciseCatalog[resolved]!.pattern).toBe('squat');
  });

  it('every archetype instantiates for every equipment/experience combination', () => {
    const equipments: EquipmentAccess[] = ['full_gym', 'home_barbell', 'dumbbell', 'bodyweight'];
    const exps: Experience[] = ['new', 'returning', 'intermediate', 'advanced'];
    for (const a of data.archetypes)
      for (const eq of equipments)
        for (const xp of exps) {
          const plan = instantiateProgram(a.id, eq, xp);
          for (const day of plan.days)
            for (const slot of day.slots) {
              expect(exerciseCatalog[slot.exerciseId], `${a.id}/${eq}/${xp}/${slot.pattern}`).toBeDefined();
            }
        }
  });

  it('seeds slot state with ids from the supplied generator', () => {
    let n = 0;
    const plan = instantiateProgram('ul4_strength', 'full_gym', 'intermediate', (k) => `${k}${++n}`);
    const slot = plan.days[0]!.slots[0]!;
    expect(slot.slotId).toBe(slot.state.slotId);
    expect(slot.state.rule).toBe('top_set_backoff');
    expect(slot.state.stallCycles).toBe(0);
  });
});
