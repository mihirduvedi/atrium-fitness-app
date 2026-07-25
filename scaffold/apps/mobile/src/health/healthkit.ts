import { Platform } from 'react-native';
import type {
  CategorySample,
  ObjectTypeIdentifier,
  QuantitySample,
  QueryStatisticsResponse,
  WorkoutProxyTyped,
} from '@kingstinct/react-native-healthkit';
import { saveHealthSample, type HealthSampleType, type HealthSampleValue } from './readiness';
import type { IdFn } from '../db/dao';
import type { SqlDb } from '../db/schema';

/**
 * Native HealthKit import is intentionally gated. Expo Go cannot load the
 * native module or grant the HealthKit entitlement; dev/TestFlight builds can.
 */

type HealthKitModule = typeof import('@kingstinct/react-native-healthkit');
type HealthKitCandidate = Partial<HealthKitModule> & {
  default?: unknown;
};

interface NativeSample {
  id?: string;
  uuid?: string;
  startDate?: string | Date;
  endDate?: string | Date;
  start?: string | Date;
  end?: string | Date;
  value?: unknown;
  quantity?: unknown;
  unit?: string;
  sourceId?: string;
  sourceName?: string;
  activityName?: string;
  calories?: number;
  duration?: number | { quantity?: number; unit?: string };
}

interface ImportCounts {
  sleep: number;
  rhr: number;
  hrv: number;
  steps: number;
  workout: number;
}

export interface HealthKitImportResult {
  ok: boolean;
  reason?: string;
  imported?: number;
  counts?: ImportCounts;
}

const SOURCE = 'apple_health';
const DEFAULT_LOOKBACK_DAYS = 14;
const READ_TYPES = [
  'HKCategoryTypeIdentifierSleepAnalysis',
  'HKQuantityTypeIdentifierRestingHeartRate',
  'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
  'HKQuantityTypeIdentifierStepCount',
  'HKWorkoutTypeIdentifier',
] as const satisfies readonly ObjectTypeIdentifier[];

function isHealthKitModule(candidate: unknown): candidate is HealthKitModule {
  if (!candidate || typeof candidate !== 'object') return false;
  const mod = candidate as Partial<HealthKitModule>;
  return (
    (typeof mod.isHealthDataAvailable === 'function' || typeof mod.isHealthDataAvailableAsync === 'function') &&
    typeof mod.requestAuthorization === 'function' &&
    typeof mod.queryCategorySamples === 'function' &&
    typeof mod.queryQuantitySamples === 'function' &&
    typeof mod.queryStatisticsCollectionForQuantity === 'function' &&
    typeof mod.queryWorkoutSamples === 'function'
  );
}

function getHealthKitModule(): HealthKitModule | null {
  if (Platform.OS !== 'ios') return null;
  try {
    const loaded = require('@kingstinct/react-native-healthkit') as HealthKitCandidate;
    for (const candidate of [loaded, loaded.default]) {
      if (isHealthKitModule(candidate)) return candidate;
    }
  } catch {
    return null;
  }
  return null;
}

async function isHealthKitAvailable(HealthKit: HealthKitModule): Promise<boolean> {
  try {
    if (typeof HealthKit.isHealthDataAvailableAsync === 'function') {
      return !!(await HealthKit.isHealthDataAvailableAsync());
    }
    return !!HealthKit.isHealthDataAvailable();
  } catch {
    return false;
  }
}

async function requestReadAuthorization(HealthKit: HealthKitModule) {
  const granted = await HealthKit.requestAuthorization({ toRead: READ_TYPES });
  if (!granted) throw new Error('Health permissions were not granted.');
}

function toDate(input?: string | Date) {
  if (!input) return null;
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function localDateKey(input?: string | Date) {
  const d = toDate(input);
  if (!d) return null;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfLocalDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function dayKeys(start: Date, end: Date) {
  const keys: string[] = [];
  const cursor = new Date(start);
  cursor.setHours(12, 0, 0, 0);
  const final = new Date(end);
  final.setHours(12, 0, 0, 0);
  while (cursor <= final) {
    const key = localDateKey(cursor.toISOString());
    if (key) keys.push(key);
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

function minutesBetween(sample: NativeSample) {
  const start = sample.startDate ?? sample.start;
  const end = sample.endDate ?? sample.end;
  const startDate = toDate(start);
  const endDate = toDate(end);
  if (!startDate || !endDate) return 0;
  const ms = endDate.getTime() - startDate.getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 60000)) : 0;
}

function numericValue(sample: NativeSample) {
  const raw = typeof sample.quantity === 'number' ? sample.quantity : sample.value;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function sleepBucket(value: unknown): 'asleep' | 'inbed' | null {
  if (typeof value === 'number') {
    if (value === 0) return 'inbed';
    if (value === 1 || value === 3 || value === 4 || value === 5) return 'asleep';
    return null;
  }
  const normalized = String(value ?? '').toUpperCase();
  if (normalized.includes('INBED')) return 'inbed';
  if (
    normalized.includes('ASLEEP') ||
    normalized.includes('CORE') ||
    normalized.includes('DEEP') ||
    normalized.includes('REM')
  ) {
    return 'asleep';
  }
  return null;
}

function addTo(map: Map<string, number>, key: string, value: number) {
  map.set(key, (map.get(key) ?? 0) + value);
}

export function aggregateSleepSamples(samples: readonly NativeSample[]) {
  const asleep = new Map<string, number>();
  const inBed = new Map<string, number>();
  for (const sample of samples) {
    const date = localDateKey(sample.endDate ?? sample.end ?? sample.startDate ?? sample.start);
    const minutes = minutesBetween(sample);
    const bucket = sleepBucket(sample.value);
    if (!date || minutes <= 0 || !bucket) continue;
    addTo(bucket === 'asleep' ? asleep : inBed, date, minutes);
  }
  const dates = Array.from(new Set([...asleep.keys(), ...inBed.keys()])).sort();
  return dates.map((date) => ({
    date,
    minutes: Math.round(asleep.get(date) || inBed.get(date) || 0),
  })).filter((row) => row.minutes > 0);
}

export function aggregateDailyAverage(samples: readonly NativeSample[], valueForSample: (sample: NativeSample) => number | null) {
  const byDate = new Map<string, number[]>();
  for (const sample of samples) {
    const date = localDateKey(sample.endDate ?? sample.end ?? sample.startDate ?? sample.start);
    const value = valueForSample(sample);
    if (!date || value == null) continue;
    byDate.set(date, [...(byDate.get(date) ?? []), value]);
  }
  return Array.from(byDate.entries()).map(([date, values]) => ({
    date,
    value: values.reduce((sum, value) => sum + value, 0) / values.length,
  })).sort((a, b) => a.date.localeCompare(b.date));
}

function hrvMillis(sample: NativeSample) {
  const value = numericValue(sample);
  if (value == null) return null;
  return sample.unit === 's' ? value * 1000 : value;
}

function durationMinutes(sample: NativeSample) {
  const byDates = minutesBetween(sample);
  if (byDates > 0) return byDates;
  if (typeof sample.duration === 'number' && Number.isFinite(sample.duration)) {
    return Math.max(0, Math.round(sample.duration / 60));
  }
  if (sample.duration && typeof sample.duration === 'object' && typeof sample.duration.quantity === 'number') {
    const unit = sample.duration.unit ?? 's';
    if (unit === 'hr') return Math.max(0, Math.round(sample.duration.quantity * 60));
    if (unit === 'min') return Math.max(0, Math.round(sample.duration.quantity));
    return Math.max(0, Math.round(sample.duration.quantity / 60));
  }
  return 0;
}

function queryOptions(start: Date, end: Date) {
  return {
    filter: { date: { startDate: start, endDate: end } },
    limit: 0,
    ascending: true,
  };
}

async function queryDailyStepCounts(HealthKit: HealthKitModule, start: Date, end: Date) {
  const stats = await HealthKit.queryStatisticsCollectionForQuantity(
    'HKQuantityTypeIdentifierStepCount',
    ['cumulativeSum'],
    startOfLocalDay(start),
    { day: 1 },
    {
      unit: 'count',
      filter: { date: { startDate: start, endDate: end } },
    },
  );
  return (stats as readonly QueryStatisticsResponse[])
    .map((stat) => ({
      date: localDateKey(stat.startDate ?? stat.endDate),
      count: stat.sumQuantity?.quantity,
    }))
    .filter((row): row is { date: string; count: number } => !!row.date && typeof row.count === 'number' && row.count >= 0);
}

async function saveSample(
  db: SqlDb,
  userId: string,
  idFn: IdFn,
  type: HealthSampleType,
  date: string,
  value: HealthSampleValue,
  externalId: string,
) {
  await saveHealthSample(db, { userId, source: SOURCE, type, date, value, externalId }, idFn);
}

export async function canRequestHealthKit(): Promise<boolean> {
  const HealthKit = getHealthKitModule();
  return HealthKit ? isHealthKitAvailable(HealthKit) : false;
}

export async function requestHealthKitImport(
  db: SqlDb,
  userId: string,
  idFn: IdFn,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
): Promise<HealthKitImportResult> {
  if (Platform.OS !== 'ios') {
    return { ok: false, reason: 'HealthKit is only available on iOS.' };
  }
  const HealthKit = getHealthKitModule();
  if (!HealthKit) {
    return {
      ok: false,
      reason: 'HealthKit needs an Atrium development build or TestFlight build on a real iPhone. Expo Go cannot load the native module.',
    };
  }
  if (!(await isHealthKitAvailable(HealthKit))) {
    return { ok: false, reason: 'HealthKit is not available on this device.' };
  }

  try {
    await requestReadAuthorization(HealthKit);
    const end = new Date();
    const start = startOfLocalDay(addDays(end, -(lookbackDays - 1)));
    const counts: ImportCounts = { sleep: 0, rhr: 0, hrv: 0, steps: 0, workout: 0 };

    const [sleepSamples, rhrSamples, hrvSamples, stepCounts, workouts] = await Promise.all([
      HealthKit.queryCategorySamples('HKCategoryTypeIdentifierSleepAnalysis', queryOptions(start, end)),
      HealthKit.queryQuantitySamples('HKQuantityTypeIdentifierRestingHeartRate', {
        ...queryOptions(start, end),
        unit: 'count/min',
      }),
      HealthKit.queryQuantitySamples('HKQuantityTypeIdentifierHeartRateVariabilitySDNN', {
        ...queryOptions(start, end),
        unit: 'ms',
      }),
      queryDailyStepCounts(HealthKit, start, end),
      HealthKit.queryWorkoutSamples(queryOptions(start, end)),
    ]);

    for (const row of aggregateSleepSamples(sleepSamples as readonly CategorySample[] as unknown as readonly NativeSample[])) {
      await saveSample(db, userId, idFn, 'sleep', row.date, { minutes: row.minutes }, `sleep:${row.date}`);
      counts.sleep += 1;
    }

    for (const row of aggregateDailyAverage(rhrSamples as readonly QuantitySample[] as unknown as readonly NativeSample[], numericValue)) {
      await saveSample(db, userId, idFn, 'rhr', row.date, { bpm: Math.round(row.value) }, `rhr:${row.date}`);
      counts.rhr += 1;
    }

    for (const row of aggregateDailyAverage(hrvSamples as readonly QuantitySample[] as unknown as readonly NativeSample[], hrvMillis)) {
      await saveSample(db, userId, idFn, 'hrv', row.date, { ms: Math.round(row.value) }, `hrv:${row.date}`);
      counts.hrv += 1;
    }

    const stepMap = new Map(stepCounts.map((row) => [row.date, row.count]));
    for (const date of dayKeys(start, end)) {
      const count = stepMap.get(date);
      if (count == null) continue;
      await saveSample(db, userId, idFn, 'steps', date, { count: Math.round(count) }, `steps:${date}`);
      counts.steps += 1;
    }

    for (const [index, workout] of (workouts as readonly WorkoutProxyTyped[] as unknown as readonly NativeSample[]).entries()) {
      const date = localDateKey(workout.end ?? workout.endDate ?? workout.start ?? workout.startDate);
      const minutes = durationMinutes(workout);
      if (!date || minutes <= 0) continue;
      const externalId = workout.uuid ?? workout.id ?? `workout:${String(workout.start ?? workout.startDate ?? date)}:${index}`;
      await saveSample(db, userId, idFn, 'workout', date, { minutes }, `workout:${externalId}`);
      counts.workout += 1;
    }

    const imported = counts.sleep + counts.rhr + counts.hrv + counts.steps + counts.workout;
    return { ok: true, imported, counts };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
