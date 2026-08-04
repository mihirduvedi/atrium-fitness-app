import type { Readiness } from '@atrium/engine';
import { upsertWithMutation, type IdFn } from '../db/dao';
import type { SqlDb } from '../db/schema';

export type HealthSampleType = 'sleep' | 'rhr' | 'hrv' | 'steps' | 'workout';

export interface HealthSampleValue {
  minutes?: number;
  bpm?: number;
  ms?: number;
  count?: number;
}

export interface ReadinessSignal {
  score: number;
  readiness: Readiness;
  title: string;
  body: string;
  sleepMinutes: number | null;
  rhrDelta: number | null;
  hrvDeltaPct: number | null;
  source: 'health' | 'subjective' | 'fallback';
}

export interface DailyCheckIn {
  date: string;
  energy: number;
  mood: number;
  sleepQuality: number;
  soreness: number;
  weight: number | null;
}

export interface BodyWeightSummary {
  latestWeight: number | null;
  latestDate: string | null;
  sevenDayAverage: number | null;
  sevenDayDelta: number | null;
  units: 'lb' | 'kg';
}

interface SampleRow {
  type: HealthSampleType;
  date: string;
  value: string;
}

interface TagRow {
  energy: number | null;
  mood: number | null;
  sleep_quality: number | null;
  soreness: number | null;
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const todayIso = () => dateKey(new Date());

function shiftDate(key: string, days: number) {
  const date = new Date(`${key}T12:00:00`);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

function isRating(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

function stableHealthId(userId: string, source: string, externalId: string) {
  return `${userId}:${source}:${externalId}`;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function parseValue(row: SampleRow): HealthSampleValue {
  try {
    return JSON.parse(row.value) as HealthSampleValue;
  } catch {
    return {};
  }
}

function labelSleep(minutes: number | null) {
  if (minutes == null) return null;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${m}m sleep`;
}

function readinessFromScore(score: number): Readiness {
  if (score < 58) return 'red';
  if (score < 72) return 'yellow';
  return 'green';
}

function titleFor(readiness: Readiness, source: ReadinessSignal['source']) {
  if (source === 'fallback') return 'Ready by default';
  if (readiness === 'green') return 'Recovered';
  if (readiness === 'yellow') return 'Manageable';
  return 'Technique day';
}

function bodyFor(args: {
  readiness: Readiness;
  sleep: number | null;
  rhrDelta: number | null;
  hrvDeltaPct: number | null;
  subjectiveLow: boolean;
  source: ReadinessSignal['source'];
}) {
  if (args.source === 'fallback') {
    return 'No recovery import yet. Use how you feel; full working weights stay available unless you choose Worn or Rough.';
  }
  const parts: string[] = [];
  const sleep = labelSleep(args.sleep);
  if (sleep) parts.push(sleep);
  if (args.rhrDelta != null) {
    parts.push(args.rhrDelta > 1 ? `RHR +${Math.round(args.rhrDelta)} bpm` : 'RHR near baseline');
  }
  if (args.hrvDeltaPct != null) {
    parts.push(args.hrvDeltaPct >= 0 ? 'HRV at baseline' : `HRV ${Math.round(args.hrvDeltaPct)}%`);
  }
  if (args.subjectiveLow) parts.push('Recent check-in was low');

  const prefix = parts.length ? `${parts.join(', ')}.` : 'Recovery data is partial.';
  if (args.readiness === 'green') return `${prefix} Green light for full working weights today.`;
  if (args.readiness === 'yellow') return `${prefix} Keep the main lift, but trim stress if warmups feel slow.`;
  return `${prefix} Keep the movement pattern and lower the stress today.`;
}

export async function saveHealthSample(
  db: SqlDb,
  args: {
    userId: string;
    source: string;
    type: HealthSampleType;
    date: string;
    value: HealthSampleValue;
    externalId: string;
  },
  idFn: IdFn,
) {
  await upsertWithMutation(db, 'health_samples', {
    id: stableHealthId(args.userId, args.source, args.externalId),
    user_id: args.userId,
    source: args.source,
    type: args.type,
    date: args.date,
    value: JSON.stringify(args.value),
    external_id: args.externalId,
    updated_at: new Date().toISOString(),
    deleted_at: null,
  }, idFn);
}

export async function getHealthSampleCount(db: SqlDb, userId: string): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    'select count(*) as n from health_samples where user_id = ? and deleted_at is null',
    userId,
  );
  return row?.n ?? 0;
}

export async function getDailyCheckIn(
  db: SqlDb,
  userId: string,
  date = todayIso(),
): Promise<DailyCheckIn | null> {
  const tag = await db.getFirstAsync<{
    energy: number | null;
    mood: number | null;
    sleep_quality: number | null;
    soreness: number | null;
  }>(
    `select energy, mood, sleep_quality, soreness
       from subjective_tags
      where user_id = ? and date = ? and workout_id is null and deleted_at is null
      order by updated_at desc
      limit 1`,
    userId,
    date,
  );
  if (!tag || tag.energy == null || tag.mood == null || tag.sleep_quality == null || tag.soreness == null) {
    return null;
  }
  const metric = await db.getFirstAsync<{ weight: number | null }>(
    `select weight
       from body_metrics
      where user_id = ? and date = ? and deleted_at is null
      order by updated_at desc
      limit 1`,
    userId,
    date,
  );
  return {
    date,
    energy: tag.energy,
    mood: tag.mood,
    sleepQuality: tag.sleep_quality,
    soreness: tag.soreness,
    weight: metric?.weight ?? null,
  };
}

export async function saveDailyCheckIn(
  db: SqlDb,
  args: {
    userId: string;
    date?: string;
    energy: number;
    mood: number;
    sleepQuality: number;
    soreness: number;
    weight?: number | null;
  },
  idFn: IdFn,
): Promise<void> {
  const ratings = [args.energy, args.mood, args.sleepQuality, args.soreness];
  if (!ratings.every(isRating)) throw new Error('Daily check-in ratings must be whole numbers from 1 to 5.');
  if (args.weight != null && (!Number.isFinite(args.weight) || args.weight <= 0)) {
    throw new Error('Body weight must be greater than zero.');
  }

  const date = args.date ?? todayIso();
  const updatedAt = new Date().toISOString();
  const existingTag = await db.getFirstAsync<{ id: string }>(
    `select id
       from subjective_tags
      where user_id = ? and date = ? and workout_id is null and deleted_at is null
      order by updated_at desc
      limit 1`,
    args.userId,
    date,
  );
  await upsertWithMutation(db, 'subjective_tags', {
    id: existingTag?.id ?? idFn(),
    user_id: args.userId,
    workout_id: null,
    date,
    energy: args.energy,
    mood: args.mood,
    sleep_quality: args.sleepQuality,
    soreness: args.soreness,
    updated_at: updatedAt,
    deleted_at: null,
  }, idFn);

  if (args.weight !== undefined) {
    const existingMetric = await db.getFirstAsync<{ id: string; measurements: string }>(
      `select id, measurements
         from body_metrics
        where user_id = ? and date = ? and deleted_at is null
        order by updated_at desc
        limit 1`,
      args.userId,
      date,
    );
    if (existingMetric || args.weight !== null) {
      await upsertWithMutation(db, 'body_metrics', {
        id: existingMetric?.id ?? idFn(),
        user_id: args.userId,
        date,
        weight: args.weight ?? null,
        measurements: existingMetric?.measurements ?? '{}',
        updated_at: updatedAt,
        deleted_at: null,
      }, idFn);
    }
  }
}

export async function getBodyWeightSummary(
  db: SqlDb,
  userId: string,
  date = todayIso(),
): Promise<BodyWeightSummary> {
  const currentStart = shiftDate(date, -6);
  const previousStart = shiftDate(date, -13);
  const previousEnd = shiftDate(date, -7);
  const [latest, averages, profile] = await Promise.all([
    db.getFirstAsync<{ weight: number; date: string }>(
      `select weight, date
         from body_metrics
        where user_id = ? and date <= ? and weight is not null and deleted_at is null
        order by date desc, updated_at desc
        limit 1`,
      userId,
      date,
    ),
    db.getFirstAsync<{ current_average: number | null; previous_average: number | null }>(
      `select avg(case when date >= ? then weight end) as current_average,
              avg(case when date >= ? and date <= ? then weight end) as previous_average
         from body_metrics
        where user_id = ? and date >= ? and date <= ? and weight is not null and deleted_at is null`,
      currentStart,
      previousStart,
      previousEnd,
      userId,
      previousStart,
      date,
    ),
    db.getFirstAsync<{ units: string }>(
      'select units from profiles where user_id = ? and deleted_at is null',
      userId,
    ),
  ]);
  const currentAverage = averages?.current_average ?? null;
  const previousAverage = averages?.previous_average ?? null;
  return {
    latestWeight: latest?.weight ?? null,
    latestDate: latest?.date ?? null,
    sevenDayAverage: currentAverage,
    sevenDayDelta: currentAverage != null && previousAverage != null ? currentAverage - previousAverage : null,
    units: profile?.units === 'kg' ? 'kg' : 'lb',
  };
}

export async function getReadinessSignal(db: SqlDb, userId: string, date = todayIso()): Promise<ReadinessSignal> {
  const rows = await db.getAllAsync<SampleRow>(
    `select type, date, value
       from health_samples
      where user_id = ? and deleted_at is null and date <= ?
      order by date desc
      limit 60`,
    userId,
    date,
  );
  const tag = await db.getFirstAsync<TagRow>(
    `select energy, mood, sleep_quality, soreness
       from subjective_tags
      where user_id = ? and deleted_at is null and date <= ?
      order by date desc,
               case when workout_id is null then 0 else 1 end,
               updated_at desc
      limit 1`,
    userId,
    date,
  );

  const byType = (type: HealthSampleType) => rows.filter((row) => row.type === type);
  const latestSleep = byType('sleep')[0] ? parseValue(byType('sleep')[0]!).minutes ?? null : null;
  const latestRhr = byType('rhr')[0] ? parseValue(byType('rhr')[0]!).bpm ?? null : null;
  const latestHrv = byType('hrv')[0] ? parseValue(byType('hrv')[0]!).ms ?? null : null;
  const priorRhr = average(byType('rhr').slice(1, 8).map((row) => parseValue(row).bpm).filter((v): v is number => typeof v === 'number'));
  const priorHrv = average(byType('hrv').slice(1, 8).map((row) => parseValue(row).ms).filter((v): v is number => typeof v === 'number'));
  const rhrDelta = latestRhr != null && priorRhr != null ? latestRhr - priorRhr : null;
  const hrvDeltaPct = latestHrv != null && priorHrv != null && priorHrv > 0 ? ((latestHrv - priorHrv) / priorHrv) * 100 : null;
  const subjectiveLow = !!tag && [tag.energy, tag.mood, tag.sleep_quality].some((v) => v != null && v <= 2);
  const hasHealth = rows.length > 0;
  const hasSubjective = !!tag;

  let score = hasHealth || hasSubjective ? 76 : 74;
  if (latestSleep != null) {
    if (latestSleep >= 450) score += 8;
    else if (latestSleep < 360) score -= 14;
    else if (latestSleep < 390) score -= 6;
  }
  if (rhrDelta != null) {
    if (rhrDelta <= 1) score += 5;
    else if (rhrDelta >= 5) score -= 12;
    else if (rhrDelta >= 3) score -= 5;
  }
  if (hrvDeltaPct != null) {
    if (hrvDeltaPct >= 0) score += 4;
    else if (hrvDeltaPct <= -12) score -= 9;
    else if (hrvDeltaPct <= -5) score -= 4;
  }
  if (tag?.energy != null) score += (tag.energy - 3) * 3;
  if (tag?.sleep_quality != null) score += (tag.sleep_quality - 3) * 2;
  if (tag?.soreness != null && tag.soreness >= 4) score -= 4;
  score = Math.max(35, Math.min(95, Math.round(score)));

  const source: ReadinessSignal['source'] = hasHealth ? 'health' : hasSubjective ? 'subjective' : 'fallback';
  const readiness = readinessFromScore(score);
  return {
    score,
    readiness,
    title: titleFor(readiness, source),
    body: bodyFor({ readiness, sleep: latestSleep, rhrDelta, hrvDeltaPct, subjectiveLow, source }),
    sleepMinutes: latestSleep,
    rhrDelta,
    hrvDeltaPct,
    source,
  };
}
