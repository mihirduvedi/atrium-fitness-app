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
    db.close();
  });
});
