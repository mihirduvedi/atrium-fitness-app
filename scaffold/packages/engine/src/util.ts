import { safetyBounds } from './data';
import type { Pattern, SetLog } from './types';

/** Smallest practical plate increment (lb per side pair / dumbbell step). */
export const PLATE_STEP = 2.5;

export const COMPOUND_PATTERNS: ReadonlySet<Pattern> = new Set([
  'squat',
  'hinge',
  'hpress',
  'vpress',
  'hpull',
  'vpull',
  'lunge',
]);

export const LOWER_BODY_PATTERNS: ReadonlySet<Pattern> = new Set([
  'squat',
  'hinge',
  'lunge',
  'quad_iso',
  'ham_iso',
  'glute_iso',
  'calf',
]);

export const ISOLATION_PATTERNS: ReadonlySet<Pattern> = new Set([
  'chest_iso',
  'side_delt',
  'rear_delt',
  'biceps',
  'triceps',
  'quad_iso',
  'ham_iso',
  'glute_iso',
  'calf',
]);

export const roundToPlate = (lb: number): number => Math.round(lb / PLATE_STEP) * PLATE_STEP;

/**
 * Largest load increase safety_bounds permits from a given weight.
 * max_session_load_jump_pct (5%) governs, but below 50 lb 5% is smaller than
 * the smallest plate step, so the floor is one PLATE_STEP — otherwise light
 * lifts could never progress. Documented deviation; the property tests
 * assert against this exact function.
 */
export function maxAllowedJump(fromWeight: number): number {
  return Math.max((safetyBounds.max_session_load_jump_pct / 100) * fromWeight, PLATE_STEP);
}

/** Clamp a desired increment to the safety bound and quantize to plates. */
export function clampIncrement(fromWeight: number, desired: number): number {
  const allowed = maxAllowedJump(fromWeight);
  const capped = Math.min(desired, allowed);
  // quantize down so we never exceed the bound, but never below one step
  const quantized = Math.floor(capped / PLATE_STEP) * PLATE_STEP;
  return Math.max(quantized, PLATE_STEP);
}

/** Epley estimated 1RM. */
export const epley1RM = (weight: number, reps: number): number =>
  reps <= 1 ? weight : weight * (1 + reps / 30);

export interface SessionGroup {
  date: string;
  sets: SetLog[];
}

/** Group an exercise's history into sessions, oldest → newest, warmups excluded. */
export function groupSessions(history: SetLog[], exerciseId: string): SessionGroup[] {
  const byDate = new Map<string, SetLog[]>();
  for (const s of history) {
    if (s.exerciseId !== exerciseId || s.isWarmup) continue;
    const arr = byDate.get(s.sessionDate) ?? [];
    arr.push(s);
    byDate.set(s.sessionDate, arr);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, sets]) => ({ date, sets: [...sets].sort((x, y) => x.setIndex - y.setIndex) }));
}

export const maxWeight = (sets: SetLog[]): number =>
  sets.reduce((m, s) => Math.max(m, s.weight), 0);

export const totalReps = (sets: SetLog[]): number => sets.reduce((t, s) => t + s.reps, 0);

export const bestE1RM = (sets: SetLog[]): number =>
  sets.reduce((m, s) => Math.max(m, epley1RM(s.weight, s.reps)), 0);
