import {
  applyReadiness,
  exerciseCatalog,
  instantiateProgram,
  nextPrescription,
  renderWarmups,
  selectArchetype,
  type OnboardingAnswers,
  type Pattern,
  type ProgramPlan,
  type Readiness,
  type RuleId,
  type SessionPlan,
  type SetLog,
  type SlotState,
} from '@atrium/engine';
import { softDeleteWithMutation, upsertWithMutation, type IdFn, type Row } from './dao';
import type { SqlDb } from './schema';

/**
 * Domain reads/writes for the three core screens. Everything is written
 * against the SqlDb surface so it runs identically under expo-sqlite
 * (device) and node:sqlite (tests). All reads come from SQLite only.
 */

const nowIso = () => new Date().toISOString();
const dateOf = (iso: string) => iso.slice(0, 10);

const COMPOUND_PATTERNS = new Set<Pattern>(['squat', 'hinge', 'hpress', 'vpress', 'hpull', 'vpull', 'lunge', 'carry']);
const BODYWEIGHT_EQUIPMENT = 'bodyweight';

function defaultRuleForExercise(pattern: Pattern, equipment: string): RuleId {
  if (equipment === BODYWEIGHT_EQUIPMENT) return 'rep_progression';
  return COMPOUND_PATTERNS.has(pattern) ? 'double_progression' : 'double_progression';
}

function defaultRestForExercise(pattern: Pattern): number {
  return COMPOUND_PATTERNS.has(pattern) ? 150 : 90;
}

function normalizeReps(reps?: number | null): number {
  return Math.max(1, Math.min(50, Math.round(reps ?? 8)));
}

function normalizeSets(sets?: number | null): number {
  return Math.max(1, Math.min(12, Math.round(sets ?? 3)));
}

// ---------------------------------------------------------------------------
// seeding
// ---------------------------------------------------------------------------

export async function getMeta(db: SqlDb, key: string): Promise<string | null> {
  const r = await db.getFirstAsync<{ value: string }>('select value from device_meta where key = ?', key);
  return r?.value ?? null;
}

export async function setMeta(db: SqlDb, key: string, value: string): Promise<void> {
  await db.runAsync(
    'insert into device_meta (key, value) values (?, ?) on conflict (key) do update set value = excluded.value',
    key,
    value,
  );
}

/** Seed the read-only exercise catalog (id = archetypes.json slug). Local only — no mutations queued. */
export async function seedExerciseCatalog(db: SqlDb): Promise<void> {
  const ts = nowIso();
  await db.withTransactionAsync(async () => {
    for (const [id, ex] of Object.entries(exerciseCatalog)) {
      await db.runAsync(
        `insert into exercises (id, owner_user_id, name, pattern, equipment, level, updated_at)
         values (?, null, ?, ?, ?, ?, ?)
         on conflict (id) do nothing`,
        id, ex.name, ex.pattern, ex.equipment, ex.level, ts,
      );
    }
  });
}

export interface ExerciseLibraryEntry {
  id: string;
  ownerUserId: string | null;
  name: string;
  pattern: Pattern;
  equipment: string;
  level: number;
  description: string | null;
  defaultSets: number | null;
  defaultReps: number | null;
}

function mapExerciseRow(row: {
  id: string;
  owner_user_id: string | null;
  name: string;
  pattern: string;
  equipment: string;
  level: number;
  description: string | null;
  default_sets: number | null;
  default_reps: number | null;
}): ExerciseLibraryEntry {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    pattern: row.pattern as Pattern,
    equipment: row.equipment,
    level: row.level,
    description: row.description,
    defaultSets: row.default_sets,
    defaultReps: row.default_reps,
  };
}

export async function listExercises(db: SqlDb, userId: string): Promise<ExerciseLibraryEntry[]> {
  const rows = await db.getAllAsync<{
    id: string;
    owner_user_id: string | null;
    name: string;
    pattern: string;
    equipment: string;
    level: number;
    description: string | null;
    default_sets: number | null;
    default_reps: number | null;
  }>(
    `select id, owner_user_id, name, pattern, equipment, level, description, default_sets, default_reps
       from exercises
      where deleted_at is null and (owner_user_id is null or owner_user_id = ?)
      order by owner_user_id is not null desc, name`,
    userId,
  );
  return rows.map(mapExerciseRow);
}

export async function createCustomExercise(
  db: SqlDb,
  userId: string,
  args: {
    name: string;
    pattern: Pattern;
    equipment: string;
    description?: string | null;
    defaultSets?: number | null;
    defaultReps?: number | null;
  },
  idFn: IdFn,
): Promise<ExerciseLibraryEntry> {
  const id = idFn();
  const row = {
    id,
    owner_user_id: userId,
    name: args.name.trim(),
    pattern: args.pattern,
    equipment: args.equipment,
    level: 1,
    description: args.description?.trim() || null,
    default_sets: normalizeSets(args.defaultSets),
    default_reps: normalizeReps(args.defaultReps),
    updated_at: nowIso(),
    deleted_at: null,
  };
  await upsertWithMutation(db, 'exercises', row, idFn);
  return mapExerciseRow(row);
}

export async function deleteCustomExercise(db: SqlDb, userId: string, exerciseId: string, idFn: IdFn): Promise<boolean> {
  const row = await db.getFirstAsync<{ id: string }>(
    'select id from exercises where id = ? and owner_user_id = ? and deleted_at is null',
    exerciseId,
    userId,
  );
  if (!row) return false;
  await softDeleteWithMutation(db, 'exercises', row.id, idFn);
  return true;
}

async function createProgramPlan(
  db: SqlDb,
  userId: string,
  profile: {
    goal: string;
    experience: string;
    equipment: string;
    days_per_week: number;
    units?: string;
  },
  plan: ProgramPlan,
  idFn: IdFn,
): Promise<string> {
  const ts = nowIso();
  const existingProfile = await db.getFirstAsync<{ created_at: string }>(
    'select created_at from profiles where user_id = ?',
    userId,
  );

  await upsertWithMutation(db, 'profiles', {
    user_id: userId,
    goal: profile.goal,
    experience: profile.experience,
    equipment: JSON.stringify([profile.equipment]),
    days_per_week: profile.days_per_week,
    units: profile.units ?? 'lb',
    created_at: existingProfile?.created_at ?? ts,
    updated_at: ts,
    deleted_at: null,
  }, idFn);

  const programId = idFn();
  await upsertWithMutation(db, 'programs', {
    id: programId,
    user_id: userId,
    archetype_id: plan.archetypeId,
    status: 'active',
    started_at: ts,
    current_week: 1,
    updated_at: ts,
    deleted_at: null,
  }, idFn);

  for (const day of plan.days) {
    await upsertWithMutation(db, 'program_days', {
      id: day.dayId,
      program_id: programId,
      day_index: day.dayIndex,
      name: day.name,
      updated_at: ts,
      deleted_at: null,
    }, idFn);
    for (const slot of day.slots) {
      await upsertWithMutation(db, 'program_slots', {
        id: slot.slotId,
        program_day_id: day.dayId,
        slot_index: slot.slotIndex,
        pattern: slot.pattern,
        exercise_id: slot.exerciseId,
        scheme: JSON.stringify(slot.scheme),
        rule: slot.rule,
        rest_s: slot.rest_s,
        state: JSON.stringify(slot.state),
        updated_at: ts,
        deleted_at: null,
      }, idFn);
    }
  }
  return programId;
}

/**
 * Demo user on ul4_strength (brief Part F). Creates profile + program +
 * days + slots through the mutation queue so the whole program syncs up
 * once a real (anonymous) user exists server-side.
 */
export async function seedDemoProgram(db: SqlDb, userId: string, idFn: IdFn): Promise<string> {
  const existing = await db.getFirstAsync<{ id: string }>(
    "select id from programs where user_id = ? and status = 'active' and deleted_at is null",
    userId,
  );
  if (existing) return existing.id;

  const plan: ProgramPlan = instantiateProgram('ul4_strength', 'full_gym', 'intermediate', () => idFn());

  return createProgramPlan(db, userId, {
    goal: 'strength',
    experience: 'intermediate',
    equipment: 'full_gym',
    days_per_week: 4,
    units: 'lb',
  }, plan, idFn);
}

/** Create the first user-selected program from onboarding answers. */
export async function createProgramFromOnboarding(
  db: SqlDb,
  userId: string,
  answers: OnboardingAnswers,
  idFn: IdFn,
): Promise<string> {
  const existing = await db.getFirstAsync<{ id: string }>(
    "select id from programs where user_id = ? and status = 'active' and deleted_at is null",
    userId,
  );
  if (existing) return existing.id;

  const archetypeId = selectArchetype(answers);
  const plan: ProgramPlan = instantiateProgram(archetypeId, answers.equipment, answers.experience, () => idFn());
  return createProgramPlan(db, userId, {
    goal: answers.goal,
    experience: answers.experience,
    equipment: answers.equipment,
    days_per_week: answers.days_per_week,
    units: 'lb',
  }, plan, idFn);
}

// ---------------------------------------------------------------------------
// planning the next session
// ---------------------------------------------------------------------------

export interface ProgramInfo {
  id: string;
  archetype_id: string;
  current_week: number;
  started_at: string;
}

export async function getActiveProgram(db: SqlDb, userId: string): Promise<ProgramInfo | null> {
  return db.getFirstAsync<ProgramInfo>(
    "select id, archetype_id, current_week, started_at from programs where user_id = ? and status = 'active' and deleted_at is null",
    userId,
  );
}

export interface NextDay {
  dayId: string;
  dayIndex: number;
  name: string;
  week: number;
  completedThisWeek: number;
  daysPerWeek: number;
  setRestSeconds: number | null;
  exerciseRestSeconds: number | null;
}

function normalizeRestSeconds(value?: number | null): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(900, Math.round(value)));
}

/** Rotation: completed workouts → next day_index; week = floor(count / days) + 1. */
export async function getNextProgramDay(db: SqlDb, programId: string): Promise<NextDay | null> {
  const days = await db.getAllAsync<{
    id: string;
    day_index: number;
    name: string;
    set_rest_s: number | null;
    exercise_rest_s: number | null;
  }>(
    `select d.id, d.day_index, d.name, s.set_rest_s, s.exercise_rest_s
       from program_days d
       left join program_day_settings s on s.program_day_id = d.id and s.deleted_at is null
      where d.program_id = ? and d.deleted_at is null and coalesce(s.active, 1) = 1
      order by d.day_index`,
    programId,
  );
  if (days.length === 0) return null;
  const done = await db.getFirstAsync<{ n: number }>(
    `select count(*) as n from workouts w
     join program_days d on d.id = w.program_day_id
     where d.program_id = ? and w.ended_at is not null and w.deleted_at is null`,
    programId,
  );
  const count = done?.n ?? 0;
  const day = days[count % days.length]!;
  return {
    dayId: day.id,
    dayIndex: day.day_index,
    name: day.name,
    week: Math.floor(count / days.length) + 1,
    completedThisWeek: count % days.length,
    daysPerWeek: days.length,
    setRestSeconds: normalizeRestSeconds(day.set_rest_s),
    exerciseRestSeconds: normalizeRestSeconds(day.exercise_rest_s),
  };
}

export interface SlotRow {
  id: string;
  slot_index: number;
  exercise_id: string;
  rest_s: number;
  state: string;
}

export async function getSlotStates(db: SqlDb, dayId: string): Promise<SlotState[]> {
  const rows = await db.getAllAsync<SlotRow>(
    'select id, slot_index, exercise_id, rest_s, state from program_slots where program_day_id = ? and deleted_at is null order by slot_index',
    dayId,
  );
  return rows.map((r) => JSON.parse(r.state) as SlotState);
}

/** Full set history for the engine: session date = the workout's start date. */
export async function getHistory(db: SqlDb, userId: string): Promise<SetLog[]> {
  const rows = await db.getAllAsync<{
    exercise_id: string;
    started_at: string;
    set_index: number;
    weight: number | null;
    reps: number | null;
    is_warmup: number;
  }>(
    `select s.exercise_id, w.started_at, s.set_index, s.weight, s.reps, s.is_warmup
     from sets s join workouts w on w.id = s.workout_id
     where w.user_id = ? and s.deleted_at is null and w.deleted_at is null
     order by w.started_at, s.set_index`,
    userId,
  );
  return rows.map((r) => ({
    exerciseId: r.exercise_id,
    sessionDate: dateOf(r.started_at),
    setIndex: r.set_index,
    weight: r.weight ?? 0,
    reps: r.reps ?? 0,
    isWarmup: !!r.is_warmup,
  }));
}

/**
 * Build the next session plan for a program day: nextPrescription per slot,
 * persisting each slot's advanced state (idempotent — the engine's
 * lastAnalyzedSession guard makes re-planning a no-op until a new session
 * lands in history).
 */
export async function planSession(
  db: SqlDb,
  userId: string,
  day: NextDay,
  idFn: IdFn,
  readiness: Readiness = 'green',
): Promise<SessionPlan> {
  const states = await getSlotStates(db, day.dayId);
  const history = await getHistory(db, userId);

  const prescriptions = [];
  for (const state of states) {
    const p = nextPrescription(state, history);
    if (JSON.stringify(p.nextState) !== JSON.stringify(state)) {
      await saveSlotState(db, p.nextState, idFn);
    }
    prescriptions.push(p);
  }
  const plan: SessionPlan = {
    programDayId: day.dayId,
    name: day.name,
    weekIndex: day.week,
    prescriptions,
  };
  return renderWarmups(applyReadiness(plan, readiness));
}

/** Build a session preview without persisting nextState changes. */
export async function previewProgramDay(
  db: SqlDb,
  userId: string,
  day: NextDay,
  readiness: Readiness = 'green',
): Promise<SessionPlan> {
  const states = await getSlotStates(db, day.dayId);
  const history = await getHistory(db, userId);
  const prescriptions = states.map((state) => nextPrescription(state, history));
  return renderWarmups(applyReadiness({
    programDayId: day.dayId,
    name: day.name,
    weekIndex: day.week,
    prescriptions,
  }, readiness));
}

export interface ProgramSlotOverview {
  slotId: string;
  slotIndex: number;
  pattern: string;
  exerciseId: string;
  exerciseName: string;
  rule: string;
  restS: number;
  scheme: {
    sets?: number;
    reps?: readonly [number, number];
    top?: { sets: number; reps: readonly [number, number] };
    backoff?: { sets: number; reps: readonly [number, number]; pct_of_top: number };
    duration_min?: number;
  };
}

export interface ProgramDayOverview {
  dayId: string;
  dayIndex: number;
  name: string;
  completedWorkouts: number;
  lastCompletedAt: string | null;
  slots: ProgramSlotOverview[];
}

export interface ProgramOverview {
  program: ProgramInfo;
  week: number;
  completedThisWeek: number;
  daysPerWeek: number;
  totalCompletedWorkouts: number;
  nextDay: NextDay | null;
  days: ProgramDayOverview[];
}

export async function getProgramOverview(db: SqlDb, userId: string): Promise<ProgramOverview | null> {
  const program = await getActiveProgram(db, userId);
  if (!program) return null;

  const rows = await db.getAllAsync<{
    day_id: string;
    day_index: number;
    day_name: string;
    slot_id: string | null;
    slot_index: number | null;
    pattern: string | null;
    exercise_id: string | null;
    exercise_name: string | null;
    scheme: string | null;
    rule: string | null;
    rest_s: number | null;
  }>(
    `select d.id as day_id, d.day_index, d.name as day_name,
            s.id as slot_id, s.slot_index, s.pattern, s.exercise_id,
            e.name as exercise_name, s.scheme, s.rule, s.rest_s
       from program_days d
       left join program_day_settings ps on ps.program_day_id = d.id and ps.deleted_at is null
       left join program_slots s on s.program_day_id = d.id and s.deleted_at is null
       left join exercises e on e.id = s.exercise_id
      where d.program_id = ? and d.deleted_at is null and coalesce(ps.active, 1) = 1
      order by d.day_index, s.slot_index`,
    program.id,
  );

  const completedRows = await db.getAllAsync<{
    program_day_id: string;
    n: number;
    last_completed_at: string | null;
  }>(
    `select w.program_day_id, count(*) as n, max(w.ended_at) as last_completed_at
       from workouts w
      where w.program_day_id in (
        select d.id
          from program_days d
          left join program_day_settings ps on ps.program_day_id = d.id and ps.deleted_at is null
         where d.program_id = ? and d.deleted_at is null and coalesce(ps.active, 1) = 1
      )
        and w.ended_at is not null
        and w.deleted_at is null
        and exists (
          select 1 from sets s
           where s.workout_id = w.id and s.deleted_at is null and s.is_warmup = 0
        )
      group by w.program_day_id`,
    program.id,
  );
  const completedByDay = new Map(completedRows.map((row) => [row.program_day_id, row]));
  const days = new Map<string, ProgramDayOverview>();

  for (const row of rows) {
    if (!days.has(row.day_id)) {
      const completed = completedByDay.get(row.day_id);
      days.set(row.day_id, {
        dayId: row.day_id,
        dayIndex: row.day_index,
        name: row.day_name,
        completedWorkouts: completed?.n ?? 0,
        lastCompletedAt: completed?.last_completed_at ?? null,
        slots: [],
      });
    }
    if (row.slot_id && row.slot_index !== null && row.pattern && row.exercise_id && row.scheme && row.rule && row.rest_s !== null) {
      days.get(row.day_id)!.slots.push({
        slotId: row.slot_id,
        slotIndex: row.slot_index,
        pattern: row.pattern,
        exerciseId: row.exercise_id,
        exerciseName: row.exercise_name ?? row.exercise_id,
        rule: row.rule,
        restS: row.rest_s,
        scheme: JSON.parse(row.scheme),
      });
    }
  }

  const nextDay = await getNextProgramDay(db, program.id);
  const dayList = Array.from(days.values());
  return {
    program,
    week: nextDay?.week ?? program.current_week,
    completedThisWeek: nextDay?.completedThisWeek ?? 0,
    daysPerWeek: dayList.length,
    totalCompletedWorkouts: completedRows.reduce((sum, row) => sum + row.n, 0),
    nextDay,
    days: dayList,
  };
}

export type ProgramCategory = 'arms' | 'chest' | 'back' | 'upper' | 'lower' | 'free' | 'other';
export type ProgramRepeatUnit = 'day' | 'week';
export type WorkoutPlanGoal = 'strength' | 'weight_loss' | 'muscle' | 'agility' | 'general' | 'other';

export interface ProgramLibraryItem {
  programDayId: string;
  workoutPlanId: string;
  workoutPlanStatus: string;
  dayIndex: number;
  name: string;
  active: boolean;
  category: ProgramCategory;
  notes: string | null;
  repeatEvery: number;
  repeatUnit: ProgramRepeatUnit;
  weekdays: number[];
  setRestSeconds: number | null;
  exerciseRestSeconds: number | null;
  completedWorkouts: number;
  lastCompletedAt: string | null;
  movements: ProgramSlotOverview[];
}

export interface WorkoutPlanLibraryItem {
  planId: string;
  archetypeId: string;
  status: string;
  active: boolean;
  startedAt: string;
  currentWeek: number;
  name: string | null;
  goal: WorkoutPlanGoal;
  notes: string | null;
  programs: ProgramLibraryItem[];
}

const PROGRAM_CATEGORIES: ProgramCategory[] = ['arms', 'chest', 'back', 'upper', 'lower', 'free', 'other'];
const WORKOUT_PLAN_GOALS: WorkoutPlanGoal[] = ['strength', 'weight_loss', 'muscle', 'agility', 'general', 'other'];

function normalizeProgramCategory(value?: string | null): ProgramCategory {
  return PROGRAM_CATEGORIES.includes(value as ProgramCategory) ? value as ProgramCategory : 'other';
}

function normalizeWorkoutPlanGoal(value?: string | null): WorkoutPlanGoal {
  return WORKOUT_PLAN_GOALS.includes(value as WorkoutPlanGoal) ? value as WorkoutPlanGoal : 'general';
}

function inferProgramCategory(name: string): ProgramCategory {
  const lower = name.toLowerCase();
  if (lower.includes('arm') || lower.includes('bicep') || lower.includes('tricep')) return 'arms';
  if (lower.includes('chest') || lower.includes('push')) return 'chest';
  if (lower.includes('back') || lower.includes('pull')) return 'back';
  if (lower.includes('upper')) return 'upper';
  if (lower.includes('lower') || lower.includes('leg')) return 'lower';
  if (lower.includes('free')) return 'free';
  return 'other';
}

function parseWeekdays(value?: string | null): number[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is number => Number.isInteger(item) && item >= 0 && item <= 6)
      : [];
  } catch {
    return [];
  }
}

function normalizeRepeatUnit(value?: string | null): ProgramRepeatUnit {
  return value === 'day' ? 'day' : 'week';
}

export async function listProgramLibrary(db: SqlDb, userId: string): Promise<ProgramLibraryItem[]> {
  const rows = await db.getAllAsync<{
    program_day_id: string;
    workout_plan_id: string;
    workout_plan_status: string;
    day_index: number;
    day_name: string;
    active: number | null;
    category: string | null;
    notes: string | null;
    repeat_every: number | null;
    repeat_unit: string | null;
    weekdays: string | null;
    set_rest_s: number | null;
    exercise_rest_s: number | null;
    slot_id: string | null;
    slot_index: number | null;
    pattern: string | null;
    exercise_id: string | null;
    exercise_name: string | null;
    scheme: string | null;
    rule: string | null;
    rest_s: number | null;
  }>(
    `select d.id as program_day_id,
            p.id as workout_plan_id,
            p.status as workout_plan_status,
            d.day_index,
            d.name as day_name,
            ps.active,
            ps.category,
            ps.notes,
            ps.repeat_every,
            ps.repeat_unit,
            ps.weekdays,
            ps.set_rest_s,
            ps.exercise_rest_s,
            s.id as slot_id,
            s.slot_index,
            s.pattern,
            s.exercise_id,
            e.name as exercise_name,
            s.scheme,
            s.rule,
            s.rest_s
       from program_days d
       join programs p on p.id = d.program_id
       left join program_day_settings ps on ps.program_day_id = d.id and ps.deleted_at is null
       left join program_slots s on s.program_day_id = d.id and s.deleted_at is null
       left join exercises e on e.id = s.exercise_id
      where p.user_id = ? and p.deleted_at is null and d.deleted_at is null
      order by case when p.status = 'active' then 0 else 1 end, d.day_index, s.slot_index`,
    userId,
  );
  const completedRows = await db.getAllAsync<{
    program_day_id: string;
    n: number;
    last_completed_at: string | null;
  }>(
    `select program_day_id, count(*) as n, max(ended_at) as last_completed_at
       from workouts
      where user_id = ? and ended_at is not null and deleted_at is null
      group by program_day_id`,
    userId,
  );
  const completedByDay = new Map(completedRows.map((row) => [row.program_day_id, row]));
  const items = new Map<string, ProgramLibraryItem>();

  for (const row of rows) {
    if (!items.has(row.program_day_id)) {
      const completed = completedByDay.get(row.program_day_id);
      items.set(row.program_day_id, {
        programDayId: row.program_day_id,
        workoutPlanId: row.workout_plan_id,
        workoutPlanStatus: row.workout_plan_status,
        dayIndex: row.day_index,
        name: row.day_name,
        active: row.active === null ? true : !!row.active,
        category: normalizeProgramCategory(row.category ?? inferProgramCategory(row.day_name)),
        notes: row.notes,
        repeatEvery: Math.max(1, Math.min(7, Math.round(row.repeat_every ?? 1))),
        repeatUnit: normalizeRepeatUnit(row.repeat_unit),
        weekdays: parseWeekdays(row.weekdays),
        setRestSeconds: normalizeRestSeconds(row.set_rest_s),
        exerciseRestSeconds: normalizeRestSeconds(row.exercise_rest_s),
        completedWorkouts: completed?.n ?? 0,
        lastCompletedAt: completed?.last_completed_at ?? null,
        movements: [],
      });
    }
    if (row.slot_id && row.slot_index !== null && row.pattern && row.exercise_id && row.scheme && row.rule && row.rest_s !== null) {
      items.get(row.program_day_id)!.movements.push({
        slotId: row.slot_id,
        slotIndex: row.slot_index,
        pattern: row.pattern,
        exerciseId: row.exercise_id,
        exerciseName: row.exercise_name ?? row.exercise_id,
        rule: row.rule,
        restS: row.rest_s,
        scheme: JSON.parse(row.scheme),
      });
    }
  }

  return Array.from(items.values());
}

export async function listWorkoutPlanLibrary(db: SqlDb, userId: string): Promise<WorkoutPlanLibraryItem[]> {
  const [plans, programRows] = await Promise.all([
    db.getAllAsync<{
      id: string;
      archetype_id: string;
      status: string;
      started_at: string;
      current_week: number;
      name: string | null;
      goal: string | null;
      notes: string | null;
    }>(
      `select p.id,
              p.archetype_id,
              p.status,
              p.started_at,
              p.current_week,
              s.name,
              s.goal,
              s.notes
         from programs p
         left join workout_plan_settings s on s.program_id = p.id and s.deleted_at is null
        where p.user_id = ? and p.deleted_at is null
        order by case when p.status = 'active' then 0 else 1 end, p.started_at desc`,
      userId,
    ),
    listProgramLibrary(db, userId),
  ]);
  const programsByPlan = new Map<string, ProgramLibraryItem[]>();
  for (const program of programRows) {
    programsByPlan.set(program.workoutPlanId, [...(programsByPlan.get(program.workoutPlanId) ?? []), program]);
  }
  return plans.map((plan) => ({
    planId: plan.id,
    archetypeId: plan.archetype_id,
    status: plan.status,
    active: plan.status === 'active',
    startedAt: plan.started_at,
    currentWeek: plan.current_week,
    name: plan.name,
    goal: normalizeWorkoutPlanGoal(plan.goal),
    notes: plan.notes,
    programs: programsByPlan.get(plan.id) ?? [],
  }));
}

export async function renameProgramDay(db: SqlDb, programDayId: string, name: string, idFn: IdFn): Promise<void> {
  const row = await db.getFirstAsync<Row>('select * from program_days where id = ? and deleted_at is null', programDayId);
  const nextName = name.trim();
  if (!row || !nextName) return;
  await upsertWithMutation(db, 'program_days', {
    ...row,
    name: nextName,
    updated_at: nowIso(),
  }, idFn);
}

export async function saveProgramDaySettings(
  db: SqlDb,
  args: {
    userId: string;
    programDayId: string;
    active?: boolean;
    category?: ProgramCategory;
    notes?: string | null;
    repeatEvery?: number;
    repeatUnit?: ProgramRepeatUnit;
    weekdays?: number[];
    setRestSeconds?: number | null;
    exerciseRestSeconds?: number | null;
  },
): Promise<void> {
  const existing = await db.getFirstAsync<{
    active: number | null;
    category: string | null;
    notes: string | null;
    repeat_every: number | null;
    repeat_unit: string | null;
    weekdays: string | null;
    set_rest_s: number | null;
    exercise_rest_s: number | null;
    day_name: string;
  }>(
    `select ps.active, ps.category, ps.notes, ps.repeat_every, ps.repeat_unit, ps.weekdays,
            ps.set_rest_s, ps.exercise_rest_s, d.name as day_name
       from program_days d
       left join program_day_settings ps on ps.program_day_id = d.id and ps.deleted_at is null
      where d.id = ? and d.deleted_at is null`,
    args.programDayId,
  );
  const ts = nowIso();
  const active = args.active === undefined ? existing?.active ?? 1 : args.active ? 1 : 0;
  const category = normalizeProgramCategory(
    args.category ?? existing?.category ?? inferProgramCategory(existing?.day_name ?? ''),
  );
  const notes = args.notes === undefined ? existing?.notes ?? null : args.notes?.trim() || null;
  const repeatEvery = Math.max(1, Math.min(7, Math.round(args.repeatEvery ?? existing?.repeat_every ?? 1)));
  const repeatUnit = normalizeRepeatUnit(args.repeatUnit ?? existing?.repeat_unit);
  const weekdays = args.weekdays ?? parseWeekdays(existing?.weekdays);
  const setRestSeconds = args.setRestSeconds === undefined
    ? normalizeRestSeconds(existing?.set_rest_s)
    : normalizeRestSeconds(args.setRestSeconds);
  const exerciseRestSeconds = args.exerciseRestSeconds === undefined
    ? normalizeRestSeconds(existing?.exercise_rest_s)
    : normalizeRestSeconds(args.exerciseRestSeconds);
  await db.runAsync(
    `insert into program_day_settings (
       program_day_id, user_id, active, category, notes, repeat_every, repeat_unit, weekdays,
       set_rest_s, exercise_rest_s, updated_at, deleted_at
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null)
     on conflict (program_day_id) do update set
       user_id = excluded.user_id,
       active = excluded.active,
       category = excluded.category,
       notes = excluded.notes,
       repeat_every = excluded.repeat_every,
       repeat_unit = excluded.repeat_unit,
       weekdays = excluded.weekdays,
       set_rest_s = excluded.set_rest_s,
       exercise_rest_s = excluded.exercise_rest_s,
       updated_at = excluded.updated_at,
       deleted_at = null`,
    args.programDayId,
    args.userId,
    active,
    category,
    notes,
    repeatEvery,
    repeatUnit,
    JSON.stringify(weekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)),
    setRestSeconds,
    exerciseRestSeconds,
    ts,
  );
}

export async function setProgramDayActive(
  db: SqlDb,
  userId: string,
  programDayId: string,
  active: boolean,
): Promise<void> {
  await saveProgramDaySettings(db, { userId, programDayId, active });
}

export async function removeMovementFromProgramDay(db: SqlDb, slotId: string, idFn: IdFn): Promise<boolean> {
  const row = await db.getFirstAsync<{ id: string }>('select id from program_slots where id = ? and deleted_at is null', slotId);
  if (!row) return false;
  await softDeleteWithMutation(db, 'program_slots', slotId, idFn);
  return true;
}

export async function createProgramDayTemplate(
  db: SqlDb,
  userId: string,
  args: {
    name: string;
    category: ProgramCategory;
    notes?: string | null;
    repeatEvery?: number;
    repeatUnit?: ProgramRepeatUnit;
    weekdays?: number[];
    setRestSeconds?: number | null;
    exerciseRestSeconds?: number | null;
    active?: boolean;
  },
  idFn: IdFn,
): Promise<string> {
  const program = await getActiveProgram(db, userId);
  if (!program) throw new Error('No active workout plan');
  const name = args.name.trim();
  if (!name) throw new Error('Program name is required');
  const nextIndex = await db.getFirstAsync<{ n: number }>(
    'select coalesce(max(day_index) + 1, 0) as n from program_days where program_id = ? and deleted_at is null',
    program.id,
  );
  const programDayId = idFn();
  await upsertWithMutation(db, 'program_days', {
    id: programDayId,
    program_id: program.id,
    day_index: nextIndex?.n ?? 0,
    name,
    updated_at: nowIso(),
    deleted_at: null,
  }, idFn);
  await saveProgramDaySettings(db, {
    userId,
    programDayId,
    active: args.active ?? false,
    category: args.category,
    notes: args.notes ?? null,
    repeatEvery: args.repeatEvery ?? 1,
    repeatUnit: args.repeatUnit ?? 'week',
    weekdays: args.weekdays ?? [],
    setRestSeconds: args.setRestSeconds,
    exerciseRestSeconds: args.exerciseRestSeconds,
  });
  return programDayId;
}

export async function saveWorkoutPlanSettings(
  db: SqlDb,
  args: {
    userId: string;
    planId: string;
    name?: string | null;
    goal?: WorkoutPlanGoal;
    notes?: string | null;
  },
): Promise<void> {
  const existing = await db.getFirstAsync<{
    name: string | null;
    goal: string | null;
    notes: string | null;
  }>('select name, goal, notes from workout_plan_settings where program_id = ?', args.planId);
  const ts = nowIso();
  const name = args.name === undefined ? existing?.name ?? null : args.name?.trim() || null;
  const goal = normalizeWorkoutPlanGoal(args.goal ?? existing?.goal);
  const notes = args.notes === undefined ? existing?.notes ?? null : args.notes?.trim() || null;
  await db.runAsync(
    `insert into workout_plan_settings (
       program_id, user_id, name, goal, notes, updated_at, deleted_at
     ) values (?, ?, ?, ?, ?, ?, null)
     on conflict (program_id) do update set
       user_id = excluded.user_id,
       name = excluded.name,
       goal = excluded.goal,
       notes = excluded.notes,
       updated_at = excluded.updated_at,
       deleted_at = null`,
    args.planId,
    args.userId,
    name,
    goal,
    notes,
    ts,
  );
}

export async function createWorkoutPlanTemplate(
  db: SqlDb,
  userId: string,
  args: {
    name: string;
    goal: WorkoutPlanGoal;
    notes?: string | null;
    active?: boolean;
  },
  idFn: IdFn,
): Promise<string> {
  const planId = idFn();
  const ts = nowIso();
  await upsertWithMutation(db, 'programs', {
    id: planId,
    user_id: userId,
    archetype_id: 'custom_plan',
    status: args.active ? 'active' : 'inactive',
    started_at: ts,
    current_week: 1,
    updated_at: ts,
    deleted_at: null,
  }, idFn);
  await saveWorkoutPlanSettings(db, {
    userId,
    planId,
    name: args.name,
    goal: args.goal,
    notes: args.notes ?? null,
  });
  return planId;
}

export async function setWorkoutPlanActive(
  db: SqlDb,
  userId: string,
  planId: string,
  active: boolean,
  idFn: IdFn,
): Promise<void> {
  const row = await db.getFirstAsync<Row>(
    'select * from programs where id = ? and user_id = ? and deleted_at is null',
    planId,
    userId,
  );
  if (!row) return;
  const updatedAt = nowIso();
  if (active) {
    const otherActivePlans = await db.getAllAsync<Row>(
      `select *
         from programs
        where user_id = ?
          and id <> ?
          and status = 'active'
          and deleted_at is null`,
      userId,
      planId,
    );
    for (const otherPlan of otherActivePlans) {
      await upsertWithMutation(db, 'programs', {
        ...otherPlan,
        status: 'inactive',
        updated_at: updatedAt,
      }, idFn);
    }
  }
  await upsertWithMutation(db, 'programs', {
    ...row,
    status: active ? 'active' : 'inactive',
    updated_at: updatedAt,
  }, idFn);
}

export async function removeProgramFromWorkoutPlan(
  db: SqlDb,
  userId: string,
  programDayId: string,
  idFn: IdFn,
): Promise<boolean> {
  const row = await db.getFirstAsync<{ id: string; program_id: string }>(
    `select d.id, d.program_id
       from program_days d
       join programs p on p.id = d.program_id
      where d.id = ? and p.user_id = ? and d.deleted_at is null and p.deleted_at is null`,
    programDayId,
    userId,
  );
  if (!row) return false;
  await softDeleteWithMutation(db, 'program_days', row.id, idFn);
  const remainingPrograms = await db.getAllAsync<Row>(
    `select *
       from program_days
      where program_id = ? and deleted_at is null
      order by day_index, id`,
    row.program_id,
  );
  const updatedAt = nowIso();
  for (const [dayIndex, program] of remainingPrograms.entries()) {
    if (program.day_index === dayIndex) continue;
    await upsertWithMutation(db, 'program_days', {
      ...program,
      day_index: dayIndex,
      updated_at: updatedAt,
    }, idFn);
  }
  return true;
}

export async function cloneProgramIntoWorkoutPlan(
  db: SqlDb,
  userId: string,
  sourceProgramDayId: string,
  targetPlanId: string,
  idFn: IdFn,
): Promise<string | null> {
  const [targetPlan, sourceDay] = await Promise.all([
    db.getFirstAsync<{ id: string }>(
      'select id from programs where id = ? and user_id = ? and deleted_at is null',
      targetPlanId,
      userId,
    ),
    db.getFirstAsync<{ id: string; name: string }>(
      `select d.id, d.name
         from program_days d
         join programs p on p.id = d.program_id
        where d.id = ? and p.user_id = ? and d.deleted_at is null and p.deleted_at is null`,
      sourceProgramDayId,
      userId,
    ),
  ]);
  if (!targetPlan || !sourceDay) return null;

  const [nextIndex, sourceSettings, sourceSlots] = await Promise.all([
    db.getFirstAsync<{ n: number }>(
      'select coalesce(max(day_index) + 1, 0) as n from program_days where program_id = ? and deleted_at is null',
      targetPlanId,
    ),
    db.getFirstAsync<{
      active: number;
      category: string;
      notes: string | null;
      repeat_every: number;
      repeat_unit: string;
      weekdays: string;
      set_rest_s: number | null;
      exercise_rest_s: number | null;
    }>(`select active, category, notes, repeat_every, repeat_unit, weekdays,
              set_rest_s, exercise_rest_s
           from program_day_settings
          where program_day_id = ?`, sourceProgramDayId),
    db.getAllAsync<Row>(
      `select * from program_slots
        where program_day_id = ? and deleted_at is null
        order by slot_index`,
      sourceProgramDayId,
    ),
  ]);

  const ts = nowIso();
  const nextProgramDayId = idFn();
  await upsertWithMutation(db, 'program_days', {
    id: nextProgramDayId,
    program_id: targetPlanId,
    day_index: nextIndex?.n ?? 0,
    name: sourceDay.name,
    updated_at: ts,
    deleted_at: null,
  }, idFn);
  await saveProgramDaySettings(db, {
    userId,
    programDayId: nextProgramDayId,
    active: sourceSettings?.active === undefined ? true : !!sourceSettings.active,
    category: normalizeProgramCategory(sourceSettings?.category ?? inferProgramCategory(sourceDay.name)),
    notes: sourceSettings?.notes ?? null,
    repeatEvery: sourceSettings?.repeat_every ?? 1,
    repeatUnit: normalizeRepeatUnit(sourceSettings?.repeat_unit),
    weekdays: parseWeekdays(sourceSettings?.weekdays),
    setRestSeconds: normalizeRestSeconds(sourceSettings?.set_rest_s),
    exerciseRestSeconds: normalizeRestSeconds(sourceSettings?.exercise_rest_s),
  });
  for (const slot of sourceSlots) {
    await upsertWithMutation(db, 'program_slots', {
      ...slot,
      id: idFn(),
      program_day_id: nextProgramDayId,
      updated_at: ts,
      deleted_at: null,
    }, idFn);
  }
  return nextProgramDayId;
}

export async function saveSlotState(db: SqlDb, state: SlotState, idFn: IdFn): Promise<void> {
  const row = await db.getFirstAsync<Row>('select * from program_slots where id = ?', state.slotId);
  if (!row) return;
  await upsertWithMutation(db, 'program_slots', {
    ...row,
    exercise_id: state.exerciseId,
    state: JSON.stringify(state),
    updated_at: nowIso(),
  }, idFn);
}

export async function reorderProgramSlots(
  db: SqlDb,
  programDayId: string,
  orderedSlotIds: string[],
  idFn: IdFn,
): Promise<void> {
  const rows = await db.getAllAsync<Row>(
    `select * from program_slots
      where program_day_id = ? and deleted_at is null
      order by slot_index`,
    programDayId,
  );
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const ts = nowIso();
  await db.withTransactionAsync(async () => {
    for (let index = 0; index < orderedSlotIds.length; index++) {
      const row = byId.get(orderedSlotIds[index]!);
      if (!row) continue;
      const updated: Row = { ...row, slot_index: index, updated_at: ts };
      const cols = Object.keys(updated);
      await db.runAsync(
        `insert into program_slots (${cols.join(', ')}) values (${cols.map(() => '?').join(', ')})
         on conflict (id) do update set ${cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')}`,
        ...cols.map((c) => updated[c] ?? null),
      );
      await db.runAsync(
        `insert into mutation_queue (id, entity, entity_id, op, payload, created_at)
         values (?, 'program_slots', ?, 'upsert', ?, ?)`,
        idFn(),
        String(updated.id),
        JSON.stringify(updated),
        ts,
      );
    }
  });
}

export async function addMovementToProgramDay(
  db: SqlDb,
  programDayId: string,
  exerciseId: string,
  args: { sets?: number | null; reps?: number | null },
  idFn: IdFn,
): Promise<ProgramSlotOverview> {
  const exercise = await db.getFirstAsync<{
    id: string;
    name: string;
    pattern: string;
    equipment: string;
    default_sets: number | null;
    default_reps: number | null;
  }>(
    'select id, name, pattern, equipment, default_sets, default_reps from exercises where id = ? and deleted_at is null',
    exerciseId,
  );
  if (!exercise) throw new Error('Exercise not found');

  const nextIndex = await db.getFirstAsync<{ n: number }>(
    'select coalesce(max(slot_index) + 1, 0) as n from program_slots where program_day_id = ? and deleted_at is null',
    programDayId,
  );
  const slotId = idFn();
  const sets = normalizeSets(args.sets ?? exercise.default_sets);
  const reps = normalizeReps(args.reps ?? exercise.default_reps);
  const pattern = exercise.pattern as Pattern;
  const rule = defaultRuleForExercise(pattern, exercise.equipment);
  const restS = defaultRestForExercise(pattern);
  const scheme = { sets, reps: [reps, reps] as const };
  const state: SlotState = {
    slotId,
    exerciseId,
    pattern,
    rule,
    rest_s: restS,
    sets,
    reps: scheme.reps,
    stallCycles: 0,
  };
  await upsertWithMutation(db, 'program_slots', {
    id: slotId,
    program_day_id: programDayId,
    slot_index: nextIndex?.n ?? 0,
    pattern,
    exercise_id: exerciseId,
    scheme: JSON.stringify(scheme),
    rule,
    rest_s: restS,
    state: JSON.stringify(state),
    updated_at: nowIso(),
    deleted_at: null,
  }, idFn);
  return {
    slotId,
    slotIndex: nextIndex?.n ?? 0,
    pattern,
    exerciseId,
    exerciseName: exercise.name,
    rule,
    restS,
    scheme,
  };
}

// ---------------------------------------------------------------------------
// active workout
// ---------------------------------------------------------------------------

export interface InProgressWorkoutOverview {
  workoutId: string;
  programDayId: string | null;
  startedAt: string;
  dayName: string | null;
  customName: string | null;
  completedSets: number;
  updatedAt: string;
}

export interface WorkoutDraftSetUiState {
  weight: string;
  reps: string;
  done: boolean;
}

export type WorkoutDraftSetUi = Record<string, WorkoutDraftSetUiState>;

export interface WorkoutDraftData {
  workoutId: string;
  userId: string;
  programDayId: string | null;
  startedAt: string;
  customName: string | null;
  day: NextDay;
  plan: SessionPlan;
  setUi: WorkoutDraftSetUi;
  activeIndex: number;
  restRemainingS: number | null;
  updatedAt: string;
}

function defaultSetUiForPlan(plan: SessionPlan): WorkoutDraftSetUi {
  const next: WorkoutDraftSetUi = {};
  for (const prescription of plan.prescriptions) {
    for (const set of prescription.sets) {
      next[`${prescription.slotId}:${set.setIndex}`] = {
        weight: set.weight !== undefined ? String(set.weight) : '',
        reps: String(set.targetSeconds ?? set.targetReps[1]),
        done: false,
      };
    }
  }
  return next;
}

function parseDraftSetUi(value: string): WorkoutDraftSetUi {
  try {
    const parsed = JSON.parse(value) as WorkoutDraftSetUi;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function hydrateDraftSetUi(
  db: SqlDb,
  workoutId: string,
  plan: SessionPlan,
  stored: WorkoutDraftSetUi,
): Promise<WorkoutDraftSetUi> {
  const defaultSetUi = defaultSetUiForPlan(plan);
  const next: WorkoutDraftSetUi = { ...stored, ...defaultSetUi };
  for (const key of Object.keys(defaultSetUi)) {
    const saved = stored[key];
    if (saved) {
      next[key] = {
        weight: String(saved.weight ?? next[key]!.weight),
        reps: String(saved.reps ?? next[key]!.reps),
        done: false,
      };
    }
  }

  const completed = await db.getAllAsync<{
    exercise_id: string;
    set_index: number;
    weight: number | null;
    reps: number | null;
    is_warmup: number;
  }>(
    `select exercise_id, set_index, weight, reps, is_warmup
       from sets
      where workout_id = ? and deleted_at is null`,
    workoutId,
  );

  for (const row of completed) {
    for (const prescription of plan.prescriptions) {
      if (prescription.exerciseId !== row.exercise_id) continue;
      const set = prescription.sets.find((item) => item.setIndex === row.set_index && Number(!!item.isWarmup) === row.is_warmup);
      if (!set) continue;
      const key = `${prescription.slotId}:${set.setIndex}`;
      if (!next[key]) continue;
      next[key] = {
        weight: row.weight !== null ? String(row.weight) : next[key]!.weight,
        reps: row.reps !== null ? String(row.reps) : next[key]!.reps,
        done: true,
      };
    }
  }

  return next;
}

export async function getProgramDayContext(db: SqlDb, programDayId: string): Promise<NextDay | null> {
  const row = await db.getFirstAsync<{
    id: string;
    program_id: string;
    day_index: number;
    name: string;
    set_rest_s: number | null;
    exercise_rest_s: number | null;
  }>(
    `select d.id, d.program_id, d.day_index, d.name, s.set_rest_s, s.exercise_rest_s
       from program_days d
       left join program_day_settings s on s.program_day_id = d.id and s.deleted_at is null
      where d.id = ? and d.deleted_at is null`,
    programDayId,
  );
  if (!row) return null;

  const days = await db.getFirstAsync<{ n: number }>(
    'select count(*) as n from program_days where program_id = ? and deleted_at is null',
    row.program_id,
  );
  const done = await db.getFirstAsync<{ n: number }>(
    `select count(*) as n from workouts w
      join program_days d on d.id = w.program_day_id
     where d.program_id = ? and w.ended_at is not null and w.deleted_at is null`,
    row.program_id,
  );
  const daysPerWeek = Math.max(1, days?.n ?? 1);
  const completed = done?.n ?? 0;
  return {
    dayId: row.id,
    dayIndex: row.day_index,
    name: row.name,
    week: Math.floor(completed / daysPerWeek) + 1,
    completedThisWeek: completed % daysPerWeek,
    daysPerWeek,
    setRestSeconds: normalizeRestSeconds(row.set_rest_s),
    exerciseRestSeconds: normalizeRestSeconds(row.exercise_rest_s),
  };
}

export async function getWorkoutOverview(
  db: SqlDb,
  workoutId: string,
  userId?: string,
): Promise<InProgressWorkoutOverview | null> {
  return db.getFirstAsync<InProgressWorkoutOverview>(
    `select w.id as workoutId,
            w.program_day_id as programDayId,
            w.started_at as startedAt,
            d.name as dayName,
            w.notes as customName,
            count(s.id) as completedSets,
            w.updated_at as updatedAt
       from workouts w
       left join program_days d on d.id = w.program_day_id
       left join sets s on s.workout_id = w.id and s.deleted_at is null
      where w.id = ?
        and (? is null or w.user_id = ?)
        and w.ended_at is null
        and w.deleted_at is null
      group by w.id, w.program_day_id, w.started_at, d.name, w.notes, w.updated_at`,
    workoutId,
    userId ?? null,
    userId ?? null,
  );
}

export async function getInProgressWorkoutOverview(db: SqlDb, userId: string): Promise<InProgressWorkoutOverview | null> {
  return db.getFirstAsync<InProgressWorkoutOverview>(
    `select w.id as workoutId,
            w.program_day_id as programDayId,
            w.started_at as startedAt,
            d.name as dayName,
            w.notes as customName,
            count(s.id) as completedSets,
            w.updated_at as updatedAt
       from workouts w
       left join program_days d on d.id = w.program_day_id
       left join sets s on s.workout_id = w.id and s.deleted_at is null
      where w.user_id = ? and w.ended_at is null and w.deleted_at is null
      group by w.id, w.program_day_id, w.started_at, d.name, w.notes, w.updated_at
      order by w.started_at desc
      limit 1`,
    userId,
  );
}

export async function getInProgressWorkout(db: SqlDb, userId: string): Promise<string | null> {
  return (await getInProgressWorkoutOverview(db, userId))?.workoutId ?? null;
}

export interface StartWorkoutResult {
  workoutId: string;
  created: boolean;
}

const workoutStartTails = new WeakMap<SqlDb, Map<string, Promise<void>>>();

function serializeWorkoutStart<T>(db: SqlDb, userId: string, operation: () => Promise<T>): Promise<T> {
  let dbTails = workoutStartTails.get(db);
  if (!dbTails) {
    dbTails = new Map();
    workoutStartTails.set(db, dbTails);
  }
  const previous = dbTails.get(userId) ?? Promise.resolve();
  const result = previous.catch(() => {}).then(operation);
  const tail = result.then(() => {}, () => {});
  dbTails.set(userId, tail);
  return result.finally(() => {
    if (dbTails?.get(userId) === tail) dbTails.delete(userId);
  });
}

export async function discardEmptyInProgressWorkouts(
  db: SqlDb,
  userId: string,
  idFn: IdFn,
  keepWorkoutId?: string | null,
): Promise<number> {
  const rows = await db.getAllAsync<{ id: string }>(
    `select w.id
       from workouts w
      where w.user_id = ?
        and w.ended_at is null
        and w.deleted_at is null
        and (? is null or w.id != ?)
        and not exists (
          select 1 from sets s
           where s.workout_id = w.id and s.deleted_at is null
        )`,
    userId,
    keepWorkoutId ?? null,
    keepWorkoutId ?? null,
  );

  const ts = nowIso();
  for (const row of rows) {
    await softDeleteWithMutation(db, 'workouts', row.id, idFn);
    await db.runAsync('update workout_drafts set deleted_at = ?, updated_at = ? where workout_id = ?', ts, ts, row.id);
  }
  return rows.length;
}

export function startWorkoutWithStatus(
  db: SqlDb,
  userId: string,
  programDayId: string,
  idFn: IdFn,
  readinessScore?: number,
): Promise<StartWorkoutResult> {
  return serializeWorkoutStart(db, userId, async () => {
    const existing = await getInProgressWorkoutOverview(db, userId);
    if (existing) return { workoutId: existing.workoutId, created: false };

    const id = idFn();
    const ts = nowIso();
    await upsertWithMutation(db, 'workouts', {
      id,
      user_id: userId,
      program_day_id: programDayId,
      started_at: ts,
      ended_at: null,
      notes: null,
      readiness_at_start: readinessScore ?? null,
      updated_at: ts,
      deleted_at: null,
    }, idFn);
    return { workoutId: id, created: true };
  });
}

export async function startWorkout(
  db: SqlDb,
  userId: string,
  programDayId: string,
  idFn: IdFn,
  readinessScore?: number,
): Promise<string> {
  return (await startWorkoutWithStatus(db, userId, programDayId, idFn, readinessScore)).workoutId;
}

export async function renameWorkout(db: SqlDb, workoutId: string, name: string | null, idFn: IdFn): Promise<void> {
  const row = await db.getFirstAsync<Row>('select * from workouts where id = ? and deleted_at is null', workoutId);
  if (!row) return;
  const trimmed = name?.trim() ?? '';
  await upsertWithMutation(db, 'workouts', {
    ...row,
    notes: trimmed.length > 0 ? trimmed : null,
    updated_at: nowIso(),
  }, idFn);
}

export async function saveWorkoutDraft(
  db: SqlDb,
  args: {
    workoutId: string;
    userId: string;
    programDayId: string | null;
    day: NextDay;
    plan: SessionPlan;
    setUi: WorkoutDraftSetUi;
    activeIndex: number;
    restRemainingS: number | null;
    restSavedAt?: string | null;
  },
): Promise<void> {
  const ts = nowIso();
  const restRemainingS = args.restRemainingS === null ? null : Math.max(0, Math.round(args.restRemainingS));
  await db.runAsync(
    `insert into workout_drafts (
       workout_id, user_id, program_day_id, day_json, plan_json, set_ui_json,
       active_index, rest_remaining_s, rest_saved_at, updated_at, deleted_at
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null)
     on conflict (workout_id) do update set
       user_id = excluded.user_id,
       program_day_id = excluded.program_day_id,
       day_json = excluded.day_json,
       plan_json = excluded.plan_json,
       set_ui_json = excluded.set_ui_json,
       active_index = excluded.active_index,
       rest_remaining_s = excluded.rest_remaining_s,
       rest_saved_at = excluded.rest_saved_at,
       updated_at = excluded.updated_at,
       deleted_at = null`,
    args.workoutId,
    args.userId,
    args.programDayId,
    JSON.stringify(args.day),
    JSON.stringify(args.plan),
    JSON.stringify(args.setUi),
    Math.max(0, Math.min(args.activeIndex, args.plan.prescriptions.length - 1)),
    restRemainingS,
    restRemainingS === null ? null : args.restSavedAt ?? ts,
    ts,
  );
}

export async function getWorkoutDraft(db: SqlDb, workoutId: string): Promise<WorkoutDraftData | null> {
  const row = await db.getFirstAsync<{
    workout_id: string;
    user_id: string;
    program_day_id: string | null;
    started_at: string;
    custom_name: string | null;
    day_json: string;
    plan_json: string;
    set_ui_json: string;
    active_index: number;
    rest_remaining_s: number | null;
    rest_saved_at: string | null;
    updated_at: string;
  }>(
    `select wd.workout_id, wd.user_id, wd.program_day_id, w.started_at, w.notes as custom_name,
            wd.day_json, wd.plan_json, wd.set_ui_json, wd.active_index,
            wd.rest_remaining_s, wd.rest_saved_at, wd.updated_at
       from workout_drafts wd
       join workouts w on w.id = wd.workout_id
      where wd.workout_id = ?
        and wd.deleted_at is null
        and w.deleted_at is null
        and w.ended_at is null`,
    workoutId,
  );
  if (!row) return null;

  const plan = JSON.parse(row.plan_json) as SessionPlan;
  const savedAt = row.rest_saved_at ?? row.updated_at;
  const restRemainingS = row.rest_remaining_s === null
    ? null
    : Math.max(0, Math.round(row.rest_remaining_s - (Date.now() - Date.parse(savedAt)) / 1000));
  return {
    workoutId: row.workout_id,
    userId: row.user_id,
    programDayId: row.program_day_id,
    startedAt: row.started_at,
    customName: row.custom_name,
    day: JSON.parse(row.day_json) as NextDay,
    plan,
    setUi: await hydrateDraftSetUi(db, row.workout_id, plan, parseDraftSetUi(row.set_ui_json)),
    activeIndex: Math.max(0, Math.min(row.active_index, plan.prescriptions.length - 1)),
    restRemainingS: restRemainingS && restRemainingS > 0 ? restRemainingS : null,
    updatedAt: row.updated_at,
  };
}

/**
 * Durable per-set logging (brief Part F): each checked set is one
 * transaction (row + queue append) — a crash mid-session loses nothing.
 */
export async function logSet(
  db: SqlDb,
  args: {
    workoutId: string;
    exerciseId: string;
    setIndex: number;
    weight: number | null;
    reps: number | null;
    isWarmup?: boolean;
  },
  idFn: IdFn,
): Promise<string> {
  const id = idFn();
  const ts = nowIso();
  await upsertWithMutation(db, 'sets', {
    id,
    workout_id: args.workoutId,
    exercise_id: args.exerciseId,
    set_index: args.setIndex,
    weight: args.weight,
    reps: args.reps,
    is_warmup: args.isWarmup ? 1 : 0,
    completed_at: ts,
    updated_at: ts,
    deleted_at: null,
  }, idFn);
  return id;
}

export async function unlogSet(
  db: SqlDb,
  args: { workoutId: string; exerciseId: string; setIndex: number; isWarmup?: boolean },
  idFn: IdFn,
): Promise<boolean> {
  const row = await db.getFirstAsync<{ id: string }>(
    `select id from sets
      where workout_id = ? and exercise_id = ? and set_index = ? and is_warmup = ? and deleted_at is null
      order by completed_at desc
      limit 1`,
    args.workoutId,
    args.exerciseId,
    args.setIndex,
    args.isWarmup ? 1 : 0,
  );
  if (!row) return false;
  await softDeleteWithMutation(db, 'sets', row.id, idFn);
  return true;
}

export async function finishWorkout(db: SqlDb, workoutId: string, idFn: IdFn): Promise<void> {
  const row = await db.getFirstAsync<Row>('select * from workouts where id = ?', workoutId);
  if (!row) return;
  const ts = nowIso();
  await upsertWithMutation(db, 'workouts', { ...row, ended_at: ts, updated_at: ts }, idFn);
  await db.runAsync('update workout_drafts set deleted_at = ?, updated_at = ? where workout_id = ?', ts, ts, workoutId);
}

export async function discardWorkout(db: SqlDb, workoutId: string, idFn: IdFn): Promise<boolean> {
  const workout = await db.getFirstAsync<{ id: string; ended_at: string | null }>(
    'select id, ended_at from workouts where id = ? and deleted_at is null',
    workoutId,
  );
  if (!workout || workout.ended_at) return false;

  const setRows = await db.getAllAsync<{ id: string }>(
    'select id from sets where workout_id = ? and deleted_at is null',
    workoutId,
  );
  for (const row of setRows) {
    await softDeleteWithMutation(db, 'sets', row.id, idFn);
  }
  await softDeleteWithMutation(db, 'workouts', workoutId, idFn);
  const ts = nowIso();
  await db.runAsync('update workout_drafts set deleted_at = ?, updated_at = ? where workout_id = ?', ts, ts, workoutId);
  return true;
}

/** Ghost values: the previous session's actuals per exercise, by set index. */
export async function getPreviousSession(
  db: SqlDb,
  userId: string,
  exerciseId: string,
  beforeWorkoutId: string,
): Promise<{ weight: number | null; reps: number | null }[]> {
  const prev = await db.getFirstAsync<{ id: string }>(
    `select w.id from workouts w
     where w.user_id = ? and w.id != ? and w.deleted_at is null
       and exists (select 1 from sets s where s.workout_id = w.id and s.exercise_id = ? and s.deleted_at is null)
     order by w.started_at desc limit 1`,
    userId,
    beforeWorkoutId,
    exerciseId,
  );
  if (!prev) return [];
  return db.getAllAsync(
    `select weight, reps from sets where workout_id = ? and exercise_id = ? and is_warmup = 0 and deleted_at is null order by set_index`,
    prev.id,
    exerciseId,
  );
}

// ---------------------------------------------------------------------------
// progress analytics
// ---------------------------------------------------------------------------

export interface ProgressPeriodStats {
  volume: number;
  sessions: number;
  sets: number;
}

export interface ProgressWeekStats extends ProgressPeriodStats {
  startedAt: string;
}

export interface ProgressExerciseComparison {
  exerciseId: string;
  exerciseName: string;
  sessions: number;
  currentBestE1rm: number;
  previousBestE1rm: number | null;
  deltaE1rm: number | null;
}

export interface ProgressAnalyticsData {
  rangeDays: 28 | 84;
  current: ProgressPeriodStats;
  previous: ProgressPeriodStats;
  weekly: ProgressWeekStats[];
  exercises: ProgressExerciseComparison[];
}

interface ProgressAnalyticsRow {
  workout_id: string;
  started_at: string;
  exercise_id: string;
  exercise_name: string;
  volume: number;
  sets: number;
  best_e1rm: number;
}

export async function getProgressAnalytics(
  db: SqlDb,
  userId: string,
  rangeDays: 28 | 84,
  asOf = nowIso(),
): Promise<ProgressAnalyticsData> {
  const dayMs = 24 * 60 * 60 * 1000;
  const weekMs = 7 * dayMs;
  const endMs = Date.parse(asOf);
  if (!Number.isFinite(endMs)) throw new Error('Invalid Progress analytics date.');
  const currentStartMs = endMs - rangeDays * dayMs;
  const previousStartMs = currentStartMs - rangeDays * dayMs;

  const rows = await db.getAllAsync<ProgressAnalyticsRow>(
    `select w.id as workout_id, w.started_at, s.exercise_id,
            coalesce(e.name, s.exercise_id) as exercise_name,
            coalesce(sum(coalesce(s.weight, 0) * coalesce(s.reps, 0)), 0) as volume,
            count(s.id) as sets,
            max(coalesce(s.weight, 0) * (1 + coalesce(s.reps, 0) / 30.0)) as best_e1rm
       from workouts w
       join sets s on s.workout_id = w.id
       left join exercises e on e.id = s.exercise_id and e.deleted_at is null
      where w.user_id = ?
        and w.ended_at is not null
        and w.deleted_at is null
        and s.deleted_at is null
        and s.is_warmup = 0
        and w.started_at >= ?
        and w.started_at < ?
      group by w.id, w.started_at, s.exercise_id, e.name
      order by w.started_at`,
    userId,
    new Date(previousStartMs).toISOString(),
    new Date(endMs).toISOString(),
  );

  const periodStats = (periodRows: ProgressAnalyticsRow[]): ProgressPeriodStats => ({
    volume: periodRows.reduce((sum, row) => sum + row.volume, 0),
    sessions: new Set(periodRows.map((row) => row.workout_id)).size,
    sets: periodRows.reduce((sum, row) => sum + row.sets, 0),
  });
  const currentRows = rows.filter((row) => Date.parse(row.started_at) >= currentStartMs);
  const previousRows = rows.filter((row) => Date.parse(row.started_at) < currentStartMs);

  const weekCount = rangeDays / 7;
  const weeklyAccumulators = Array.from({ length: weekCount }, (_, index) => ({
    startedAt: new Date(currentStartMs + index * weekMs).toISOString(),
    volume: 0,
    sets: 0,
    workoutIds: new Set<string>(),
  }));
  for (const row of currentRows) {
    const bucketIndex = Math.min(weekCount - 1, Math.floor((Date.parse(row.started_at) - currentStartMs) / weekMs));
    const bucket = weeklyAccumulators[bucketIndex];
    if (!bucket) continue;
    bucket.volume += row.volume;
    bucket.sets += row.sets;
    bucket.workoutIds.add(row.workout_id);
  }

  const exerciseAccumulators = new Map<string, {
    exerciseName: string;
    currentWorkoutIds: Set<string>;
    currentBestE1rm: number;
    previousBestE1rm: number;
  }>();
  for (const row of rows) {
    if (row.best_e1rm <= 0) continue;
    const exercise = exerciseAccumulators.get(row.exercise_id) ?? {
      exerciseName: row.exercise_name,
      currentWorkoutIds: new Set<string>(),
      currentBestE1rm: 0,
      previousBestE1rm: 0,
    };
    if (Date.parse(row.started_at) >= currentStartMs) {
      exercise.currentWorkoutIds.add(row.workout_id);
      exercise.currentBestE1rm = Math.max(exercise.currentBestE1rm, row.best_e1rm);
    } else {
      exercise.previousBestE1rm = Math.max(exercise.previousBestE1rm, row.best_e1rm);
    }
    exerciseAccumulators.set(row.exercise_id, exercise);
  }

  const exercises = Array.from(exerciseAccumulators.entries())
    .filter(([, exercise]) => exercise.currentWorkoutIds.size > 0)
    .map(([exerciseId, exercise]): ProgressExerciseComparison => {
      const previousBestE1rm = exercise.previousBestE1rm > 0 ? exercise.previousBestE1rm : null;
      return {
        exerciseId,
        exerciseName: exercise.exerciseName,
        sessions: exercise.currentWorkoutIds.size,
        currentBestE1rm: exercise.currentBestE1rm,
        previousBestE1rm,
        deltaE1rm: previousBestE1rm === null ? null : exercise.currentBestE1rm - previousBestE1rm,
      };
    })
    .sort((a, b) =>
      b.sessions - a.sessions
      || Math.abs(b.deltaE1rm ?? 0) - Math.abs(a.deltaE1rm ?? 0)
      || a.exerciseName.localeCompare(b.exerciseName));

  return {
    rangeDays,
    current: periodStats(currentRows),
    previous: periodStats(previousRows),
    weekly: weeklyAccumulators.map((week) => ({
      startedAt: week.startedAt,
      volume: week.volume,
      sessions: week.workoutIds.size,
      sets: week.sets,
    })),
    exercises,
  };
}

// ---------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------

export interface WorkoutSummaryData {
  workoutId: string;
  startedAt: string;
  endedAt: string | null;
  dayName: string | null;
  customName: string | null;
  readinessAtStart: number | null;
  durationS: number;
  totalVolume: number;
  totalSets: number;
  sets: { exercise_id: string; set_index: number; weight: number | null; reps: number | null; is_warmup: number; completed_at: string }[];
  subjective: {
    energy: number | null;
    mood: number | null;
    sleepQuality: number | null;
    soreness: number | null;
  } | null;
  records: {
    exerciseId: string;
    type: string;
    value: number;
    achievedAt: string;
  }[];
}

export async function getWorkoutSummary(db: SqlDb, workoutId: string): Promise<WorkoutSummaryData | null> {
  const w = await db.getFirstAsync<{
    id: string;
    started_at: string;
    ended_at: string | null;
    program_day_id: string | null;
    notes: string | null;
    readiness_at_start: number | null;
  }>(
    'select id, started_at, ended_at, program_day_id, notes, readiness_at_start from workouts where id = ? and deleted_at is null',
    workoutId,
  );
  if (!w) return null;
  const [day, sets, subjective, records] = await Promise.all([
    w.program_day_id
      ? db.getFirstAsync<{ name: string }>('select name from program_days where id = ?', w.program_day_id)
      : Promise.resolve(null),
    getWorkoutSets(db, workoutId),
    db.getFirstAsync<{
      energy: number | null;
      mood: number | null;
      sleep_quality: number | null;
      soreness: number | null;
    }>(
      `select energy, mood, sleep_quality, soreness
         from subjective_tags
        where workout_id = ? and deleted_at is null
        order by updated_at desc
        limit 1`,
      workoutId,
    ),
    db.getAllAsync<{
      exercise_id: string;
      type: string;
      value: number;
      achieved_at: string;
    }>(
      `select exercise_id, type, value, achieved_at
         from personal_records
        where workout_id = ? and deleted_at is null
        order by achieved_at desc`,
      workoutId,
    ),
  ]);
  const work = sets.filter((s) => !s.is_warmup);
  return {
    workoutId,
    startedAt: w.started_at,
    endedAt: w.ended_at,
    dayName: day?.name ?? null,
    customName: w.notes,
    readinessAtStart: w.readiness_at_start,
    durationS: w.ended_at
      ? Math.max(0, Math.round((Date.parse(w.ended_at) - Date.parse(w.started_at)) / 1000))
      : 0,
    totalVolume: work.reduce((t, s) => t + (s.weight ?? 0) * (s.reps ?? 0), 0),
    totalSets: work.length,
    sets,
    subjective: subjective ? {
      energy: subjective.energy,
      mood: subjective.mood,
      sleepQuality: subjective.sleep_quality,
      soreness: subjective.soreness,
    } : null,
    records: records.map((record) => ({
      exerciseId: record.exercise_id,
      type: record.type,
      value: record.value,
      achievedAt: record.achieved_at,
    })),
  };
}

export async function getWorkoutSets(db: SqlDb, workoutId: string) {
  return db.getAllAsync<WorkoutSummaryData['sets'][number]>(
    'select exercise_id, set_index, weight, reps, is_warmup, completed_at from sets where workout_id = ? and deleted_at is null order by completed_at',
    workoutId,
  );
}

export async function savePersonalRecord(
  db: SqlDb,
  args: { userId: string; exerciseId: string; type: string; value: number; workoutId: string },
  idFn: IdFn,
): Promise<void> {
  const ts = nowIso();
  await upsertWithMutation(db, 'personal_records', {
    id: idFn(),
    user_id: args.userId,
    exercise_id: args.exerciseId,
    type: args.type,
    value: args.value,
    workout_id: args.workoutId,
    achieved_at: ts,
    updated_at: ts,
    deleted_at: null,
  }, idFn);
}

export async function saveSubjectiveTag(
  db: SqlDb,
  args: {
    userId: string;
    workoutId: string;
    energy: number;
    mood: number;
    sleepQuality?: number | null;
    soreness?: number | null;
  },
  idFn: IdFn,
): Promise<void> {
  const ts = nowIso();
  await upsertWithMutation(db, 'subjective_tags', {
    id: idFn(),
    user_id: args.userId,
    workout_id: args.workoutId,
    date: dateOf(ts),
    energy: args.energy,
    mood: args.mood,
    sleep_quality: args.sleepQuality ?? null,
    soreness: args.soreness ?? null,
    updated_at: ts,
    deleted_at: null,
  }, idFn);
}
