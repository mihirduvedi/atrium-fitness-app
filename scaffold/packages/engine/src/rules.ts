/**
 * The six progression rules (archetypes.json progression_rules), one pure
 * function each: (slot state, full set history) → next-session Prescription.
 *
 * Conventions shared by all rules:
 * - Streaks (fails, no-progress runs) are DERIVED from history so the
 *   functions stay pure. One-shot stall actions (deload, swap, graduation)
 *   advance state and are guarded by state.lastAnalyzedSession so calling a
 *   rule twice with the same history cannot apply the action twice.
 * - All loads are quantized to PLATE_STEP and every increase is clamped by
 *   safety_bounds.max_session_load_jump_pct (see clampIncrement).
 * - Timed work logs seconds in SetLog.seconds (falls back to reps — the sets
 *   table stores seconds in the reps column for timed slots).
 */

import type { Prescription, PrescribedSet, RepRange, SlotState } from './types';
import {
  bestE1RM,
  clampIncrement,
  groupSessions,
  ISOLATION_PATTERNS,
  LOWER_BODY_PATTERNS,
  maxWeight,
  roundToPlate,
  totalReps,
  type SessionGroup,
} from './util';

const DEFAULT_REPS: RepRange = [5, 5];

function straightSets(count: number, weight: number | undefined, reps: RepRange): PrescribedSet[] {
  return Array.from({ length: count }, (_, i) => ({
    setIndex: i,
    weight,
    targetReps: reps,
    kind: 'work' as const,
  }));
}

function prescription(
  slot: SlotState,
  sets: PrescribedSet[],
  nextState: SlotState,
  note?: string,
): Prescription {
  return { slotId: slot.slotId, exerciseId: slot.exerciseId, rule: slot.rule, sets, rest_s: slot.rest_s, nextState, note };
}

const linearIncrement = (slot: SlotState): number =>
  LOWER_BODY_PATTERNS.has(slot.pattern) ? 5 : 2.5;

const doubleProgressionIncrement = (slot: SlotState): number =>
  ISOLATION_PATTERNS.has(slot.pattern) ? 2.5 : LOWER_BODY_PATTERNS.has(slot.pattern) ? 10 : 5;

/** A session fails the slot if any work set misses the bottom of the range or sets are missing. */
function sessionFailed(s: SessionGroup, setCount: number, repFloor: number): boolean {
  return s.sets.length < setCount || s.sets.some((x) => x.reps < repFloor);
}

/** Trailing failed sessions at (approximately) the same load — a deload restarts the streak. */
function trailingFails(sessions: SessionGroup[], setCount: number, repFloor: number): number {
  const last = sessions[sessions.length - 1];
  if (!last) return 0;
  const anchor = maxWeight(last.sets);
  let n = 0;
  for (let i = sessions.length - 1; i >= 0; i--) {
    const s = sessions[i]!;
    if (sessionFailed(s, setCount, repFloor) && Math.abs(maxWeight(s.sets) - anchor) < 2.5) n++;
    else break;
  }
  return n;
}

// ---------------------------------------------------------------------------
// novice_linear — add load every session while all target reps are completed
// ---------------------------------------------------------------------------

export function noviceLinear(slot: SlotState, sessions: SessionGroup[]): Prescription {
  const reps = slot.reps ?? DEFAULT_REPS;
  const setCount = slot.sets ?? 3;
  const next: SlotState = { ...slot };
  const last = sessions[sessions.length - 1];
  let note: string | undefined;

  if (!last) {
    if (next.workingWeight === undefined) note = 'establish a working weight (leave 2–3 reps in reserve)';
    return prescription(slot, straightSets(setCount, next.workingWeight, reps), next, note);
  }

  let weight = next.workingWeight ?? maxWeight(last.sets);
  if (slot.lastAnalyzedSession !== last.date) {
    next.lastAnalyzedSession = last.date;
    if (!sessionFailed(last, setCount, reps[0])) {
      const inc = clampIncrement(weight, linearIncrement(slot));
      weight = roundToPlate(weight + inc);
      note = `+${inc} lb`;
    } else if (trailingFails(sessions, setCount, reps[0]) >= 2) {
      // stall: 2 consecutive failed sessions on the lift
      weight = roundToPlate(weight * 0.9);
      next.stallCycles = slot.stallCycles + 1;
      if (next.stallCycles >= 3) {
        next.rule = 'double_progression';
        note = 'micro-deload −10% · graduated to double progression';
      } else {
        note = 'micro-deload −10%, rebuild';
      }
    } else {
      note = 'repeat same load';
    }
  }
  next.workingWeight = weight;
  return prescription(slot, straightSets(setCount, weight, reps), next, note);
}

// ---------------------------------------------------------------------------
// double_progression — fixed load within a rep range; all sets at top → load up
// ---------------------------------------------------------------------------

/** No rep or load increase between two consecutive sessions. */
function noIncrease(prev: SessionGroup, cur: SessionGroup): boolean {
  return maxWeight(cur.sets) <= maxWeight(prev.sets) && totalReps(cur.sets) <= totalReps(prev.sets);
}

/** Stall: no rep or load increase across the last 3 sessions of the lift. */
export function doubleProgressionStalled(sessions: SessionGroup[]): boolean {
  if (sessions.length < 3) return false;
  const [a, b, c] = sessions.slice(-3) as [SessionGroup, SessionGroup, SessionGroup];
  return noIncrease(a, b) && noIncrease(b, c);
}

export function doubleProgression(slot: SlotState, sessions: SessionGroup[]): Prescription {
  const reps = slot.reps ?? DEFAULT_REPS;
  const setCount = slot.sets ?? 3;
  const next: SlotState = { ...slot };
  const last = sessions[sessions.length - 1];
  let note: string | undefined;

  if (!last) {
    if (next.workingWeight === undefined) note = 'establish a working weight at the bottom of the range';
    return prescription(slot, straightSets(setCount, next.workingWeight, reps), next, note);
  }

  let weight = next.workingWeight ?? maxWeight(last.sets);
  if (slot.lastAnalyzedSession !== last.date) {
    next.lastAnalyzedSession = last.date;
    const allAtTop = last.sets.length >= setCount && last.sets.every((s) => s.reps >= reps[1]);
    if (allAtTop) {
      const inc = clampIncrement(weight, doubleProgressionIncrement(slot));
      weight = roundToPlate(weight + inc);
      note = `+${inc} lb, restart at ${reps[0]} reps`;
    } else if (doubleProgressionStalled(sessions)) {
      // engine alternates: swap → micro-deload −7.5% → swap → …
      if (slot.lastStallAction !== 'swap') {
        next.pendingVariationAdvance = true;
        next.lastStallAction = 'swap';
        note = 'stalled — swap to the next exercise in the pattern ladder for 4 weeks';
      } else {
        weight = roundToPlate(weight * 0.925);
        next.lastStallAction = 'deload';
        note = 'stalled — micro-deload −7.5%, rebuild';
      }
    }
  }
  next.workingWeight = weight;
  return prescription(slot, straightSets(setCount, weight, reps), next, note);
}

// ---------------------------------------------------------------------------
// top_set_backoff — one progressing top set, back-offs at a fixed % of it
// ---------------------------------------------------------------------------

/** Stall: top-set e1RM flat or down across 3 sessions. */
export function topSetStalled(sessions: SessionGroup[]): boolean {
  if (sessions.length < 3) return false;
  const [a, b, c] = sessions.slice(-3) as [SessionGroup, SessionGroup, SessionGroup];
  return bestE1RM(c.sets) <= bestE1RM(b.sets) && bestE1RM(b.sets) <= bestE1RM(a.sets);
}

export function topSetBackoff(slot: SlotState, sessions: SessionGroup[]): Prescription {
  const top = slot.top ?? { sets: 1, reps: DEFAULT_REPS };
  const backoff = slot.backoff ?? { sets: 3, reps: DEFAULT_REPS, pct_of_top: 0.85 };
  const next: SlotState = { ...slot };
  const last = sessions[sessions.length - 1];
  let note: string | undefined;
  let backoffPct = backoff.pct_of_top;
  let backoffSets = backoff.sets;
  let deloadFactor = 1;

  let topWeight = next.topWeight ?? (last ? maxWeight(last.sets) : undefined);

  if (last && slot.lastAnalyzedSession !== last.date) {
    next.lastAnalyzedSession = last.date;
    next.stallRecovery = undefined;
    if (slot.stallRecovery === 'deload') {
      // the deload week was just performed — resume at 80% back-offs for one week
      next.stallRecovery = 'resume080';
    } else if (topWeight !== undefined) {
      const topSet = [...last.sets].sort((x, y) => y.weight - x.weight)[0]!;
      if (topSet.reps >= top.reps[1]) {
        const incBase = LOWER_BODY_PATTERNS.has(slot.pattern) ? 5 : 2.5;
        const inc = clampIncrement(topWeight, incBase);
        topWeight = roundToPlate(topWeight + inc);
        note = `top set +${inc} lb`;
      } else if (topSetStalled(sessions)) {
        next.stallRecovery = 'deload';
        note = 'stalled — lift deload week: −15% load, −1 set';
      }
    }
  }

  if (next.stallRecovery === 'deload') {
    deloadFactor = 0.85;
    backoffSets = Math.max(1, backoff.sets - 1);
  } else if (next.stallRecovery === 'resume080') {
    backoffPct = 0.8;
    note = note ?? 'resume — back-offs at 80% for one week';
  }

  next.topWeight = topWeight;
  const effTop = topWeight === undefined ? undefined : roundToPlate(topWeight * deloadFactor);
  const backWeight = effTop === undefined ? undefined : roundToPlate(effTop * backoffPct);
  const sets: PrescribedSet[] = [
    ...Array.from({ length: top.sets }, (_, i) => ({
      setIndex: i,
      weight: effTop,
      targetReps: top.reps,
      kind: 'top' as const,
    })),
    ...Array.from({ length: backoffSets }, (_, i) => ({
      setIndex: top.sets + i,
      weight: backWeight,
      targetReps: backoff.reps,
      kind: 'backoff' as const,
    })),
  ];
  if (topWeight === undefined) note = 'establish a top-set weight (4–6 hard reps)';
  return prescription(slot, sets, next, note);
}

// ---------------------------------------------------------------------------
// rep_progression — bodyweight: +1–2 reps/set per session to the cap, then
// advance to the next-harder variation in the pattern ladder
// ---------------------------------------------------------------------------

const REP_CAP_DEFAULT = 15;

export function repProgression(slot: SlotState, sessions: SessionGroup[]): Prescription {
  const reps = slot.reps ?? [8, 12];
  const baseSets = slot.sets ?? 3;
  const next: SlotState = { ...slot };
  let target = next.repTarget ?? reps[0];
  const last = sessions[sessions.length - 1];
  let note: string | undefined;

  if (last && slot.lastAnalyzedSession !== last.date) {
    next.lastAnalyzedSession = last.date;
    const completed = last.sets.length >= (next.sets ?? baseSets) && last.sets.every((s) => s.reps >= target);
    if (completed) {
      if (target >= REP_CAP_DEFAULT) {
        next.pendingVariationAdvance = true;
        target = reps[0];
        note = 'rep cap reached — advance to the next-harder variation';
      } else {
        target = Math.min(target + 2, REP_CAP_DEFAULT);
        note = `+2 reps per set (target ${target})`;
      }
    } else if (sessions.length >= 3 && doubleProgressionStalled(sessions) && (next.sets ?? baseSets) === baseSets) {
      next.sets = baseSets + 1; // hold variation, add a set (max +1)
      note = 'stalled — hold variation, add one set';
    }
  }
  next.repTarget = target;
  const sets = straightSets(next.sets ?? baseSets, undefined, [target, target]);
  return prescription(slot, sets, next, note);
}

// ---------------------------------------------------------------------------
// timed_progression — +10–15s per set up to 75s, then advance variation
// ---------------------------------------------------------------------------

const TIME_CAP_S = 75;
const TIME_INCREMENT_S = 15;

export function timedProgression(slot: SlotState, sessions: SessionGroup[]): Prescription {
  const next: SlotState = { ...slot };

  // conditioning blocks (duration_min) are a fixed prescription, not per-set timed work
  if (slot.duration_min !== undefined) {
    const sets: PrescribedSet[] = [
      { setIndex: 0, targetReps: [1, 1], targetSeconds: slot.duration_min * 60, kind: 'work' },
    ];
    return prescription(slot, sets, next, 'conditioning block');
  }

  const range = slot.reps ?? [30, 60];
  const setCount = slot.sets ?? 3;
  let target = next.repTarget ?? range[0];
  const last = sessions[sessions.length - 1];
  let note: string | undefined;

  if (last && slot.lastAnalyzedSession !== last.date) {
    next.lastAnalyzedSession = last.date;
    const completed =
      last.sets.length >= setCount && last.sets.every((s) => (s.seconds ?? s.reps) >= target);
    if (completed) {
      if (target >= TIME_CAP_S) {
        next.pendingVariationAdvance = true;
        target = range[0];
        note = '75s cap reached — advance to the next-harder variation';
      } else {
        target = Math.min(target + TIME_INCREMENT_S, TIME_CAP_S);
        note = `+${TIME_INCREMENT_S}s per set (target ${target}s)`;
      }
    }
  }
  next.repTarget = target;
  const sets: PrescribedSet[] = Array.from({ length: setCount }, (_, i) => ({
    setIndex: i,
    targetReps: [target, target] as RepRange,
    targetSeconds: target,
    kind: 'work' as const,
  }));
  return prescription(slot, sets, next, note);
}

// ---------------------------------------------------------------------------
// onramp_pct — weeks 1–4 at 60/70/80/90% of last-known working loads.
// The CALLER advances state.onrampWeek with the program week; the rule only
// renders the current week. No PR attempts during the ramp.
// ---------------------------------------------------------------------------

const ONRAMP_PCTS = [0.6, 0.7, 0.8, 0.9] as const;

export function onrampPct(slot: SlotState, _sessions: SessionGroup[]): Prescription {
  const reps = slot.reps ?? [8, 8];
  const setCount = slot.sets ?? 3;
  const next: SlotState = { ...slot };
  const week = Math.max(1, slot.onrampWeek ?? 1);

  if (week >= 5) {
    return prescription(
      slot,
      straightSets(setCount, next.workingWeight, reps),
      next,
      'on-ramp complete — graduate to the matched standard archetype',
    );
  }
  const pct = ONRAMP_PCTS[week - 1]!;
  const weight =
    next.workingWeight === undefined ? undefined : roundToPlate(next.workingWeight * pct);
  const note =
    next.workingWeight === undefined
      ? `on-ramp week ${week} — no known load, cap effort at RPE 6. No PR attempts.`
      : `on-ramp week ${week} @ ${Math.round(pct * 100)}% of last-known loads. No PR attempts.`;
  return prescription(slot, straightSets(setCount, weight, reps), next, note);
}
