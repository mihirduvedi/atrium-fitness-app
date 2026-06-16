import { beforeEach, describe, expect, it } from 'vitest';
import { detectPRs } from '@atrium/engine';
import { migrate, type SqlDb } from '../src/db/schema';
import {
  createProgramFromOnboarding,
  finishWorkout,
  getActiveProgram,
  getHistory,
  getNextProgramDay,
  getPreviousSession,
  getWorkoutSummary,
  logSet,
  planSession,
  savePersonalRecord,
  seedDemoProgram,
  seedExerciseCatalog,
  startWorkout,
} from '../src/db/queries';
import { openNodeDb } from './helpers/nodeDb';

const USER = 'demo-user';
let n = 0;
const id = () => `uuid-${++n}`;

let db: SqlDb & { close(): void };
beforeEach(async () => {
  db = openNodeDb();
  await migrate(db);
  await seedExerciseCatalog(db);
  sessionDay = 0;
});

let sessionDay = 0;

/** Perform a full session exactly as prescribed (completing all top-of-range reps).
 * Each session is backdated to its own day — the engine groups history by date. */
async function performSession(userId: string): Promise<string> {
  const program = (await getActiveProgram(db, userId))!;
  const day = (await getNextProgramDay(db, program.id))!;
  const plan = await planSession(db, userId, day, id);
  const workoutId = await startWorkout(db, userId, day.dayId, id, 82);
  for (const p of plan.prescriptions) {
    for (const s of p.sets) {
      await logSet(db, {
        workoutId,
        exerciseId: p.exerciseId,
        setIndex: s.setIndex,
        weight: s.weight ?? 100,
        reps: s.targetSeconds !== undefined ? s.targetSeconds : s.targetReps[1],
      }, id);
    }
  }
  await finishWorkout(db, workoutId, id);
  sessionDay += 1;
  const date = `2026-05-${String(sessionDay).padStart(2, '0')}`;
  await db.runAsync('update workouts set started_at = ? where id = ?', `${date}T10:00:00.000Z`, workoutId);
  return workoutId;
}

describe('Stage 5 data layer: Today plans from real engine + SQLite state', () => {
  it('seeds the demo ul4_strength program once (idempotent)', async () => {
    const p1 = await seedDemoProgram(db, USER, id);
    const p2 = await seedDemoProgram(db, USER, id);
    expect(p1).toBe(p2);
    const program = await getActiveProgram(db, USER);
    expect(program).toMatchObject({ archetype_id: 'ul4_strength' });
    const day = await getNextProgramDay(db, program!.id);
    expect(day).toMatchObject({ dayIndex: 0, name: 'Upper — Strength', week: 1, daysPerWeek: 4 });
  });

  it('creates the initial program from onboarding answers', async () => {
    const programId = await createProgramFromOnboarding(db, USER, {
      goal: 'fat_loss',
      experience: 'intermediate',
      equipment: 'dumbbell',
      days_per_week: 3,
    }, id);
    const again = await createProgramFromOnboarding(db, USER, {
      goal: 'strength',
      experience: 'advanced',
      equipment: 'full_gym',
      days_per_week: 6,
    }, id);
    expect(again).toBe(programId);

    const program = await getActiveProgram(db, USER);
    expect(program).toMatchObject({ archetype_id: 'db_cut3' });
    const profile = await db.getFirstAsync<{ goal: string; experience: string; equipment: string; days_per_week: number; units: string }>(
      'select goal, experience, equipment, days_per_week, units from profiles where user_id = ?',
      USER,
    );
    expect(profile).toMatchObject({
      goal: 'fat_loss',
      experience: 'intermediate',
      equipment: JSON.stringify(['dumbbell']),
      days_per_week: 3,
      units: 'lb',
    });
  });

  it('plans Upper — Strength with the archetype scheme on a fresh program', async () => {
    await seedDemoProgram(db, USER, id);
    const program = (await getActiveProgram(db, USER))!;
    const day = (await getNextProgramDay(db, program.id))!;
    const plan = await planSession(db, USER, day, id);

    expect(plan.prescriptions).toHaveLength(5);
    const bench = plan.prescriptions[0]!;
    expect(bench.exerciseId).toBe('bb_bench');
    expect(bench.sets.filter((s) => s.kind === 'top')).toHaveLength(1);
    expect(bench.sets.filter((s) => s.kind === 'backoff')).toHaveLength(3);
    expect(bench.rest_s).toBe(180);
  });

  it('rotates days and advances the week as workouts complete', async () => {
    await seedDemoProgram(db, USER, id);
    const program = (await getActiveProgram(db, USER))!;
    await performSession(USER);
    let day = (await getNextProgramDay(db, program.id))!;
    expect(day).toMatchObject({ dayIndex: 1, name: 'Lower — Strength', week: 1 });

    await performSession(USER);
    await performSession(USER);
    await performSession(USER);
    day = (await getNextProgramDay(db, program.id))!;
    expect(day).toMatchObject({ dayIndex: 0, week: 2 });
  });

  it('prescriptions react to logged history (engine on real data)', async () => {
    await seedDemoProgram(db, USER, id);
    const program = (await getActiveProgram(db, USER))!;

    // week 1: every slot establishes its load at 100 (test default)
    await performSession(USER); // day 0
    await performSession(USER);
    await performSession(USER);
    await performSession(USER);

    // week 2, Upper — Strength: all targets were hit at 100 → loads rise within bounds
    const day = (await getNextProgramDay(db, program.id))!;
    const plan = await planSession(db, USER, day, id);
    const row = plan.prescriptions.find((p) => p.exerciseId === 'bb_row')!;
    expect(row.sets[0]!.weight).toBe(105); // double progression: all sets at top → +5

    // state was persisted: re-planning is idempotent
    const again = await planSession(db, USER, day, id);
    expect(again.prescriptions.find((p) => p.exerciseId === 'bb_row')!.sets[0]!.weight).toBe(105);
  });

  it('readiness yellow trims a set from compounds at plan time', async () => {
    await seedDemoProgram(db, USER, id);
    const program = (await getActiveProgram(db, USER))!;
    const day = (await getNextProgramDay(db, program.id))!;
    const plan = await planSession(db, USER, day, id, 'yellow');
    const bench = plan.prescriptions[0]!;
    expect(bench.sets).toHaveLength(3); // 1 top + 2 backoffs
    expect(plan.readinessApplied).toBe('yellow');
  });
});

describe('Stage 5 data layer: Active Workout', () => {
  it('logs each set durably and exposes previous-session ghost values', async () => {
    await seedDemoProgram(db, USER, id);
    const w1 = await performSession(USER);

    const program = (await getActiveProgram(db, USER))!;
    const day = (await getNextProgramDay(db, program.id))!;
    const w2 = await startWorkout(db, USER, day.dayId, id);

    // bench ghosts come from workout 1, by set index
    const ghosts = await getPreviousSession(db, USER, 'bb_bench', w2);
    expect(ghosts.length).toBeGreaterThan(0);
    expect(ghosts[0]).toMatchObject({ weight: 100, reps: 6 });

    // every logged set is immediately durable + queued
    const queued = await db.getFirstAsync<{ n: number }>(
      "select count(*) as n from mutation_queue where entity = 'sets' and pushed_at is null",
    );
    expect(queued!.n).toBeGreaterThan(0);
    const rows = await db.getFirstAsync<{ n: number }>('select count(*) as n from sets');
    expect(rows!.n).toBeGreaterThan(0);
  });
});

describe('Stage 5 data layer: Summary', () => {
  it('computes duration, volume, set count from real rows and detects PRs via the engine', async () => {
    await seedDemoProgram(db, USER, id);
    // 4 sessions establish history, 5th repeats day 0 with heavier bench
    for (let i = 0; i < 4; i++) await performSession(USER);

    const program = (await getActiveProgram(db, USER))!;
    const day = (await getNextProgramDay(db, program.id))!;
    const plan = await planSession(db, USER, day, id);
    const workoutId = await startWorkout(db, USER, day.dayId, id);
    for (const p of plan.prescriptions) {
      for (const s of p.sets) {
        await logSet(db, {
          workoutId,
          exerciseId: p.exerciseId,
          setIndex: s.setIndex,
          weight: (s.weight ?? 100) + 5, // beat last week
          reps: s.targetSeconds !== undefined ? s.targetSeconds : s.targetReps[1],
        }, id);
      }
    }
    await finishWorkout(db, workoutId, id);

    const summary = (await getWorkoutSummary(db, workoutId))!;
    expect(summary.totalSets).toBeGreaterThan(10);
    expect(summary.totalVolume).toBeGreaterThan(0);
    expect(summary.endedAt).not.toBeNull();

    const history = await getHistory(db, USER);
    const workoutDate = summary.startedAt.slice(0, 10);
    const prs = detectPRs(
      {
        workoutId,
        date: workoutDate,
        sets: history.filter((s) => s.sessionDate === workoutDate),
      },
      history,
    );
    expect(prs.find((p) => p.type === 'weight' && p.exerciseId === 'bb_bench')).toBeDefined();

    for (const pr of prs) {
      await savePersonalRecord(db, { userId: USER, exerciseId: pr.exerciseId, type: pr.type, value: pr.value, workoutId }, id);
    }
    const saved = await db.getFirstAsync<{ n: number }>('select count(*) as n from personal_records');
    expect(saved!.n).toBe(prs.length);
  });
});
