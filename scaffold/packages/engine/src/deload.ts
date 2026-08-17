import type {
  DeloadDecision,
  PrescribedSet,
  Readiness,
  SessionPlan,
  StallReport,
} from './types';
import { roundToPlate } from './util';

export const SESSION_DELOAD_PRESCRIPTION = {
  volumePct: -40,
  intensityPct: -10,
  dropTopSets: true,
  weeks: 1,
} as const;

/**
 * Program-level deload (engine_policies.deload):
 * - triggered when 2+ lifts stall in the same week, or readiness is red on
 *   3+ days of the recent log;
 * - scheduled (mandatory) in week 7 of any block if none was triggered
 *   earlier;
 * - prescription: volume −40% (sets), intensity −10% (load), no top sets,
 *   one week.
 *
 * `readinessLog` is the most recent daily readiness entries (last 7 days).
 */
export function shouldDeload(
  week: number,
  stalls: StallReport,
  readinessLog: Readiness[],
  options: { deloadAlreadyThisBlock?: boolean } = {},
): DeloadDecision {
  const prescription = SESSION_DELOAD_PRESCRIPTION;

  if (stalls.stalled.length >= 2) {
    return { deload: true, reason: 'two_plus_stalls_same_week', prescription };
  }
  const redDays = readinessLog.filter((r) => r === 'red').length;
  if (redDays >= 3) {
    return { deload: true, reason: 'readiness_red_3plus', prescription };
  }
  if (week === 7 && !options.deloadAlreadyThisBlock) {
    return { deload: true, reason: 'scheduled_week_7', prescription };
  }
  return { deload: false, reason: 'none' };
}

function isWorkingSet(set: PrescribedSet) {
  return !set.isWarmup && set.kind !== 'warmup';
}

/**
 * Apply the engine's program-level deload prescription to one session only.
 *
 * This is deliberately a pure plan transform: exercise identity, rep ranges,
 * rest, order, and progression state are preserved. The caller may persist the
 * returned plan as a workout draft, but the Program itself is never mutated.
 */
export function applySessionDeload(
  plan: SessionPlan,
  prescription: NonNullable<DeloadDecision['prescription']> = SESSION_DELOAD_PRESCRIPTION,
): SessionPlan {
  const loadFactor = 1 + prescription.intensityPct / 100;
  const volumeFactor = 1 + prescription.volumePct / 100;
  const prescriptions = plan.prescriptions.map((item) => {
    const originalWorking = item.sets.filter(isWorkingSet);
    const targetWorkingCount = originalWorking.length > 0
      ? Math.max(1, Math.round(originalWorking.length * volumeFactor))
      : 0;
    const nonTopWorking = prescription.dropTopSets
      ? originalWorking.filter((set) => set.kind !== 'top')
      : originalWorking;
    // A top-only prescription still needs one usable working set. Convert the
    // first lowered top set into ordinary work instead of returning an empty
    // movement; this mirrors the engine's readiness fallback for that shape.
    const eligibleWorking = nonTopWorking.length > 0
      ? nonTopWorking
      : originalWorking.slice(0, 1);
    const retainedWorking = new Set(eligibleWorking.slice(0, targetWorkingCount));
    let nextWorkingIndex = 0;
    const sets = item.sets
      .filter((set) => {
        if (!isWorkingSet(set)) return true;
        return retainedWorking.has(set);
      })
      .map((set) => {
        const working = isWorkingSet(set);
        const convertedTopOnlySet = working
          && prescription.dropTopSets
          && set.kind === 'top'
          && nonTopWorking.length === 0;
        return {
          ...set,
          setIndex: working ? nextWorkingIndex++ : set.setIndex,
          kind: convertedTopOnlySet ? 'work' as const : set.kind,
          weight: set.weight === undefined ? undefined : roundToPlate(set.weight * loadFactor),
        };
      });

    return {
      ...item,
      sets,
      note: [item.note, 'session deload target: volume -40%, load ~-10% plate-rounded, top sets removed']
        .filter(Boolean)
        .join(' · '),
    };
  });

  return {
    ...plan,
    prescriptions,
    notes: [...(plan.notes ?? []), 'Engine session deload: one workout only'],
  };
}
