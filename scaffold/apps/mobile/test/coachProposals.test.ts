import { describe, expect, it } from 'vitest';
import type { SessionPlan } from '@atrium/engine';
import {
  applyCoachProposal,
  buildCoachProposalSet,
  coachPlanFingerprint,
  coachProposalIdFromPlan,
  markPlanWithCoachProposal,
  preferredOfflineProposalId,
  startCoachProposalWorkout,
} from '../src/coach/proposals';
import { buildCoachContextPack } from '../src/coach/context';
import {
  getActiveProgram,
  getNextProgramDay,
  getWorkoutDraft,
  getWorkoutOverview,
  previewProgramDay,
  saveWorkoutDraft,
  seedDemoProgram,
  seedExerciseCatalog,
  startWorkout,
} from '../src/db/queries';
import { migrate, type SqlDb, type SqlParam } from '../src/db/schema';
import { getReadinessSignal, saveHealthSample } from '../src/health/readiness';
import { openNodeDb } from './helpers/nodeDb';

function fixturePlan(): SessionPlan {
  return {
    programDayId: 'day-1',
    name: 'Upper — Strength',
    weekIndex: 2,
    readinessApplied: 'green',
    prescriptions: [
      {
        slotId: 'slot-bench',
        exerciseId: 'bb_bench',
        rule: 'top_set_backoff',
        rest_s: 180,
        sets: [
          { setIndex: -1, weight: 45, targetReps: [5, 5], kind: 'warmup', isWarmup: true },
          { setIndex: 0, weight: 200, targetReps: [4, 6], kind: 'top' },
          { setIndex: 1, weight: 170, targetReps: [6, 8], kind: 'backoff' },
          { setIndex: 2, weight: 170, targetReps: [6, 8], kind: 'backoff' },
          { setIndex: 3, weight: 170, targetReps: [6, 8], kind: 'backoff' },
        ],
        nextState: {
          slotId: 'slot-bench',
          exerciseId: 'bb_bench',
          pattern: 'hpress',
          rule: 'top_set_backoff',
          rest_s: 180,
          top: { sets: 1, reps: [4, 6] },
          backoff: { sets: 3, reps: [6, 8], pct_of_top: 0.85 },
          topWeight: 200,
          stallCycles: 0,
        },
      },
      {
        slotId: 'slot-row',
        exerciseId: 'bb_row',
        rule: 'double_progression',
        rest_s: 150,
        sets: [
          { setIndex: 0, weight: 135, targetReps: [6, 8], kind: 'work' },
          { setIndex: 1, weight: 135, targetReps: [6, 8], kind: 'work' },
          { setIndex: 2, weight: 135, targetReps: [6, 8], kind: 'work' },
        ],
        nextState: {
          slotId: 'slot-row',
          exerciseId: 'bb_row',
          pattern: 'hpull',
          rule: 'double_progression',
          rest_s: 150,
          sets: 3,
          reps: [6, 8],
          workingWeight: 135,
          stallCycles: 0,
        },
      },
    ],
  };
}

describe('validated Coach proposals', () => {
  it('builds deterministic opaque keep/one-set/two-set options', () => {
    const plan = fixturePlan();
    const first = buildCoachProposalSet(plan);
    const second = buildCoachProposalSet(JSON.parse(JSON.stringify(plan)) as SessionPlan);
    expect(first.planFingerprint).toBe(coachPlanFingerprint(plan));
    expect(second.options.map((option) => option.id)).toEqual(first.options.map((option) => option.id));
    expect(first.options.map((option) => [option.kind, option.setReduction])).toEqual([
      ['keep_plan', 0],
      ['reduce_volume', 1],
      ['reduce_volume', 2],
    ]);
    expect(first.options.every((option) => /^cp_[a-f0-9]{16}$/.test(option.id))).toBe(true);
    expect(first.options[1]).toMatchObject({
      exerciseName: 'Bench Press',
      beforeBackoffSets: 3,
      afterBackoffSets: 2,
    });
  });

  it('removes only the final requested back-off sets and preserves protected work', () => {
    const plan = fixturePlan();
    const proposalSet = buildCoachProposalSet(plan);
    for (const reduction of [1, 2] as const) {
      const option = proposalSet.options.find((candidate) => candidate.setReduction === reduction)!;
      const proposed = applyCoachProposal(plan, option);
      const before = plan.prescriptions[0]!;
      const after = proposed.prescriptions[0]!;
      expect(after.sets.filter((set) => set.kind === 'backoff')).toHaveLength(3 - reduction);
      expect(after.sets.find((set) => set.kind === 'warmup')).toEqual(before.sets.find((set) => set.kind === 'warmup'));
      expect(after.sets.find((set) => set.kind === 'top')).toEqual(before.sets.find((set) => set.kind === 'top'));
      expect(proposed.prescriptions[1]).toEqual(plan.prescriptions[1]);
      expect(after.sets.filter((set) => set.kind === 'backoff').map((set) => set.setIndex)).toEqual(
        reduction === 1 ? [1, 2] : [1],
      );
    }
  });

  it('fails closed for stale/invented options and plans without eligible back-off work', () => {
    const plan = fixturePlan();
    const option = buildCoachProposalSet(plan).options[1]!;
    expect(() => applyCoachProposal({ ...plan, weekIndex: 3 }, option)).toThrow('stale');
    const withoutBackoffs: SessionPlan = {
      ...plan,
      prescriptions: plan.prescriptions.slice(1),
    };
    expect(buildCoachProposalSet(withoutBackoffs).options).toHaveLength(1);
  });

  it('marks applied drafts without exposing the marker in model summaries', () => {
    const plan = fixturePlan();
    const id = buildCoachProposalSet(plan).options[1]!.id;
    const marked = markPlanWithCoachProposal(plan, id);
    expect(coachProposalIdFromPlan(marked)).toBe(id);
    expect(coachProposalIdFromPlan(plan)).toBeNull();
  });

  it('selects only obvious offline actions and never offers a red-readiness start', () => {
    const options = buildCoachProposalSet(fixturePlan()).options;
    expect(preferredOfflineProposalId('Feeling run down', 'green', options)).toBe(options[1]!.id);
    expect(preferredOfflineProposalId('What workout should I do today?', 'green', options)).toBe(options[0]!.id);
    expect(preferredOfflineProposalId('Why am I stuck?', 'green', options)).toBeNull();
    expect(preferredOfflineProposalId('What workout should I do today?', 'red', options)).toBeNull();
  });

  it('revalidates, creates exactly one marked draft, and makes duplicate Apply idempotent', async () => {
    const db = openNodeDb();
    await migrate(db);
    await seedExerciseCatalog(db);
    let count = 0;
    const newId = () => `coach-proposal-${++count}`;
    const userId = 'proposal-user';
    const now = new Date('2026-08-05T12:00:00.000Z');
    await seedDemoProgram(db, userId, newId);
    const pack = await buildCoachContextPack(db, userId, now);
    const option = pack.proposalSet?.options.find((candidate) => candidate.kind === 'reduce_volume');
    expect(option).toBeDefined();

    const [first, second] = await Promise.all([
      startCoachProposalWorkout(db, userId, option!.id, newId, now),
      startCoachProposalWorkout(db, userId, option!.id, newId, now),
    ]);
    expect([first.status, second.status].sort()).toEqual(['already_applied', 'started']);
    const workoutId = first.status === 'started' ? first.workoutId : second.status === 'started' ? second.workoutId : '';
    const draft = await getWorkoutDraft(db, workoutId);
    expect(draft).not.toBeNull();
    expect(coachProposalIdFromPlan(draft?.plan)).toBe(option!.id);
    expect(draft?.programDayId).toBe(draft?.day.dayId);

    const liveWorkouts = await db.getFirstAsync<{ total: number }>(
      'select count(*) as total from workouts where user_id = ? and ended_at is null and deleted_at is null',
      userId,
    );
    const liveDrafts = await db.getFirstAsync<{ total: number }>(
      'select count(*) as total from workout_drafts where user_id = ? and deleted_at is null',
      userId,
    );
    const workout = await db.getFirstAsync<{ readiness_at_start: number | null }>(
      'select readiness_at_start from workouts where id = ?',
      workoutId,
    );
    expect(liveWorkouts?.total).toBe(1);
    expect(liveDrafts?.total).toBe(1);
    expect(workout?.readiness_at_start).toBe(pack.readiness.score);
    expect((await db.getFirstAsync<{ total: number }>(
      `select count(*) as total from mutation_queue
        where entity = 'workouts' and op = 'upsert'`,
    ))?.total).toBe(1);
    const appliedPack = await buildCoachContextPack(db, userId, now);
    expect(appliedPack.actionState).toEqual({
      hasActiveWorkout: true,
      activeWorkoutId: workoutId,
      activeProposalId: option!.id,
    });
    expect(appliedPack.proposalOptions).toEqual([]);
    expect((await startCoachProposalWorkout(db, userId, option!.id, newId, now))).toMatchObject({
      status: 'already_applied',
      workoutId,
    });
    db.close();
  });

  it('leaves an existing unmarked active workout and draft unchanged', async () => {
    const db = openNodeDb();
    await migrate(db);
    await seedExerciseCatalog(db);
    let count = 0;
    const newId = () => `coach-active-${++count}`;
    const userId = 'active-user';
    const now = new Date('2026-08-05T12:00:00.000Z');
    await seedDemoProgram(db, userId, newId);
    const pack = await buildCoachContextPack(db, userId, now);
    const option = pack.proposalSet?.options.find((candidate) => candidate.kind === 'reduce_volume');
    expect(option).toBeDefined();

    const program = (await getActiveProgram(db, userId))!;
    const day = (await getNextProgramDay(db, program.id))!;
    const plan = await previewProgramDay(db, userId, day, 'green');
    const workoutId = await startWorkout(db, userId, day.dayId, newId, 80);
    await saveWorkoutDraft(db, {
      workoutId,
      userId,
      programDayId: day.dayId,
      day,
      plan,
      setUi: {},
      activeIndex: 0,
      restRemainingS: null,
    });
    const beforeDraft = await db.getFirstAsync<{
      program_day_id: string | null;
      plan_json: string;
      set_ui_json: string;
      updated_at: string;
    }>(
      `select program_day_id, plan_json, set_ui_json, updated_at
         from workout_drafts where workout_id = ?`,
      workoutId,
    );
    const mutationsBefore = (await db.getFirstAsync<{ total: number }>(
      'select count(*) as total from mutation_queue',
    ))?.total;

    expect(await startCoachProposalWorkout(db, userId, option!.id, newId, now)).toEqual({
      status: 'active_workout',
      workoutId,
    });
    expect(await db.getFirstAsync(
      `select program_day_id, plan_json, set_ui_json, updated_at
         from workout_drafts where workout_id = ?`,
      workoutId,
    )).toEqual(beforeDraft);
    expect((await db.getFirstAsync<{ total: number }>(
      'select count(*) as total from mutation_queue',
    ))?.total).toBe(mutationsBefore);
    db.close();
  });

  it('does not adopt a same-day workout created after the final Coach active check', async () => {
    const db = openNodeDb();
    await migrate(db);
    await seedExerciseCatalog(db);
    let count = 0;
    const newId = () => `coach-race-${++count}`;
    const userId = 'race-user';
    const now = new Date('2026-08-05T12:00:00.000Z');
    await seedDemoProgram(db, userId, newId);
    const pack = await buildCoachContextPack(db, userId, now);
    const option = pack.proposalSet?.options.find((candidate) => candidate.kind === 'reduce_volume');
    expect(option).toBeDefined();
    const program = (await getActiveProgram(db, userId))!;
    const day = (await getNextProgramDay(db, program.id))!;
    let activeLookups = 0;
    let competingWorkoutId: string | null = null;
    const raceDb: SqlDb = {
      execAsync: (sql) => db.execAsync(sql),
      runAsync: (sql, ...params) => db.runAsync(sql, ...params),
      getAllAsync: <T,>(sql: string, ...params: SqlParam[]) => db.getAllAsync<T>(sql, ...params),
      getFirstAsync: async <T,>(sql: string, ...params: SqlParam[]) => {
        const value = await db.getFirstAsync<T>(sql, ...params);
        if (sql.includes('where w.user_id = ? and w.ended_at is null and w.deleted_at is null')) {
          activeLookups += 1;
          if (activeLookups === 2) {
            competingWorkoutId = await startWorkout(db, userId, day.dayId, newId, 79);
          }
        }
        return value;
      },
      withTransactionAsync: (fn) => db.withTransactionAsync(fn),
    };

    const result = await startCoachProposalWorkout(raceDb, userId, option!.id, newId, now);
    expect(result).toEqual({ status: 'active_workout', workoutId: competingWorkoutId });
    expect(competingWorkoutId).not.toBeNull();
    expect(await getWorkoutDraft(db, competingWorkoutId!)).toBeNull();
    expect((await db.getFirstAsync<{ total: number }>(
      'select count(*) as total from workouts where user_id = ? and ended_at is null and deleted_at is null',
      userId,
    ))?.total).toBe(1);
    expect((await db.getFirstAsync<{ total: number }>(
      `select count(*) as total from mutation_queue
        where entity = 'workouts' and op = 'upsert'`,
    ))?.total).toBe(1);
    db.close();
  });

  it('serializes different concurrent proposal ids and never labels the second one applied', async () => {
    const db = openNodeDb();
    await migrate(db);
    await seedExerciseCatalog(db);
    let count = 0;
    const newId = () => `coach-distinct-${++count}`;
    const userId = 'distinct-user';
    const now = new Date('2026-08-05T12:00:00.000Z');
    await seedDemoProgram(db, userId, newId);
    const pack = await buildCoachContextPack(db, userId, now);
    const firstOption = pack.proposalSet?.options.find((candidate) => candidate.kind === 'keep_plan');
    const secondOption = pack.proposalSet?.options.find((candidate) => candidate.kind === 'reduce_volume');
    expect(firstOption).toBeDefined();
    expect(secondOption).toBeDefined();

    const [first, second] = await Promise.all([
      startCoachProposalWorkout(db, userId, firstOption!.id, newId, now),
      startCoachProposalWorkout(db, userId, secondOption!.id, newId, now),
    ]);
    expect(first).toMatchObject({ status: 'started' });
    expect(second).toMatchObject({ status: 'active_workout' });
    expect(second.status).not.toBe('already_applied');
    const workoutId = first.status === 'started' ? first.workoutId : '';
    expect(coachProposalIdFromPlan((await getWorkoutDraft(db, workoutId))?.plan)).toBe(firstOption!.id);
    expect((await db.getFirstAsync<{ total: number }>(
      `select count(*) as total from mutation_queue
        where entity = 'workouts' and op = 'upsert'`,
    ))?.total).toBe(1);
    db.close();
  });

  it('scopes workout overview lookup to the owning user', async () => {
    const db = openNodeDb();
    await migrate(db);
    let count = 0;
    const newId = () => `coach-owner-${++count}`;
    const ownerId = 'workout-owner';
    await seedDemoProgram(db, ownerId, newId);
    const program = (await getActiveProgram(db, ownerId))!;
    const day = (await getNextProgramDay(db, program.id))!;
    const workoutId = await startWorkout(db, ownerId, day.dayId, newId, 78);

    expect(await getWorkoutOverview(db, workoutId, ownerId)).toMatchObject({ workoutId });
    expect(await getWorkoutOverview(db, workoutId, 'another-user')).toBeNull();
    db.close();
  });

  it('fails closed when live readiness turns red without writing workout state', async () => {
    const db = openNodeDb();
    await migrate(db);
    await seedExerciseCatalog(db);
    let count = 0;
    const newId = () => `coach-red-${++count}`;
    const userId = 'red-user';
    const now = new Date('2026-08-05T12:00:00.000Z');
    await seedDemoProgram(db, userId, newId);
    const pack = await buildCoachContextPack(db, userId, now);
    const option = pack.proposalSet?.options.find((candidate) => candidate.kind === 'keep_plan');
    expect(option).toBeDefined();

    for (let day = 29; day <= 31; day += 1) {
      await saveHealthSample(db, {
        userId,
        source: 'test',
        type: 'rhr',
        date: `2026-07-${day}`,
        value: { bpm: 58 },
        externalId: `rhr-07-${day}`,
      }, newId);
    }
    for (let day = 1; day <= 4; day += 1) {
      await saveHealthSample(db, {
        userId,
        source: 'test',
        type: 'rhr',
        date: `2026-08-0${day}`,
        value: { bpm: 58 },
        externalId: `rhr-08-${day}`,
      }, newId);
    }
    await saveHealthSample(db, {
      userId,
      source: 'test',
      type: 'sleep',
      date: '2026-08-05',
      value: { minutes: 300 },
      externalId: 'sleep-08-05',
    }, newId);
    await saveHealthSample(db, {
      userId,
      source: 'test',
      type: 'rhr',
      date: '2026-08-05',
      value: { bpm: 70 },
      externalId: 'rhr-08-05',
    }, newId);
    expect((await getReadinessSignal(db, userId, '2026-08-05')).readiness).toBe('red');
    const mutationsBefore = (await db.getFirstAsync<{ total: number }>(
      'select count(*) as total from mutation_queue',
    ))?.total;
    const slotsBefore = await db.getAllAsync<{ id: string; state: string; updated_at: string }>(
      'select id, state, updated_at from program_slots order by id',
    );

    expect(await startCoachProposalWorkout(db, userId, option!.id, newId, now)).toEqual({
      status: 'stale',
      reason: 'readiness',
    });
    expect((await db.getFirstAsync<{ total: number }>(
      'select count(*) as total from workouts where user_id = ?',
      userId,
    ))?.total).toBe(0);
    expect((await db.getFirstAsync<{ total: number }>(
      'select count(*) as total from workout_drafts where user_id = ?',
      userId,
    ))?.total).toBe(0);
    expect((await db.getFirstAsync<{ total: number }>(
      'select count(*) as total from mutation_queue',
    ))?.total).toBe(mutationsBefore);
    expect(await db.getAllAsync(
      'select id, state, updated_at from program_slots order by id',
    )).toEqual(slotsBefore);
    db.close();
  });

  it('rejects an invented proposal before creating a workout or draft', async () => {
    const db = openNodeDb();
    await migrate(db);
    await seedExerciseCatalog(db);
    let count = 0;
    const newId = () => `coach-stale-${++count}`;
    const userId = 'stale-user';
    await seedDemoProgram(db, userId, newId);
    const result = await startCoachProposalWorkout(
      db,
      userId,
      'cp_ffffffffffffffff',
      newId,
      new Date('2026-08-05T12:00:00.000Z'),
    );
    expect(result).toEqual({ status: 'stale', reason: 'plan' });
    expect((await db.getFirstAsync<{ total: number }>(
      'select count(*) as total from workouts where user_id = ?', userId,
    ))?.total).toBe(0);
    expect((await db.getFirstAsync<{ total: number }>(
      'select count(*) as total from workout_drafts where user_id = ?', userId,
    ))?.total).toBe(0);
    db.close();
  });
});
