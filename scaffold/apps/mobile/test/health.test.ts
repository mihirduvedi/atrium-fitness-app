import { describe, expect, it } from 'vitest';
import { migrate } from '../src/db/schema';
import {
  getBodyWeightSummary,
  getDailyCheckIn,
  getReadinessSignal,
  saveDailyCheckIn,
  saveHealthSample,
} from '../src/health/readiness';
import { openNodeDb } from './helpers/nodeDb';

const USER = 'health-user';
let n = 0;
const id = () => `health-id-${++n}`;

describe('readiness scoring from local health samples', () => {
  it('falls back safely when no health data is connected', async () => {
    const db = openNodeDb();
    await migrate(db);
    const signal = await getReadinessSignal(db, USER, '2026-06-16');
    expect(signal).toMatchObject({
      readiness: 'green',
      source: 'fallback',
      title: 'Ready by default',
    });
    db.close();
  });

  it('uses sleep and RHR signals to soften a tired day', async () => {
    const db = openNodeDb();
    await migrate(db);
    for (let day = 9; day <= 15; day++) {
      await saveHealthSample(db, {
        userId: USER,
        source: 'apple_health',
        type: 'rhr',
        date: `2026-06-${day}`,
        value: { bpm: 58 },
        externalId: `rhr-${day}`,
      }, id);
    }
    await saveHealthSample(db, {
      userId: USER,
      source: 'apple_health',
      type: 'sleep',
      date: '2026-06-16',
      value: { minutes: 380 },
      externalId: 'sleep-16',
    }, id);
    await saveHealthSample(db, {
      userId: USER,
      source: 'apple_health',
      type: 'rhr',
      date: '2026-06-16',
      value: { bpm: 66 },
      externalId: 'rhr-16',
    }, id);

    const signal = await getReadinessSignal(db, USER, '2026-06-16');
    expect(signal.readiness).toBe('yellow');
    expect(signal.source).toBe('health');
    expect(signal.body).toContain('RHR +8 bpm');
    db.close();
  });

  it('upserts repeated health samples idempotently', async () => {
    const db = openNodeDb();
    await migrate(db);
    const args = {
      userId: USER,
      source: 'apple_health',
      type: 'sleep' as const,
      date: '2026-06-16',
      value: { minutes: 420 },
      externalId: 'sleep-unique',
    };
    await saveHealthSample(db, args, id);
    await saveHealthSample(db, { ...args, value: { minutes: 450 } }, id);
    const rows = await db.getAllAsync<{ value: string }>('select value from health_samples');
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.value).minutes).toBe(450);
    db.close();
  });

  it('persists one editable daily check-in and queues both synced records', async () => {
    const db = openNodeDb();
    await migrate(db);
    await saveDailyCheckIn(db, {
      userId: USER,
      date: '2026-06-16',
      energy: 2,
      mood: 3,
      sleepQuality: 2,
      soreness: 4,
      weight: 176.2,
    }, id);

    expect(await getDailyCheckIn(db, USER, '2026-06-16')).toEqual({
      date: '2026-06-16',
      energy: 2,
      mood: 3,
      sleepQuality: 2,
      soreness: 4,
      weight: 176.2,
    });
    const signal = await getReadinessSignal(db, USER, '2026-06-16');
    expect(signal).toMatchObject({ source: 'subjective', readiness: 'yellow' });
    expect(signal.body).toContain('Recent check-in was low');

    await saveDailyCheckIn(db, {
      userId: USER,
      date: '2026-06-16',
      energy: 4,
      mood: 4,
      sleepQuality: 4,
      soreness: 2,
      weight: 175.8,
    }, id);
    const tagCount = await db.getFirstAsync<{ n: number }>(
      'select count(*) as n from subjective_tags where user_id = ? and date = ?',
      USER,
      '2026-06-16',
    );
    const metricCount = await db.getFirstAsync<{ n: number }>(
      'select count(*) as n from body_metrics where user_id = ? and date = ?',
      USER,
      '2026-06-16',
    );
    const queued = await db.getAllAsync<{ entity: string }>(
      `select entity from mutation_queue
        where entity in ('subjective_tags', 'body_metrics')
        order by seq`,
    );
    expect(tagCount?.n).toBe(1);
    expect(metricCount?.n).toBe(1);
    expect(queued.map((row) => row.entity)).toEqual([
      'subjective_tags',
      'body_metrics',
      'subjective_tags',
      'body_metrics',
    ]);
    expect((await getDailyCheckIn(db, USER, '2026-06-16'))?.weight).toBe(175.8);
    db.close();
  });

  it('summarizes real body-weight entries across adjacent seven-day windows', async () => {
    const db = openNodeDb();
    await migrate(db);
    await db.runAsync(
      `insert into profiles (user_id, goal, experience, equipment, days_per_week, units, created_at, updated_at)
       values (?, 'strength', 'intermediate', '[]', 3, 'kg', ?, ?)`,
      USER,
      '2026-06-01T08:00:00.000Z',
      '2026-06-01T08:00:00.000Z',
    );
    for (const [index, date, weight] of [
      [1, '2026-06-01', 80],
      [2, '2026-06-07', 78],
      [3, '2026-06-08', 77],
      [4, '2026-06-14', 76],
    ] as const) {
      await db.runAsync(
        `insert into body_metrics (id, user_id, date, weight, measurements, updated_at)
         values (?, ?, ?, ?, '{}', ?)`,
        `metric-${index}`,
        USER,
        date,
        weight,
        `${date}T08:00:00.000Z`,
      );
    }

    const summary = await getBodyWeightSummary(db, USER, '2026-06-14');
    expect(summary).toEqual({
      latestWeight: 76,
      latestDate: '2026-06-14',
      sevenDayAverage: 76.5,
      sevenDayDelta: -2.5,
      units: 'kg',
    });
    db.close();
  });
});
