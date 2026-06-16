import {
  applyReadiness,
  exerciseCatalog,
  instantiateProgram,
  nextPrescription,
  selectArchetype,
  type OnboardingAnswers,
  type ProgramPlan,
  type Readiness,
  type SessionPlan,
  type SetLog,
  type SlotState,
} from '@atrium/engine';
import { upsertWithMutation, type IdFn, type Row } from './dao';
import type { SqlDb } from './schema';

/**
 * Domain reads/writes for the three core screens. Everything is written
 * against the SqlDb surface so it runs identically under expo-sqlite
 * (device) and node:sqlite (tests). All reads come from SQLite only.
 */

const nowIso = () => new Date().toISOString();
const dateOf = (iso: string) => iso.slice(0, 10);

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
}

export async function getActiveProgram(db: SqlDb, userId: string): Promise<ProgramInfo | null> {
  return db.getFirstAsync<ProgramInfo>(
    "select id, archetype_id, current_week from programs where user_id = ? and status = 'active' and deleted_at is null",
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
}

/** Rotation: completed workouts → next day_index; week = floor(count / days) + 1. */
export async function getNextProgramDay(db: SqlDb, programId: string): Promise<NextDay | null> {
  const days = await db.getAllAsync<{ id: string; day_index: number; name: string }>(
    'select id, day_index, name from program_days where program_id = ? and deleted_at is null order by day_index',
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
  return applyReadiness(plan, readiness);
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

// ---------------------------------------------------------------------------
// active workout
// ---------------------------------------------------------------------------

export async function getInProgressWorkout(db: SqlDb, userId: string): Promise<string | null> {
  const r = await db.getFirstAsync<{ id: string }>(
    'select id from workouts where user_id = ? and ended_at is null and deleted_at is null order by started_at desc',
    userId,
  );
  return r?.id ?? null;
}

export async function startWorkout(
  db: SqlDb,
  userId: string,
  programDayId: string,
  idFn: IdFn,
  readinessScore?: number,
): Promise<string> {
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
  return id;
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

export async function finishWorkout(db: SqlDb, workoutId: string, idFn: IdFn): Promise<void> {
  const row = await db.getFirstAsync<Row>('select * from workouts where id = ?', workoutId);
  if (!row) return;
  await upsertWithMutation(db, 'workouts', { ...row, ended_at: nowIso(), updated_at: nowIso() }, idFn);
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
// summary
// ---------------------------------------------------------------------------

export interface WorkoutSummaryData {
  workoutId: string;
  startedAt: string;
  endedAt: string | null;
  dayName: string | null;
  durationS: number;
  totalVolume: number;
  totalSets: number;
  sets: { exercise_id: string; set_index: number; weight: number | null; reps: number | null; is_warmup: number; completed_at: string }[];
}

export async function getWorkoutSummary(db: SqlDb, workoutId: string): Promise<WorkoutSummaryData | null> {
  const w = await db.getFirstAsync<{ id: string; started_at: string; ended_at: string | null; program_day_id: string | null }>(
    'select id, started_at, ended_at, program_day_id from workouts where id = ?',
    workoutId,
  );
  if (!w) return null;
  const day = w.program_day_id
    ? await db.getFirstAsync<{ name: string }>('select name from program_days where id = ?', w.program_day_id)
    : null;
  const sets = await getWorkoutSets(db, workoutId);
  const work = sets.filter((s) => !s.is_warmup);
  return {
    workoutId,
    startedAt: w.started_at,
    endedAt: w.ended_at,
    dayName: day?.name ?? null,
    durationS: w.ended_at
      ? Math.max(0, Math.round((Date.parse(w.ended_at) - Date.parse(w.started_at)) / 1000))
      : 0,
    totalVolume: work.reduce((t, s) => t + (s.weight ?? 0) * (s.reps ?? 0), 0),
    totalSets: work.length,
    sets,
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
  args: { userId: string; workoutId: string; energy: number; mood: number },
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
    sleep_quality: null,
    soreness: null,
    updated_at: ts,
    deleted_at: null,
  }, idFn);
}
