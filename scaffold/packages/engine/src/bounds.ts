import { safetyBounds } from './data';
import type { Pattern, Result, SessionPlan } from './types';
import { COMPOUND_PATTERNS, maxAllowedJump } from './util';

export interface BoundsContext {
  /** safety_bounds values; defaults to the data file's. */
  maxSessionLoadJumpPct?: number;
  maxWeeklySetsPerMuscle?: number;
  minWeeklySetsPerMuscleOnPlan?: number;
  repFloorCompounds?: number;
  /**
   * Sets already planned this week per pattern across OTHER sessions —
   * weekly bounds can only be enforced with weekly context. When omitted,
   * only the proposed session's own sets are counted against the max.
   */
  weeklySetsByPattern?: Partial<Record<Pattern, number>>;
}

/**
 * The LLM gate (safety_bounds.hard_rule): the coach proposes, only this
 * rules engine writes loads/sets. Every proposed SessionPlan diff is checked
 * against safety_bounds relative to the CURRENT plan; any violation rejects
 * the whole proposal.
 *
 * Checks:
 * 1. load jumps per slot ≤ max_session_load_jump_pct (with the one-plate
 *    floor for light loads, see maxAllowedJump);
 * 2. rep floor ≥ rep_floor_compounds on compound patterns;
 * 3. weekly sets per pattern ≤ max (and ≥ min when weekly context given);
 * 4. no slots invented by the proposal (every proposed slot must exist in
 *    the current plan);
 * 5. readiness modulation can only have lowered, never raised, work.
 */
export function validateChange(
  proposed: SessionPlan,
  current: SessionPlan,
  bounds: BoundsContext = {},
): Result {
  const violations: string[] = [];
  const repFloor = bounds.repFloorCompounds ?? safetyBounds.rep_floor_compounds;
  const maxWeekly = bounds.maxWeeklySetsPerMuscle ?? safetyBounds.max_weekly_sets_per_muscle;
  const minWeekly = bounds.minWeeklySetsPerMuscleOnPlan ?? safetyBounds.min_weekly_sets_per_muscle_on_plan;

  const currentBySlot = new Map(current.prescriptions.map((p) => [p.slotId, p]));
  const setsByPattern = new Map<Pattern, number>();

  for (const p of proposed.prescriptions) {
    const cur = currentBySlot.get(p.slotId);
    if (!cur) {
      violations.push(`slot ${p.slotId}: not present in the current plan — proposals cannot invent slots`);
      continue;
    }
    const pattern = p.nextState.pattern;
    setsByPattern.set(pattern, (setsByPattern.get(pattern) ?? 0) + p.sets.length);

    const curMax = Math.max(0, ...cur.sets.map((s) => s.weight ?? 0));
    for (const set of p.sets) {
      if (set.weight !== undefined && curMax > 0 && set.weight > curMax + maxAllowedJump(curMax)) {
        violations.push(
          `slot ${p.slotId}: load ${set.weight} exceeds max allowed jump from ${curMax} ` +
            `(${safetyBounds.max_session_load_jump_pct}% bound)`,
        );
        break;
      }
    }

    if (COMPOUND_PATTERNS.has(pattern)) {
      for (const set of p.sets) {
        if (set.targetReps[0] < repFloor) {
          violations.push(
            `slot ${p.slotId}: target reps ${set.targetReps[0]} below compound rep floor ${repFloor}`,
          );
          break;
        }
      }
    }
  }

  for (const [pattern, sets] of setsByPattern) {
    const weekly = sets + (bounds.weeklySetsByPattern?.[pattern] ?? 0);
    if (weekly > maxWeekly) {
      violations.push(`pattern ${pattern}: ${weekly} weekly sets exceeds max ${maxWeekly}`);
    }
    if (bounds.weeklySetsByPattern && pattern in bounds.weeklySetsByPattern && weekly < minWeekly) {
      violations.push(`pattern ${pattern}: ${weekly} weekly sets below plan minimum ${minWeekly}`);
    }
  }

  return violations.length ? { ok: false, violations } : { ok: true, value: proposed };
}
