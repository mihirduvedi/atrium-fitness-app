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

const todayIso = () => new Date().toISOString().slice(0, 10);

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
      order by date desc
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
