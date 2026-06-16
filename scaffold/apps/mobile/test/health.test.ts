import { describe, expect, it } from 'vitest';
import { migrate } from '../src/db/schema';
import { getReadinessSignal, saveHealthSample } from '../src/health/readiness';
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
});
