import { describe, expect, it } from 'vitest';
import { buildCoachContextPack } from '../src/coach/context';
import { migrate, type SqlDb } from '../src/db/schema';
import {
  finishWorkout,
  getActiveProgram,
  getNextProgramDay,
  logSet,
  savePersonalRecord,
  seedDemoProgram,
  seedExerciseCatalog,
  startWorkout,
} from '../src/db/queries';
import { openNodeDb } from './helpers/nodeDb';

const USER = 'coach-user';
let n = 0;
const id = () => `coach-id-${++n}`;

async function loggedWorkout(
  db: SqlDb,
  date: string,
  weight: number,
  reps: number,
  readiness: number,
) {
  const program = (await getActiveProgram(db, USER))!;
  const day = (await getNextProgramDay(db, program.id))!;
  const workoutId = await startWorkout(db, USER, day.dayId, id, readiness);
  await logSet(db, {
    workoutId,
    exerciseId: 'bb_bench',
    setIndex: 0,
    weight,
    reps,
  }, id);
  await finishWorkout(db, workoutId, id);
  await db.runAsync(
    'update workouts set started_at = ?, ended_at = ? where id = ?',
    `${date}T10:00:00.000Z`,
    `${date}T11:00:00.000Z`,
    workoutId,
  );
  return workoutId;
}

describe('coach context pack', () => {
  it('splits current and previous week training into a backend-ready pack', async () => {
    const db = openNodeDb();
    await migrate(db);
    await seedExerciseCatalog(db);
    await seedDemoProgram(db, USER, id);

    await loggedWorkout(db, '2026-06-10', 100, 5, 77);
    const currentWorkoutId = await loggedWorkout(db, '2026-06-16', 200, 5, 83);
    await savePersonalRecord(db, {
      userId: USER,
      exerciseId: 'bb_bench',
      type: 'e1rm',
      value: 233,
      workoutId: currentWorkoutId,
    }, id);

    const pack = await buildCoachContextPack(db, USER, new Date('2026-06-16T12:00:00.000Z'));

    expect(pack.week).toMatchObject({
      startDate: '2026-06-15',
      endDate: '2026-06-21',
      workouts: 1,
      previousWorkouts: 1,
      volume: 1000,
      previousVolume: 500,
      averageReadiness: 83,
    });
    expect(Math.round(pack.week.volumeDeltaPct ?? 0)).toBe(100);
    expect(pack.prSignals[0]).toMatchObject({
      exerciseName: 'Bench Press',
      label: 'Estimated 1RM',
      displayValue: '233 lb',
    });
    expect(pack.modelContext.constraints.length).toBeGreaterThan(0);
    expect(JSON.stringify(pack.modelContext)).not.toContain(currentWorkoutId);
    expect(JSON.stringify(pack.modelContext)).not.toContain('T10:00:00.000Z');
    expect(pack.modelContext.recentWorkouts[0]).toMatchObject({
      date: '2026-06-16',
      dayName: expect.any(String),
      sets: 1,
    });
    expect(pack.proposalOptions.length).toBeGreaterThan(0);
    expect(pack.proposalOptions.length).toBeLessThanOrEqual(3);
    expect(pack.proposalOptions.every((option) => /^cp_[a-f0-9]{16}$/.test(option.id))).toBe(true);
    const localTargetSlotId = pack.proposalSet?.options.find((option) => option.targetSlotId)?.targetSlotId;
    const serializedProviderPayload = JSON.stringify({
      context: pack.modelContext,
      proposalOptions: pack.proposalOptions,
    });
    expect(serializedProviderPayload).not.toContain(pack.program?.id ?? 'missing-program');
    if (localTargetSlotId) expect(serializedProviderPayload).not.toContain(localTargetSlotId);
    expect(pack.actionState).toEqual({
      hasActiveWorkout: false,
      activeWorkoutId: null,
      activeProposalId: null,
      activeProposalKind: null,
    });
    expect(pack.evidence.map((item) => item.key)).toEqual(expect.arrayContaining([
      'profile',
      'current_week',
      'next_session',
      'latest_pr',
      'recovery',
      'last_workout',
    ]));
    db.close();
  });

  it('publishes a coherent, minimized week-7 adaptation without local ids or program-level duration', async () => {
    const db = openNodeDb();
    await migrate(db);
    await seedExerciseCatalog(db);
    await seedDemoProgram(db, USER, id);
    const program = (await getActiveProgram(db, USER))!;
    const days = await db.getAllAsync<{ id: string }>(
      'select id from program_days where program_id = ? and deleted_at is null order by day_index',
      program.id,
    );
    for (let index = 0; index < days.length * 6; index += 1) {
      const timestamp = `2026-07-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`;
      await db.runAsync(
        `insert into workouts (
          id, user_id, program_day_id, started_at, ended_at, notes,
          readiness_at_start, updated_at, deleted_at
        ) values (?, ?, ?, ?, ?, null, 80, ?, null)`,
        `week-seven-${index}`,
        USER,
        days[index % days.length]!.id,
        timestamp,
        timestamp,
        timestamp,
      );
    }

    const pack = await buildCoachContextPack(db, USER, new Date('2026-08-05T12:00:00.000Z'));
    expect(pack.program).toMatchObject({ currentWeek: 7, nextWeek: 7 });
    expect(pack.modelContext.program).toMatchObject({ currentWeek: 7, nextWeek: 7 });
    expect(pack.adaptation).toMatchObject({
      deload: {
        deload: true,
        reason: 'scheduled_week_7',
        prescription: { volumePct: -40, intensityPct: -10, dropTopSets: true, weeks: 1 },
      },
      reasonLabel: 'Program week 7 reached the scheduled deload checkpoint.',
    });
    expect(pack.modelContext.adaptation).toMatchObject({
      recentReadiness: { observedDays: 0, redDays: 0 },
      deload: {
        deload: true,
        reason: 'scheduled_week_7',
        prescription: {
          scope: 'next_workout',
          volumePct: -40,
          intensityPct: -10,
          dropTopSets: true,
        },
      },
    });
    expect(pack.evidence).toContainEqual({
      key: 'training_strain',
      label: 'Adaptation signal',
      value: 'Program week 7 reached the scheduled deload checkpoint.',
    });
    expect(pack.proposalOptions.map((option) => option.kind)).toEqual([
      'keep_plan',
      'deload_session',
      'reduce_volume',
    ]);
    expect(pack.proposalOptions).toHaveLength(3);

    const localSlotIds = await db.getAllAsync<{ id: string }>(
      `select s.id from program_slots s
        join program_days d on d.id = s.program_day_id
       where d.program_id = ?`,
      program.id,
    );
    const providerPayload = JSON.stringify({
      context: pack.modelContext,
      proposalOptions: pack.proposalOptions,
    });
    expect(providerPayload).not.toContain(program.id);
    for (const row of localSlotIds) expect(providerPayload).not.toContain(row.id);
    expect(providerPayload).not.toContain('week-seven-');
    expect(providerPayload).not.toContain('"states"');
    expect(providerPayload).not.toContain('"weeks"');
    db.close();
  });
});
