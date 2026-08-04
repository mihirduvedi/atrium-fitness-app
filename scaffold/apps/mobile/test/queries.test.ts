import { beforeEach, describe, expect, it } from 'vitest';
import { detectPRs } from '@atrium/engine';
import { migrate, type SqlDb } from '../src/db/schema';
import {
  addMovementToProgramDay,
  cloneProgramIntoWorkoutPlan,
  createCustomExercise,
  createProgramDayTemplate,
  createProgramFromOnboarding,
  createWorkoutPlanTemplate,
  deleteCustomExercise,
  discardEmptyInProgressWorkouts,
  discardWorkout,
  finishWorkout,
  getActiveProgram,
  getHistory,
  getInProgressWorkout,
  getInProgressWorkoutOverview,
  getNextProgramDay,
  getProgressAnalytics,
  getProgramDayContext,
  getProgramOverview,
  getPreviousSession,
  getWorkoutDraft,
  getWorkoutSummary,
  listExercises,
  listProgramLibrary,
  listWorkoutPlanLibrary,
  logSet,
  planSession,
  previewProgramDay,
  reorderProgramSlots,
  removeMovementFromProgramDay,
  removeProgramFromWorkoutPlan,
  renameProgramDay,
  renameWorkout,
  saveProgramDaySettings,
  saveWorkoutPlanSettings,
  savePersonalRecord,
  saveSubjectiveTag,
  setProgramDayActive,
  setWorkoutPlanActive,
  saveWorkoutDraft,
  seedDemoProgram,
  seedExerciseCatalog,
  startWorkout,
  unlogSet,
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
        isWarmup: s.isWarmup,
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
    expect(bench.sets.filter((s) => s.isWarmup)).toEqual([
      { setIndex: -1, weight: 45, targetReps: [10, 10], kind: 'warmup', isWarmup: true },
    ]);
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
    expect(row.sets.filter((s) => s.isWarmup)).toHaveLength(2);
    expect(row.sets.find((s) => !s.isWarmup)!.weight).toBe(105); // double progression: all sets at top → +5

    // state was persisted: re-planning is idempotent
    const again = await planSession(db, USER, day, id);
    expect(again.prescriptions.find((p) => p.exerciseId === 'bb_row')!.sets.find((s) => !s.isWarmup)!.weight).toBe(105);
  });

  it('readiness yellow trims a set from compounds at plan time', async () => {
    await seedDemoProgram(db, USER, id);
    const program = (await getActiveProgram(db, USER))!;
    const day = (await getNextProgramDay(db, program.id))!;
    const plan = await planSession(db, USER, day, id, 'yellow');
    const bench = plan.prescriptions[0]!;
    expect(bench.sets.filter((s) => !s.isWarmup)).toHaveLength(3); // 1 top + 2 backoffs
    expect(bench.sets.filter((s) => s.isWarmup)).toHaveLength(1); // empty-bar primer while load is unknown
    expect(plan.readinessApplied).toBe('yellow');
  });

  it('builds a program overview with next day and completed day counts', async () => {
    await seedDemoProgram(db, USER, id);
    let overview = (await getProgramOverview(db, USER))!;
    expect(overview.week).toBe(1);
    expect(overview.completedThisWeek).toBe(0);
    expect(overview.days).toHaveLength(4);
    expect(overview.days[0]).toMatchObject({
      dayIndex: 0,
      name: 'Upper — Strength',
      completedWorkouts: 0,
    });
    expect(overview.days[0]!.slots.length).toBeGreaterThan(0);
    expect(overview.nextDay).toMatchObject({ dayIndex: 0 });

    await performSession(USER);
    overview = (await getProgramOverview(db, USER))!;
    expect(overview.totalCompletedWorkouts).toBe(1);
    expect(overview.completedThisWeek).toBe(1);
    expect(overview.nextDay).toMatchObject({ dayIndex: 1 });
    expect(overview.days[0]).toMatchObject({ completedWorkouts: 1 });
  });

  it('previews readiness changes without persisting slot state', async () => {
    await seedDemoProgram(db, USER, id);
    const program = (await getActiveProgram(db, USER))!;
    const day = (await getNextProgramDay(db, program.id))!;
    const before = await db.getFirstAsync<{ state: string }>(
      'select state from program_slots where program_day_id = ? order by slot_index limit 1',
      day.dayId,
    );
    const plan = await previewProgramDay(db, USER, day, 'yellow');
    const after = await db.getFirstAsync<{ state: string }>(
      'select state from program_slots where program_day_id = ? order by slot_index limit 1',
      day.dayId,
    );
    expect(plan.readinessApplied).toBe('yellow');
    expect(plan.prescriptions[0]!.sets.filter((s) => !s.isWarmup).length).toBeLessThan(4);
    expect(after!.state).toBe(before!.state);
  });

  it('creates, deletes, adds, and reorders custom movements in the active program', async () => {
    await seedDemoProgram(db, USER, id);
    const custom = await createCustomExercise(db, USER, {
      name: 'Cable Y Raise',
      pattern: 'side_delt',
      equipment: 'cable',
      description: 'Slow shoulder raise',
      defaultSets: 4,
      defaultReps: 12,
    }, id);
    let exercises = await listExercises(db, USER);
    expect(exercises.find((exercise) => exercise.id === custom.id)).toMatchObject({
      name: 'Cable Y Raise',
      defaultSets: 4,
      defaultReps: 12,
    });

    const program = (await getActiveProgram(db, USER))!;
    const day = (await getNextProgramDay(db, program.id))!;
    const added = await addMovementToProgramDay(db, day.dayId, custom.id, { sets: 2, reps: 15 }, id);
    expect(added).toMatchObject({ exerciseId: custom.id, exerciseName: 'Cable Y Raise' });

    let overview = (await getProgramOverview(db, USER))!;
    const nextDay = overview.days.find((item) => item.dayId === day.dayId)!;
    expect(nextDay.slots[nextDay.slots.length - 1]).toMatchObject({ exerciseId: custom.id, slotIndex: nextDay.slots.length - 1 });

    const ordered = [added.slotId, ...nextDay.slots.filter((slot) => slot.slotId !== added.slotId).map((slot) => slot.slotId)];
    await reorderProgramSlots(db, day.dayId, ordered, id);
    overview = (await getProgramOverview(db, USER))!;
    expect(overview.days.find((item) => item.dayId === day.dayId)!.slots[0]).toMatchObject({ slotId: added.slotId, slotIndex: 0 });

    expect(await deleteCustomExercise(db, USER, custom.id, id)).toBe(true);
    exercises = await listExercises(db, USER);
    expect(exercises.find((exercise) => exercise.id === custom.id)).toBeUndefined();
  });

  it('lists, renames, schedules, toggles, and edits program templates', async () => {
    await seedDemoProgram(db, USER, id);
    let library = await listProgramLibrary(db, USER);
    expect(library).toHaveLength(4);
    const first = library[0]!;
    expect(first.active).toBe(true);
    expect(first.movements.length).toBeGreaterThan(0);

    await renameProgramDay(db, first.programDayId, 'Lower Body - Volume', id);
    await saveProgramDaySettings(db, {
      userId: USER,
      programDayId: first.programDayId,
      category: 'lower',
      notes: 'Keep one rep in reserve.',
      repeatEvery: 2,
      repeatUnit: 'week',
      weekdays: [1, 3],
      setRestSeconds: 75,
      exerciseRestSeconds: 150,
    });

    library = await listProgramLibrary(db, USER);
    const renamed = library.find((item) => item.programDayId === first.programDayId)!;
    expect(renamed).toMatchObject({
      name: 'Lower Body - Volume',
      category: 'lower',
      notes: 'Keep one rep in reserve.',
      repeatEvery: 2,
      repeatUnit: 'week',
      weekdays: [1, 3],
      setRestSeconds: 75,
      exerciseRestSeconds: 150,
    });

    expect(await getProgramDayContext(db, first.programDayId)).toMatchObject({
      setRestSeconds: 75,
      exerciseRestSeconds: 150,
    });
    expect(await getNextProgramDay(db, first.workoutPlanId)).toMatchObject({
      dayId: first.programDayId,
      setRestSeconds: 75,
      exerciseRestSeconds: 150,
    });

    await setProgramDayActive(db, USER, first.programDayId, false);
    expect((await getNextProgramDay(db, renamed.workoutPlanId))!.dayId).not.toBe(first.programDayId);
    expect((await getProgramOverview(db, USER))!.days.some((day) => day.dayId === first.programDayId)).toBe(false);

    const slotToRemove = renamed.movements[0]!;
    expect(await removeMovementFromProgramDay(db, slotToRemove.slotId, id)).toBe(true);
    library = await listProgramLibrary(db, USER);
    expect(library.find((item) => item.programDayId === first.programDayId)!.movements).toHaveLength(renamed.movements.length - 1);

    const customProgramId = await createProgramDayTemplate(db, USER, {
      name: 'Arms - Pump',
      category: 'arms',
      repeatEvery: 1,
      repeatUnit: 'week',
      weekdays: [5],
      setRestSeconds: 60,
      exerciseRestSeconds: 120,
    }, id);
    library = await listProgramLibrary(db, USER);
    expect(library.find((item) => item.programDayId === customProgramId)).toMatchObject({
      name: 'Arms - Pump',
      active: false,
      category: 'arms',
      weekdays: [5],
      setRestSeconds: 60,
      exerciseRestSeconds: 120,
    });

    await addMovementToProgramDay(db, customProgramId, 'db_curl', { sets: 3, reps: 12 }, id);
    await setProgramDayActive(db, USER, customProgramId, true);
    expect((await getProgramOverview(db, USER))!.days.some((day) => day.dayId === customProgramId)).toBe(true);
  });

  it('preserves inferred program categories when toggling active state', async () => {
    await seedDemoProgram(db, USER, id);
    const before = await listProgramLibrary(db, USER);
    const categories = new Map(before.map((program) => [program.programDayId, program.category]));

    for (const program of before) {
      await setProgramDayActive(db, USER, program.programDayId, false);
      await setProgramDayActive(db, USER, program.programDayId, true);
    }

    const after = await listProgramLibrary(db, USER);
    expect(after.map((program) => program.category)).toEqual(
      after.map((program) => categories.get(program.programDayId)),
    );
    expect(after.map((program) => program.category)).toEqual(['upper', 'lower', 'upper', 'lower']);
  });

  it('lists, renames, toggles, creates, and edits workout plan templates', async () => {
    await seedDemoProgram(db, USER, id);
    let plans = await listWorkoutPlanLibrary(db, USER);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ active: true, goal: 'general' });
    expect(plans[0]!.programs).toHaveLength(4);

    await saveWorkoutPlanSettings(db, {
      userId: USER,
      planId: plans[0]!.planId,
      name: 'Strength Training',
      goal: 'strength',
      notes: 'Main goal block.',
    });
    plans = await listWorkoutPlanLibrary(db, USER);
    expect(plans[0]).toMatchObject({
      name: 'Strength Training',
      goal: 'strength',
      notes: 'Main goal block.',
    });

    const newPlanId = await createWorkoutPlanTemplate(db, USER, {
      name: 'Weight Loss Plan',
      goal: 'weight_loss',
      active: false,
    }, id);
    const sourceProgram = plans[0]!.programs[0]!;
    const copiedProgramId = await cloneProgramIntoWorkoutPlan(db, USER, sourceProgram.programDayId, newPlanId, id);
    const secondSourceProgram = plans[0]!.programs[1]!;
    const secondCopiedProgramId = await cloneProgramIntoWorkoutPlan(db, USER, secondSourceProgram.programDayId, newPlanId, id);
    expect(copiedProgramId).not.toBeNull();
    expect(secondCopiedProgramId).not.toBeNull();

    await setWorkoutPlanActive(db, USER, newPlanId, true, id);
    plans = await listWorkoutPlanLibrary(db, USER);
    const newPlan = plans.find((plan) => plan.planId === newPlanId)!;
    expect(newPlan).toMatchObject({ name: 'Weight Loss Plan', goal: 'weight_loss', active: true });
    expect(plans.find((plan) => plan.planId !== newPlanId)).toMatchObject({ active: false });
    expect((await getActiveProgram(db, USER))!.id).toBe(newPlanId);
    expect(newPlan.programs).toHaveLength(2);
    expect(newPlan.programs[0]).toMatchObject({ name: sourceProgram.name, category: sourceProgram.category });
    expect(newPlan.programs.map((program) => program.dayIndex)).toEqual([0, 1]);

    expect(await removeProgramFromWorkoutPlan(db, USER, copiedProgramId!, id)).toBe(true);
    plans = await listWorkoutPlanLibrary(db, USER);
    expect(plans.find((plan) => plan.planId === newPlanId)!.programs).toMatchObject([
      { programDayId: secondCopiedProgramId, dayIndex: 0, name: secondSourceProgram.name },
    ]);
  });
});

describe('Stage 5 data layer: Active Workout', () => {
  it('persists draft queue order, active cursor, typed inputs, and prevents duplicate active workouts', async () => {
    await seedDemoProgram(db, USER, id);
    const program = (await getActiveProgram(db, USER))!;
    const day = (await getNextProgramDay(db, program.id))!;
    const plan = await planSession(db, USER, day, id);
    const workoutId = await startWorkout(db, USER, day.dayId, id);
    const reordered = { ...plan, prescriptions: [plan.prescriptions[1]!, plan.prescriptions[0]!, ...plan.prescriptions.slice(2)] };
    const first = reordered.prescriptions[0]!;
    const key = `${first.slotId}:${first.sets[0]!.setIndex}`;

    await saveWorkoutDraft(db, {
      workoutId,
      userId: USER,
      programDayId: day.dayId,
      day,
      plan: reordered,
      setUi: {
        [key]: { weight: '135', reps: '7', done: false },
      },
      activeIndex: 1,
      restRemainingS: 90,
      restSavedAt: new Date().toISOString(),
    });

    expect(await startWorkout(db, USER, day.dayId, id)).toBe(workoutId);
    const active = await getInProgressWorkoutOverview(db, USER);
    expect(active).toMatchObject({ workoutId, programDayId: day.dayId, completedSets: 0 });

    const draft = (await getWorkoutDraft(db, workoutId))!;
    expect(draft.plan.prescriptions.map((p) => p.slotId).slice(0, 2)).toEqual([
      plan.prescriptions[1]!.slotId,
      plan.prescriptions[0]!.slotId,
    ]);
    expect(draft.activeIndex).toBe(1);
    expect(draft.setUi[key]).toMatchObject({ weight: '135', reps: '7', done: false });
    expect(draft.restRemainingS).toBeGreaterThan(80);
    expect(draft.restRemainingS).toBeLessThanOrEqual(90);
  });

  it('persists custom workout names through active drafts and summaries', async () => {
    await seedDemoProgram(db, USER, id);
    const program = (await getActiveProgram(db, USER))!;
    const day = (await getNextProgramDay(db, program.id))!;
    const plan = await planSession(db, USER, day, id);
    const workoutId = await startWorkout(db, USER, day.dayId, id);
    await saveWorkoutDraft(db, {
      workoutId,
      userId: USER,
      programDayId: day.dayId,
      day,
      plan,
      setUi: {},
      activeIndex: 0,
      restRemainingS: null,
    });

    await renameWorkout(db, workoutId, 'Legs - Volume', id);

    expect(await getInProgressWorkoutOverview(db, USER)).toMatchObject({ workoutId, customName: 'Legs - Volume' });
    expect((await getWorkoutDraft(db, workoutId))!.customName).toBe('Legs - Volume');

    await finishWorkout(db, workoutId, id);
    expect((await getWorkoutSummary(db, workoutId))!.customName).toBe('Legs - Volume');
  });

  it('cleans stale empty active workouts while preserving a draft and logged progress', async () => {
    await seedDemoProgram(db, USER, id);
    const program = (await getActiveProgram(db, USER))!;
    const day = (await getNextProgramDay(db, program.id))!;
    const plan = await planSession(db, USER, day, id);
    const keeper = await startWorkout(db, USER, day.dayId, id);
    await saveWorkoutDraft(db, {
      workoutId: keeper,
      userId: USER,
      programDayId: day.dayId,
      day,
      plan,
      setUi: {},
      activeIndex: 0,
      restRemainingS: null,
    });

    const staleWithDraft = 'legacy-empty-draft';
    const staleWithoutDraft = 'legacy-empty-no-draft';
    const activeWithSet = 'legacy-with-set';
    const ts = '2026-05-01T10:00:00.000Z';
    for (const workoutId of [staleWithDraft, staleWithoutDraft, activeWithSet]) {
      await db.runAsync(
        `insert into workouts (id, user_id, program_day_id, started_at, ended_at, notes, readiness_at_start, updated_at, deleted_at)
         values (?, ?, ?, ?, null, null, null, ?, null)`,
        workoutId,
        USER,
        day.dayId,
        ts,
        ts,
      );
    }
    await saveWorkoutDraft(db, {
      workoutId: staleWithDraft,
      userId: USER,
      programDayId: day.dayId,
      day,
      plan,
      setUi: {},
      activeIndex: 0,
      restRemainingS: null,
    });
    const first = plan.prescriptions[0]!;
    const firstSet = first.sets[0]!;
    await logSet(db, {
      workoutId: activeWithSet,
      exerciseId: first.exerciseId,
      setIndex: firstSet.setIndex,
      weight: 100,
      reps: 5,
      isWarmup: firstSet.isWarmup,
    }, id);

    expect(await discardEmptyInProgressWorkouts(db, USER, id, keeper)).toBe(2);

    const rows = await db.getAllAsync<{ id: string; deleted_at: string | null }>(
      `select id, deleted_at from workouts
        where id in (?, ?, ?, ?)
        order by id`,
      keeper,
      staleWithDraft,
      staleWithoutDraft,
      activeWithSet,
    );
    expect(Object.fromEntries(rows.map((row) => [row.id, row.deleted_at !== null]))).toEqual({
      'legacy-empty-draft': true,
      'legacy-empty-no-draft': true,
      'legacy-with-set': false,
      [keeper]: false,
    });
    expect(await getWorkoutDraft(db, staleWithDraft)).toBeNull();
  });

  it('hydrates completed draft sets from logged set rows', async () => {
    await seedDemoProgram(db, USER, id);
    const program = (await getActiveProgram(db, USER))!;
    const day = (await getNextProgramDay(db, program.id))!;
    const plan = await planSession(db, USER, day, id);
    const workoutId = await startWorkout(db, USER, day.dayId, id);
    const first = plan.prescriptions[0]!;
    const firstSet = first.sets[0]!;
    const key = `${first.slotId}:${firstSet.setIndex}`;

    await saveWorkoutDraft(db, {
      workoutId,
      userId: USER,
      programDayId: day.dayId,
      day,
      plan,
      setUi: { [key]: { weight: '123', reps: '4', done: true } },
      activeIndex: 0,
      restRemainingS: null,
    });
    await logSet(db, {
      workoutId,
      exerciseId: first.exerciseId,
      setIndex: firstSet.setIndex,
      weight: 155,
      reps: 6,
      isWarmup: firstSet.isWarmup,
    }, id);

    let draft = (await getWorkoutDraft(db, workoutId))!;
    expect(draft.setUi[key]).toMatchObject({ weight: '155', reps: '6', done: true });

    await unlogSet(db, {
      workoutId,
      exerciseId: first.exerciseId,
      setIndex: firstSet.setIndex,
      isWarmup: firstSet.isWarmup,
    }, id);
    draft = (await getWorkoutDraft(db, workoutId))!;
    expect(draft.setUi[key]).toMatchObject({ weight: '123', reps: '4', done: false });
  });

  it('preserves an exercise-level finish marker in the workout draft', async () => {
    await seedDemoProgram(db, USER, id);
    const program = (await getActiveProgram(db, USER))!;
    const day = (await getNextProgramDay(db, program.id))!;
    const plan = await planSession(db, USER, day, id);
    const workoutId = await startWorkout(db, USER, day.dayId, id);
    const first = plan.prescriptions[0]!;
    const finishedKey = `__workout_queue_finished__:${first.slotId}`;

    await saveWorkoutDraft(db, {
      workoutId,
      userId: USER,
      programDayId: day.dayId,
      day,
      plan,
      setUi: { [finishedKey]: { weight: '', reps: '', done: true } },
      activeIndex: 1,
      restRemainingS: null,
    });

    expect((await getWorkoutDraft(db, workoutId))!.setUi[finishedKey]).toEqual({
      weight: '',
      reps: '',
      done: true,
    });
  });

  it('clears active drafts when finishing or discarding', async () => {
    await seedDemoProgram(db, USER, id);
    const program = (await getActiveProgram(db, USER))!;
    const day = (await getNextProgramDay(db, program.id))!;
    const plan = await planSession(db, USER, day, id);
    const workoutId = await startWorkout(db, USER, day.dayId, id);
    await saveWorkoutDraft(db, {
      workoutId,
      userId: USER,
      programDayId: day.dayId,
      day,
      plan,
      setUi: {},
      activeIndex: 0,
      restRemainingS: null,
    });

    await finishWorkout(db, workoutId, id);
    expect(await getWorkoutDraft(db, workoutId)).toBeNull();
    expect(await getInProgressWorkout(db, USER)).toBeNull();

    const nextDay = (await getNextProgramDay(db, program.id))!;
    const nextPlan = await planSession(db, USER, nextDay, id);
    const discardedWorkoutId = await startWorkout(db, USER, nextDay.dayId, id);
    const first = nextPlan.prescriptions[0]!;
    const firstSet = first.sets[0]!;
    await saveWorkoutDraft(db, {
      workoutId: discardedWorkoutId,
      userId: USER,
      programDayId: nextDay.dayId,
      day: nextDay,
      plan: nextPlan,
      setUi: {},
      activeIndex: 0,
      restRemainingS: null,
    });
    await logSet(db, {
      workoutId: discardedWorkoutId,
      exerciseId: first.exerciseId,
      setIndex: firstSet.setIndex,
      weight: 100,
      reps: 5,
      isWarmup: firstSet.isWarmup,
    }, id);

    expect(await discardWorkout(db, discardedWorkoutId, id)).toBe(true);
    expect(await getWorkoutDraft(db, discardedWorkoutId)).toBeNull();
    expect(await getInProgressWorkout(db, USER)).toBeNull();
    const liveSets = await db.getFirstAsync<{ n: number }>(
      'select count(*) as n from sets where workout_id = ? and deleted_at is null',
      discardedWorkoutId,
    );
    expect(liveSets!.n).toBe(0);
  });

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

  it('unchecks a set by tombstoning the logged row', async () => {
    await seedDemoProgram(db, USER, id);
    const program = (await getActiveProgram(db, USER))!;
    const day = (await getNextProgramDay(db, program.id))!;
    const plan = await planSession(db, USER, day, id);
    const workoutId = await startWorkout(db, USER, day.dayId, id);
    const first = plan.prescriptions[0]!;
    const firstSet = first.sets[0]!;

    await logSet(db, {
      workoutId,
      exerciseId: first.exerciseId,
      setIndex: firstSet.setIndex,
      weight: firstSet.weight ?? 45,
      reps: firstSet.targetReps[1],
      isWarmup: firstSet.isWarmup,
    }, id);

    const removed = await unlogSet(db, {
      workoutId,
      exerciseId: first.exerciseId,
      setIndex: firstSet.setIndex,
      isWarmup: firstSet.isWarmup,
    }, id);

    expect(removed).toBe(true);
    const liveRows = await db.getFirstAsync<{ n: number }>(
      'select count(*) as n from sets where workout_id = ? and deleted_at is null',
      workoutId,
    );
    expect(liveRows!.n).toBe(0);
    const tombstones = await db.getFirstAsync<{ n: number }>(
      'select count(*) as n from sets where workout_id = ? and deleted_at is not null',
      workoutId,
    );
    expect(tombstones!.n).toBe(1);
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
    const workoutId = await startWorkout(db, USER, day.dayId, id, 82);
    for (const p of plan.prescriptions) {
      for (const s of p.sets) {
        await logSet(db, {
          workoutId,
          exerciseId: p.exerciseId,
          setIndex: s.setIndex,
          weight: (s.weight ?? 100) + 5, // beat last week
          reps: s.targetSeconds !== undefined ? s.targetSeconds : s.targetReps[1],
          isWarmup: s.isWarmup,
        }, id);
      }
    }
    await finishWorkout(db, workoutId, id);
    await saveSubjectiveTag(db, {
      userId: USER,
      workoutId,
      energy: 4,
      mood: 5,
      sleepQuality: 3,
      soreness: 2,
    }, id);

    const summary = (await getWorkoutSummary(db, workoutId))!;
    expect(summary.totalSets).toBeGreaterThan(10);
    expect(summary.totalVolume).toBeGreaterThan(0);
    expect(summary.endedAt).not.toBeNull();
    expect(summary.readinessAtStart).toBe(82);
    expect(summary.subjective).toEqual({ energy: 4, mood: 5, sleepQuality: 3, soreness: 2 });

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
    expect((await getWorkoutSummary(db, workoutId))!.records).toHaveLength(prs.length);
  });
});

describe('Stage 5 data layer: Progress analytics', () => {
  it('compares equal ranges and groups exercise changes into weekly buckets', async () => {
    await seedDemoProgram(db, USER, id);
    const dates = [
      '2026-04-07',
      '2026-04-14',
      '2026-04-21',
      '2026-04-28',
      '2026-05-07',
      '2026-05-14',
      '2026-05-21',
      '2026-05-28',
    ];
    for (const date of dates) {
      const workoutId = await performSession(USER);
      await db.runAsync('update workouts set started_at = ? where id = ?', `${date}T10:00:00.000Z`, workoutId);
    }

    const analytics = await getProgressAnalytics(db, USER, 28, '2026-06-01T00:00:00.000Z');
    expect(analytics.current.sessions).toBe(4);
    expect(analytics.previous.sessions).toBe(4);
    expect(analytics.current.volume).toBeGreaterThan(analytics.previous.volume);
    expect(analytics.weekly.map((week) => week.sessions)).toEqual([1, 1, 1, 1]);
    expect(analytics.weekly.every((week) => week.sets > 0 && week.volume > 0)).toBe(true);

    const bench = analytics.exercises.find((exercise) => exercise.exerciseId === 'bb_bench');
    expect(bench).toMatchObject({ exerciseName: 'Bench Press', sessions: 1 });
    expect(bench!.previousBestE1rm).not.toBeNull();
    expect(bench!.deltaE1rm).toBeCloseTo(bench!.currentBestE1rm - bench!.previousBestE1rm!);
  });
});
