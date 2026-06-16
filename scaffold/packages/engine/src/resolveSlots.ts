import { archetypeById, exerciseCatalog, swapLadders } from './data';
import type {
  ArchetypeId,
  ArchetypeSlot,
  EquipmentAccess,
  Experience,
  ProgramPlan,
  ProgramPlanSlot,
  SlotState,
} from './types';

/** Exercise-equipment kinds available for each access level. */
const EQUIPMENT_ACCESS: Record<EquipmentAccess, ReadonlySet<string>> = {
  full_gym: new Set(['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'band']),
  home_barbell: new Set(['barbell', 'bodyweight', 'band']),
  dumbbell: new Set(['dumbbell', 'bodyweight', 'band']),
  bodyweight: new Set(['bodyweight', 'band']),
};

/**
 * Resolve a slot's exercise: keep the primary when the user can perform it,
 * otherwise walk the pattern's swap ladder for the first exercise matching
 * the user's equipment and level cap. Novice level cap (safety_bounds):
 * experience 'new' may only select exercises with level ≤ 1; the cap relaxes
 * before equipment does (equipment is physical, skill is coachable).
 */
export function resolveExercise(
  slot: ArchetypeSlot,
  equipment: EquipmentAccess,
  level: Experience,
): string {
  const allowed = EQUIPMENT_ACCESS[equipment];
  const levelCap = level === 'new' ? 1 : 3;
  const fits = (exId: string, cap: number): boolean => {
    const ex = exerciseCatalog[exId];
    return !!ex && allowed.has(ex.equipment) && ex.level <= cap;
  };

  if (fits(slot.primary, levelCap)) return slot.primary;
  const ladder = swapLadders[slot.pattern] ?? [];
  for (const exId of ladder) if (fits(exId, levelCap)) return exId;
  for (const exId of ladder) if (fits(exId, 3)) return exId; // relax level cap
  return slot.primary; // nothing matches the equipment — surface the primary rather than nothing
}

let counter = 0;
const defaultId = (kind: string) => `${kind}_${(++counter).toString(36)}_${Date.now().toString(36)}`;

/**
 * Instantiate an archetype into a concrete ProgramPlan for one user (Part D):
 * walks swap_ladders for equipment, applies the novice level cap, and seeds
 * each slot's progression state.
 *
 * `idFn` lets the app supply real UUIDs (the engine is pure and has no
 * crypto); tests pass a deterministic counter.
 */
export function instantiateProgram(
  archetypeId: ArchetypeId,
  equipment: EquipmentAccess,
  level: Experience,
  idFn: (kind: 'day' | 'slot') => string = defaultId,
): ProgramPlan {
  const archetype = archetypeById.get(archetypeId);
  if (!archetype) throw new Error(`unknown archetype: ${archetypeId}`);

  const days = archetype.sessions.map((session, dayIndex) => {
    const dayId = idFn('day');
    const slots: ProgramPlanSlot[] = session.slots.map((slot, slotIndex) => {
      const slotId = idFn('slot');
      const exerciseId = resolveExercise(slot, equipment, level);
      const state: SlotState = {
        slotId,
        exerciseId,
        pattern: slot.pattern,
        rule: slot.rule,
        rest_s: slot.rest_s,
        sets: slot.sets,
        reps: slot.reps,
        top: slot.top,
        backoff: slot.backoff,
        duration_min: slot.duration_min,
        stallCycles: 0,
        ...(slot.rule === 'onramp_pct' ? { onrampWeek: 1 } : null),
      };
      return {
        slotId,
        slotIndex,
        pattern: slot.pattern,
        exerciseId,
        rule: slot.rule,
        rest_s: slot.rest_s,
        scheme: {
          sets: slot.sets,
          reps: slot.reps,
          top: slot.top,
          backoff: slot.backoff,
          duration_min: slot.duration_min,
        },
        state,
        note: slot.note,
      };
    });
    return { dayId, dayIndex, name: session.name, slots };
  });

  return {
    archetypeId,
    name: archetype.name,
    blockWeeks: archetype.block_weeks,
    structure: archetype.structure,
    days,
  };
}
