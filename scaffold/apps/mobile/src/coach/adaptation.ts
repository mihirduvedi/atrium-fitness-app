import {
  detectStalls,
  exerciseCatalog,
  shouldDeload,
  type DeloadDecision,
  type Readiness,
  type SetLog,
  type SlotStall,
  type SlotState,
  type StallReport,
} from '@atrium/engine';
import type { SqlDb } from '../db/schema';
import { getReadinessSignal } from '../health/readiness';

export const COACH_DELOAD_PLAN_MARKER = 'atrium:coach-proposal-kind:deload_session';

/**
 * Local/dev builds expose the recruiter-visible slice immediately. Production
 * builds require an explicit rollout flag so deload workouts are not enabled
 * until every supported syncing client understands the intent side table.
 */
export function adaptiveDeloadEnabled(
  nodeEnv = process.env.NODE_ENV,
  rolloutFlag = process.env.EXPO_PUBLIC_ATRIUM_ADAPTIVE_DELOAD_ENABLED,
) {
  return nodeEnv !== 'production' || rolloutFlag === '1';
}

export interface CoachAdaptationLift {
  exerciseName: string;
  reason: string;
}

export interface CoachAdaptationSignal {
  stalled: CoachAdaptationLift[];
  atRisk: CoachAdaptationLift[];
  recentReadiness: {
    observedDays: number;
    redDays: number;
    states: Readiness[];
  };
  deload: DeloadDecision;
  reasonLabel: string | null;
}

interface AdaptationAnalysisInput {
  slots: SlotState[];
  history: SetLog[];
  readinessLog: Readiness[];
  week: number;
  weekStart: string;
  throughDate: string;
  deloadAlreadyThisBlock?: boolean;
  completedDeloadWithinSignalWindow?: boolean;
}

function uniqueCurrentWeekStalls(
  entries: SlotStall[],
  history: SetLog[],
  weekStart: string,
  throughDate: string,
) {
  const latestByExercise = new Map<string, string>();
  for (const set of history) {
    if (set.isWarmup) continue;
    const latest = latestByExercise.get(set.exerciseId);
    if (!latest || set.sessionDate > latest) latestByExercise.set(set.exerciseId, set.sessionDate);
  }
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const latest = latestByExercise.get(entry.exerciseId);
    if (!latest || latest < weekStart || latest > throughDate || seen.has(entry.exerciseId)) return false;
    seen.add(entry.exerciseId);
    return true;
  });
}

function displayLift(entry: SlotStall): CoachAdaptationLift {
  return {
    exerciseName: exerciseCatalog[entry.exerciseId]?.name ?? 'Custom exercise',
    reason: entry.reason,
  };
}

function labelForDecision(decision: DeloadDecision, stalls: number, redDays: number) {
  if (!decision.deload) return null;
  if (decision.reason === 'two_plus_stalls_same_week') {
    return `${stalls} lifts met their stall criteria this week.`;
  }
  if (decision.reason === 'readiness_red_3plus') {
    return `${redDays} low-readiness days appeared in the recent seven-day log.`;
  }
  return 'Program week 7 reached the scheduled deload checkpoint.';
}

export function analyzeCoachAdaptation(input: AdaptationAnalysisInput): CoachAdaptationSignal {
  const detected = detectStalls(input.slots, input.history);
  const report: StallReport = {
    stalled: uniqueCurrentWeekStalls(
      detected.stalled,
      input.history,
      input.weekStart,
      input.throughDate,
    ),
    atRisk: uniqueCurrentWeekStalls(
      detected.atRisk,
      input.history,
      input.weekStart,
      input.throughDate,
    ),
  };
  const candidateDeload = shouldDeload(input.week, report, input.readinessLog, {
    deloadAlreadyThisBlock: input.deloadAlreadyThisBlock,
  });
  const repeatedAcuteSignal = input.completedDeloadWithinSignalWindow && (
    candidateDeload.reason === 'two_plus_stalls_same_week'
    || candidateDeload.reason === 'readiness_red_3plus'
  );
  const deload: DeloadDecision = repeatedAcuteSignal
    ? { deload: false, reason: 'none' }
    : candidateDeload;
  const redDays = input.readinessLog.filter((state) => state === 'red').length;
  return {
    stalled: report.stalled.map(displayLift),
    atRisk: report.atRisk.map(displayLift),
    recentReadiness: {
      observedDays: input.readinessLog.length,
      redDays,
      states: input.readinessLog,
    },
    deload,
    reasonLabel: labelForDecision(deload, report.stalled.length, redDays),
  };
}

/**
 * Convert an instant to the device calendar day. `timezoneOffsetMinutes`
 * follows Date#getTimezoneOffset: India is -330, Pacific Standard Time is 480.
 * The optional override keeps near-midnight behavior deterministic in tests.
 */
export function coachDeviceDateKey(
  value: Date | string,
  timezoneOffsetMinutes?: number,
) {
  const instant = value instanceof Date ? value : new Date(value);
  const offset = timezoneOffsetMinutes ?? instant.getTimezoneOffset();
  const shifted = new Date(instant.getTime() - offset * 60_000);
  return shifted.toISOString().slice(0, 10);
}

function shiftedDateKey(date: string, days: number) {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function startOfWeekKey(date: Date, timezoneOffsetMinutes?: number) {
  const throughDate = coachDeviceDateKey(date, timezoneOffsetMinutes);
  const day = new Date(`${throughDate}T00:00:00.000Z`).getUTCDay();
  return shiftedDateKey(throughDate, day === 0 ? -6 : 1 - day);
}

async function recentObservedReadiness(
  db: SqlDb,
  userId: string,
  now: Date,
  timezoneOffsetMinutes?: number,
): Promise<Readiness[]> {
  const throughDate = coachDeviceDateKey(now, timezoneOffsetMinutes);
  const sinceDate = shiftedDateKey(throughDate, -6);
  // A workout row always stores a readiness score, including the no-data
  // fallback. Count a day only when health or check-in data proves the score
  // was observed rather than defaulted.
  const observedDates = await db.getAllAsync<{ date: string }>(
    `select date from (
       select date from health_samples
        where user_id = ? and deleted_at is null and date between ? and ?
       union
       select date from subjective_tags
        where user_id = ? and deleted_at is null and date between ? and ?
     ) order by date`,
    userId,
    sinceDate,
    throughDate,
    userId,
    sinceDate,
    throughDate,
  );
  const dates = [...new Set(observedDates.map((row) => row.date))].sort();
  return Promise.all(dates.map(async (date) => (
    (await getReadinessSignal(db, userId, date)).readiness
  )));
}

async function completedProgramHistory(
  db: SqlDb,
  userId: string,
  programId: string,
  timezoneOffsetMinutes?: number,
): Promise<SetLog[]> {
  const rows = await db.getAllAsync<{
    exercise_id: string;
    started_at: string;
    set_index: number;
    weight: number | null;
    reps: number | null;
    is_warmup: number;
  }>(
    `select s.exercise_id, w.started_at, s.set_index, s.weight, s.reps, s.is_warmup
       from sets s
       join workouts w on w.id = s.workout_id
       join program_days d on d.id = w.program_day_id
      where w.user_id = ?
        and d.program_id = ?
        and w.ended_at is not null
        and w.deleted_at is null
        and not exists (
          select 1
            from workout_training_intents intent
           where intent.id = w.id
             and intent.intent = 'coach_deload'
             and intent.deleted_at is null
        )
        and d.deleted_at is null
        and s.deleted_at is null
      order by w.started_at, s.set_index`,
    userId,
    programId,
  );
  return rows.map((row) => ({
    exerciseId: row.exercise_id,
    sessionDate: coachDeviceDateKey(row.started_at, timezoneOffsetMinutes),
    setIndex: row.set_index,
    weight: row.weight ?? 0,
    reps: row.reps ?? 0,
    isWarmup: !!row.is_warmup,
  }));
}

export async function buildCoachAdaptationSignal(
  db: SqlDb,
  userId: string,
  args: {
    programId: string;
    week: number;
    now: Date;
    timezoneOffsetMinutes?: number;
  },
): Promise<CoachAdaptationSignal> {
  const throughDate = coachDeviceDateKey(args.now, args.timezoneOffsetMinutes);
  const signalWindowStart = shiftedDateKey(throughDate, -6);
  const activeProgram = await db.getFirstAsync<{ found: number }>(
    `select 1 as found
       from programs
      where id = ?
        and user_id = ?
        and status = 'active'
        and deleted_at is null`,
    args.programId,
    userId,
  );
  if (!activeProgram) {
    return {
      stalled: [],
      atRisk: [],
      recentReadiness: { observedDays: 0, redDays: 0, states: [] },
      deload: { deload: false, reason: 'none' },
      reasonLabel: null,
    };
  }
  const stateRows = await db.getAllAsync<{ state: string }>(
    `select s.state
       from program_slots s
       join program_days d on d.id = s.program_day_id
      where d.program_id = ?
        and d.deleted_at is null
        and s.deleted_at is null
      order by d.day_index, s.slot_index`,
    args.programId,
  );
  const completedDeload = await db.getFirstAsync<{ ended_at: string }>(
    `select w.ended_at
       from workouts w
       left join workout_training_intents intent
         on intent.id = w.id and intent.deleted_at is null
       left join workout_drafts wd on wd.workout_id = w.id
       join program_days d on d.id = w.program_day_id
      where w.user_id = ?
        and d.program_id = ?
        and w.ended_at is not null
        and w.deleted_at is null
        and (
          intent.intent = 'coach_deload'
          or wd.plan_json like ?
        )
        and exists (
          select 1
            from sets completed_set
           where completed_set.workout_id = w.id
             and completed_set.is_warmup = 0
             and completed_set.deleted_at is null
        )
      order by w.ended_at desc
      limit 1`,
    userId,
    args.programId,
    `%${COACH_DELOAD_PLAN_MARKER}%`,
  );
  const completedDeloadDate = completedDeload
    ? coachDeviceDateKey(completedDeload.ended_at, args.timezoneOffsetMinutes)
    : null;
  const analysis = analyzeCoachAdaptation({
    slots: stateRows.map((row) => JSON.parse(row.state) as SlotState),
    history: await completedProgramHistory(
      db,
      userId,
      args.programId,
      args.timezoneOffsetMinutes,
    ),
    readinessLog: await recentObservedReadiness(
      db,
      userId,
      args.now,
      args.timezoneOffsetMinutes,
    ),
    week: args.week,
    weekStart: startOfWeekKey(args.now, args.timezoneOffsetMinutes),
    throughDate,
    deloadAlreadyThisBlock: !!completedDeload,
    completedDeloadWithinSignalWindow: !!completedDeloadDate
      && completedDeloadDate >= signalWindowStart
      && completedDeloadDate <= throughDate,
  });
  return adaptiveDeloadEnabled()
    ? analysis
    : { ...analysis, deload: { deload: false, reason: 'none' }, reasonLabel: null };
}
