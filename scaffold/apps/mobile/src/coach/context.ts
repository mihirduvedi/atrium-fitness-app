import { exerciseCatalog } from '@atrium/engine';
import { getActiveProgram, getNextProgramDay } from '../db/queries';
import type { SqlDb } from '../db/schema';
import { getReadinessSignal, type ReadinessSignal } from '../health/readiness';
import { displayWorkoutName, formatWorkoutDayName } from '../workoutNames';

interface WorkoutRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  day_name: string | null;
  custom_name: string | null;
  readiness_at_start: number | null;
  volume: number;
  sets: number;
}

interface PrRow {
  exercise_id: string;
  type: string;
  value: number;
  achieved_at: string;
}

export interface CoachProfileContext {
  goal: string;
  experience: string;
  equipment: string[];
  daysPerWeek: number;
  units: string;
}

export interface CoachProgramContext {
  id: string;
  archetypeId: string;
  currentWeek: number;
  nextDayName: string | null;
  nextWeek: number | null;
  completedThisWeek: number | null;
  daysPerWeek: number | null;
}

export interface CoachWorkoutContext {
  id: string;
  startedAt: string;
  endedAt: string | null;
  dayName: string | null;
  readinessAtStart: number | null;
  volume: number;
  sets: number;
  durationMin: number;
}

export interface CoachPrSignal {
  exerciseId: string;
  exerciseName: string;
  type: string;
  label: string;
  value: number;
  displayValue: string;
  achievedAt: string;
}

export interface CoachWeekContext {
  startDate: string;
  endDate: string;
  label: string;
  workouts: number;
  plannedWorkouts: number | null;
  sets: number;
  volume: number;
  previousWorkouts: number;
  previousVolume: number;
  volumeDeltaPct: number | null;
  averageReadiness: number | null;
}

export interface CoachContextPack {
  generatedAt: string;
  profile: CoachProfileContext | null;
  program: CoachProgramContext | null;
  week: CoachWeekContext;
  recentWorkouts: CoachWorkoutContext[];
  prSignals: CoachPrSignal[];
  readiness: ReadinessSignal;
  facts: string[];
  modelContext: {
    profile: CoachProfileContext | null;
    program: CoachProgramContext | null;
    currentWeek: CoachWeekContext;
    recentWorkouts: CoachWorkoutContext[];
    prSignals: CoachPrSignal[];
    recovery: Pick<ReadinessSignal, 'score' | 'readiness' | 'title' | 'body'>;
    constraints: string[];
  };
}

const PR_LABEL: Record<string, string> = {
  weight: 'Heaviest set',
  reps_at_weight: 'Most reps',
  e1rm: 'Estimated 1RM',
  session_volume: 'Session volume',
};

function dateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const day = start.getDay();
  start.setDate(start.getDate() + (day === 0 ? -6 : 1 - day));
  return start;
}

function formatDay(key: string) {
  return new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatCompactNumber(value: number) {
  const rounded = Math.round(value);
  return rounded >= 1000 ? `${Math.round(rounded / 100) / 10}k` : String(rounded);
}

export function formatDelta(delta: number | null) {
  if (delta == null) return 'new baseline';
  const rounded = Math.round(delta);
  if (Math.abs(rounded) < 1) return 'steady';
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

function parseEquipment(raw?: string | null) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function titleCase(value?: string | null) {
  if (!value) return '';
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function percentDelta(current: number, previous: number) {
  if (previous <= 0) return current > 0 ? null : 0;
  return ((current - previous) / previous) * 100;
}

function durationMin(startedAt: string, endedAt: string | null) {
  if (!endedAt) return 0;
  return Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 60000));
}

function toWorkout(row: WorkoutRow): CoachWorkoutContext {
  return {
    id: row.id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    dayName: displayWorkoutName(row.custom_name, row.day_name),
    readinessAtStart: row.readiness_at_start,
    volume: Number(row.volume) || 0,
    sets: Number(row.sets) || 0,
    durationMin: durationMin(row.started_at, row.ended_at),
  };
}

function displayPrValue(pr: PrRow, units: string) {
  if (pr.type === 'reps_at_weight') return `${Math.round(pr.value * 10) / 10} reps`;
  if (pr.type === 'session_volume') return `${formatCompactNumber(pr.value)} ${units}`;
  return `${Math.round(pr.value * 10) / 10} ${units}`;
}

function toPrSignal(pr: PrRow, units: string): CoachPrSignal {
  return {
    exerciseId: pr.exercise_id,
    exerciseName: exerciseCatalog[pr.exercise_id]?.name ?? pr.exercise_id,
    type: pr.type,
    label: PR_LABEL[pr.type] ?? titleCase(pr.type),
    value: pr.value,
    displayValue: displayPrValue(pr, units),
    achievedAt: pr.achieved_at,
  };
}

function summarizeFacts(args: {
  profile: CoachProfileContext | null;
  program: CoachProgramContext | null;
  week: CoachWeekContext;
  prSignals: CoachPrSignal[];
  readiness: ReadinessSignal;
}) {
  const facts: string[] = [];
  if (args.profile) {
    facts.push(`${titleCase(args.profile.goal)} · ${titleCase(args.profile.experience)} · ${args.profile.daysPerWeek} days/wk`);
  }
  facts.push(`${args.week.workouts} sessions · ${formatCompactNumber(args.week.volume)} ${args.profile?.units ?? 'lb'} this week`);
  if (args.week.previousWorkouts > 0) facts.push(`Volume ${formatDelta(args.week.volumeDeltaPct)} vs previous week`);
  if (args.program?.nextDayName) facts.push(`Next target: ${args.program.nextDayName}`);
  if (args.prSignals[0]) facts.push(`Latest PR signal: ${args.prSignals[0].exerciseName} ${args.prSignals[0].displayValue}`);
  facts.push(`Recovery: ${args.readiness.score} · ${args.readiness.title}`);
  return facts;
}

export async function buildCoachContextPack(
  db: SqlDb,
  userId: string,
  now: Date = new Date(),
): Promise<CoachContextPack> {
  const weekStart = startOfWeek(now);
  const weekEnd = addDays(weekStart, 6);
  const previousStart = addDays(weekStart, -7);
  const previousEnd = addDays(weekStart, -1);
  const weekStartKey = dateKey(weekStart);
  const weekEndKey = dateKey(weekEnd);
  const previousStartKey = dateKey(previousStart);
  const previousEndKey = dateKey(previousEnd);
  const todayKey = dateKey(now);

  const profileRow = await db.getFirstAsync<{
    goal: string;
    experience: string;
    equipment: string;
    days_per_week: number;
    units: string;
  }>(
    `select goal, experience, equipment, days_per_week, units
       from profiles
      where user_id = ? and deleted_at is null`,
    userId,
  );
  const profile = profileRow
    ? {
        goal: profileRow.goal,
        experience: profileRow.experience,
        equipment: parseEquipment(profileRow.equipment),
        daysPerWeek: profileRow.days_per_week,
        units: profileRow.units,
      }
    : null;

  const workouts = (await db.getAllAsync<WorkoutRow>(
    `select w.id, w.started_at, w.ended_at, w.readiness_at_start, d.name as day_name, w.notes as custom_name,
            coalesce(sum(coalesce(s.weight, 0) * coalesce(s.reps, 0)), 0) as volume,
            count(s.id) as sets
       from workouts w
       left join program_days d on d.id = w.program_day_id
       left join sets s on s.workout_id = w.id and s.deleted_at is null and s.is_warmup = 0
      where w.user_id = ? and w.ended_at is not null and w.deleted_at is null
      group by w.id, w.started_at, w.ended_at, w.readiness_at_start, d.name, w.notes
      having count(s.id) > 0
      order by w.started_at desc
      limit 30`,
    userId,
  )).map(toWorkout);

  const currentWeek = workouts.filter((w) => {
    const key = w.startedAt.slice(0, 10);
    return key >= weekStartKey && key <= weekEndKey;
  });
  const previousWeek = workouts.filter((w) => {
    const key = w.startedAt.slice(0, 10);
    return key >= previousStartKey && key <= previousEndKey;
  });
  const weekVolume = currentWeek.reduce((sum, w) => sum + w.volume, 0);
  const previousVolume = previousWeek.reduce((sum, w) => sum + w.volume, 0);
  const readinessValues = currentWeek
    .map((w) => w.readinessAtStart)
    .filter((value): value is number => typeof value === 'number');

  const activeProgram = await getActiveProgram(db, userId);
  const next = activeProgram ? await getNextProgramDay(db, activeProgram.id) : null;
  const program = activeProgram
    ? {
        id: activeProgram.id,
        archetypeId: activeProgram.archetype_id,
        currentWeek: activeProgram.current_week,
        nextDayName: next?.name ? formatWorkoutDayName(next.name) : null,
        nextWeek: next?.week ?? null,
        completedThisWeek: next?.completedThisWeek ?? null,
        daysPerWeek: next?.daysPerWeek ?? null,
      }
    : null;

  const week: CoachWeekContext = {
    startDate: weekStartKey,
    endDate: weekEndKey,
    label: `${formatDay(weekStartKey)} - ${formatDay(weekEndKey)}`,
    workouts: currentWeek.length,
    plannedWorkouts: program?.daysPerWeek ?? profile?.daysPerWeek ?? null,
    sets: currentWeek.reduce((sum, w) => sum + w.sets, 0),
    volume: weekVolume,
    previousWorkouts: previousWeek.length,
    previousVolume,
    volumeDeltaPct: percentDelta(weekVolume, previousVolume),
    averageReadiness: readinessValues.length
      ? Math.round(readinessValues.reduce((sum, value) => sum + value, 0) / readinessValues.length)
      : null,
  };

  const prRows = await db.getAllAsync<PrRow>(
    `select exercise_id, type, value, achieved_at
       from personal_records
      where user_id = ? and deleted_at is null
      order by achieved_at desc
      limit 12`,
    userId,
  );
  const prSignals = prRows
    .filter((pr, index, all) => all.findIndex((x) => `${x.exercise_id}:${x.type}` === `${pr.exercise_id}:${pr.type}`) === index)
    .map((pr) => toPrSignal(pr, profile?.units ?? 'lb'));
  const readiness = await getReadinessSignal(db, userId, todayKey);
  const facts = summarizeFacts({ profile, program, week, prSignals, readiness });

  return {
    generatedAt: now.toISOString(),
    profile,
    program,
    week,
    recentWorkouts: workouts.slice(0, 12),
    prSignals,
    readiness,
    facts,
    modelContext: {
      profile,
      program,
      currentWeek: week,
      recentWorkouts: workouts.slice(0, 12),
      prSignals,
      recovery: {
        score: readiness.score,
        readiness: readiness.readiness,
        title: readiness.title,
        body: readiness.body,
      },
      constraints: [
        'Explain the observed pattern before recommending a change.',
        'Keep load changes inside the program engine rules.',
        'Do not mutate the program until the athlete explicitly applies a review.',
      ],
    },
  };
}
