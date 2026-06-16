/**
 * Types for the Atrium program data (archetypes.json) and the engine API.
 * The engine is Node-pure: no Expo, React, or Supabase imports anywhere in
 * this package — it runs on-device today and server-side later.
 */

// ---------------------------------------------------------------------------
// archetypes.json data model
// ---------------------------------------------------------------------------

export type Pattern =
  | 'squat'
  | 'hinge'
  | 'hpress'
  | 'vpress'
  | 'hpull'
  | 'vpull'
  | 'lunge'
  | 'chest_iso'
  | 'side_delt'
  | 'rear_delt'
  | 'biceps'
  | 'triceps'
  | 'quad_iso'
  | 'ham_iso'
  | 'glute_iso'
  | 'calf'
  | 'core'
  | 'carry'
  | 'cond';

export type ExerciseEquipment =
  | 'barbell'
  | 'dumbbell'
  | 'machine'
  | 'cable'
  | 'bodyweight'
  | 'band';

export interface CatalogExercise {
  name: string;
  pattern: Pattern;
  equipment: ExerciseEquipment;
  /** 1 = anyone, 2 = some skill, 3 = advanced variation. */
  level: 1 | 2 | 3;
}

export type RuleId =
  | 'novice_linear'
  | 'double_progression'
  | 'top_set_backoff'
  | 'rep_progression'
  | 'timed_progression'
  | 'onramp_pct';

/** [min, max] target range. For timed work the values are seconds. */
export type RepRange = readonly [number, number];

export interface TopSetScheme {
  sets: number;
  reps: RepRange;
}

export interface BackoffScheme {
  sets: number;
  reps: RepRange;
  pct_of_top: number;
}

/** A slot as it appears in archetypes.json sessions. */
export interface ArchetypeSlot {
  pattern: Pattern;
  primary: string;
  rule: RuleId;
  rest_s: number;
  sets?: number;
  reps?: RepRange;
  scheme?: string;
  top?: TopSetScheme;
  backoff?: BackoffScheme;
  duration_min?: number;
  note?: string;
}

export interface ArchetypeSession {
  name: string;
  slots: ArchetypeSlot[];
}

export type Goal = 'strength' | 'muscle' | 'fat_loss' | 'general';
export type Experience = 'new' | 'returning' | 'intermediate' | 'advanced';
export type EquipmentAccess = 'full_gym' | 'home_barbell' | 'dumbbell' | 'bodyweight';
export type DaysPerWeek = 2 | 3 | 4 | 5 | 6;

export interface Archetype {
  id: string;
  name: string;
  goals: Goal[];
  experience: Experience[];
  days_per_week: number;
  equipment: (EquipmentAccess | string)[];
  block_weeks: number;
  structure: 'weekly' | 'alternate_AB';
  summary: string;
  sessions: ArchetypeSession[];
  notes?: string;
}

export interface ArchetypesFile {
  version: string;
  generated_for: string;
  exercise_catalog: Record<string, CatalogExercise>;
  swap_ladders: Record<Pattern, string[]>;
  progression_rules: Record<RuleId, Record<string, unknown> & { type: string }>;
  engine_policies: {
    warmup_scheme: Record<string, string[]>;
    rest_defaults_s: Record<string, number>;
    readiness_modulation: Record<string, string>;
    deload: Record<string, string>;
    safety_bounds: {
      max_session_load_jump_pct: number;
      max_weekly_sets_per_muscle: number;
      min_weekly_sets_per_muscle_on_plan: number;
      rep_floor_compounds: number;
      novice_level_cap: string;
      pain_flag: string;
      hard_rule: string;
    };
    graduation: Record<string, string>;
  };
  selector: { inputs: string[]; rules: unknown[] };
  archetypes: Archetype[];
}

// ---------------------------------------------------------------------------
// Engine API types (Part D contract)
// ---------------------------------------------------------------------------

export type ArchetypeId = string;

export interface OnboardingAnswers {
  goal: Goal;
  experience: Experience;
  days_per_week: DaysPerWeek;
  equipment: EquipmentAccess;
}

export type Readiness = 'green' | 'yellow' | 'red';

/**
 * Per-slot progression state. Lives in program_slots.state (jsonb) in the DB;
 * the engine treats it as an opaque-but-typed value it owns.
 */
export interface SlotState {
  /** Stable id linking state to the program slot row. */
  slotId: string;
  exerciseId: string;
  pattern: Pattern;
  rule: RuleId;
  rest_s: number;
  /** Straight-sets scheme (absent for top/backoff slots). */
  sets?: number;
  reps?: RepRange;
  top?: TopSetScheme;
  backoff?: BackoffScheme;
  duration_min?: number;
  /** Current working load in lb. Undefined until the first session establishes it. */
  workingWeight?: number;
  /** Current top-set load for top_set_backoff. */
  topWeight?: number;
  /** Current per-set rep target for rep/timed progression. */
  repTarget?: number;
  /**
   * Last session date the engine has already reacted to. Fail/progress
   * streaks are derived from history (pure); this guard only stops stall
   * ACTIONS (deloads, swaps, graduations) from re-applying when
   * nextPrescription is called twice with the same history.
   */
  lastAnalyzedSession?: string;
  /** Completed micro-deload cycles on this slot (novice graduation counter). */
  stallCycles: number;
  /** When stalled, double_progression alternates swap → micro-deload. */
  lastStallAction?: 'swap' | 'deload';
  /**
   * top_set_backoff stall recovery: 'deload' week (−15% load, −1 set) was
   * just prescribed → next session resumes at backoff 0.80 for one week.
   */
  stallRecovery?: 'deload' | 'resume080';
  /** Set when rep_progression advances the ladder; engine reports it, caller persists it. */
  pendingVariationAdvance?: boolean;
  /** Pain report freezes progression (safety_bounds.pain_flag). */
  painFlagged?: boolean;
  /** Onramp week counter (onramp_pct), 1-based. */
  onrampWeek?: number;
}

/** One logged set, as the engine sees history. */
export interface SetLog {
  exerciseId: string;
  slotId?: string;
  /** ISO date of the session this set belongs to. */
  sessionDate: string;
  setIndex: number;
  weight: number;
  reps: number;
  isWarmup?: boolean;
  /** Seconds, for timed work. */
  seconds?: number;
}

export interface PrescribedSet {
  setIndex: number;
  weight?: number;
  targetReps: RepRange;
  /** 'top' | 'backoff' | 'work' */
  kind: 'top' | 'backoff' | 'work';
  /** Seconds, for timed work. */
  targetSeconds?: number;
}

export interface Prescription {
  slotId: string;
  exerciseId: string;
  rule: RuleId;
  sets: PrescribedSet[];
  rest_s: number;
  /** Updated slot state the caller must persist after the session is planned. */
  nextState: SlotState;
  /** Human-readable note (e.g. "micro-deload −10%", "onramp week 2 @ 70%"). */
  note?: string;
}

export interface SessionPlan {
  programDayId: string;
  name: string;
  weekIndex: number;
  prescriptions: Prescription[];
  readinessApplied?: Readiness;
  notes?: string[];
}

export interface ProgramPlanSlot {
  slotId: string;
  slotIndex: number;
  pattern: Pattern;
  exerciseId: string;
  rule: RuleId;
  rest_s: number;
  scheme: {
    sets?: number;
    reps?: RepRange;
    top?: TopSetScheme;
    backoff?: BackoffScheme;
    duration_min?: number;
  };
  state: SlotState;
  note?: string;
}

export interface ProgramPlanDay {
  dayId: string;
  dayIndex: number;
  name: string;
  slots: ProgramPlanSlot[];
}

export interface ProgramPlan {
  archetypeId: ArchetypeId;
  name: string;
  blockWeeks: number;
  structure: 'weekly' | 'alternate_AB';
  days: ProgramPlanDay[];
}

export interface SlotStall {
  slotId: string;
  exerciseId: string;
  rule: RuleId;
  reason: string;
}

export interface StallReport {
  stalled: SlotStall[];
  /** Slots one failed/flat session away from their stall definition. */
  atRisk: SlotStall[];
}

export interface DeloadDecision {
  deload: boolean;
  reason: 'two_plus_stalls_same_week' | 'readiness_red_3plus' | 'scheduled_week_7' | 'none';
  /** volume −40% (sets), intensity −10% (load), no top sets, 1 week. */
  prescription?: { volumePct: -40; intensityPct: -10; dropTopSets: true; weeks: 1 };
}

export type Result<T = SessionPlan> =
  | { ok: true; value: T }
  | { ok: false; violations: string[] };

export type PRType = 'weight' | 'reps_at_weight' | 'e1rm' | 'session_volume';

export interface PR {
  type: PRType;
  exerciseId: string;
  value: number;
  /** Previous best, if any. */
  previous?: number;
  setIndex?: number;
}

export interface WorkoutLog {
  workoutId: string;
  date: string;
  sets: SetLog[];
}
