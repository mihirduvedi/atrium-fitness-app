import { describe, expect, it } from 'vitest';
import type { Readiness, SetLog, SlotState } from '@atrium/engine';
import {
  analyzeCoachAdaptation,
  adaptiveDeloadEnabled,
  buildCoachAdaptationSignal,
  coachDeviceDateKey,
} from '../src/coach/adaptation';
import { migrate, type SqlDb } from '../src/db/schema';
import { openNodeDb } from './helpers/nodeDb';

function slot(slotId: string, exerciseId: string): SlotState {
  return {
    slotId,
    exerciseId,
    pattern: 'hpress',
    rule: 'double_progression',
    rest_s: 150,
    sets: 3,
    reps: [6, 8],
    workingWeight: 100,
    stallCycles: 0,
  };
}

function flatHistory(exerciseId: string, dates: string[]): SetLog[] {
  return dates.flatMap((sessionDate) => [0, 1, 2].map((setIndex) => ({
    exerciseId,
    sessionDate,
    setIndex,
    weight: 100,
    reps: 6,
  })));
}

function analyze(args: {
  slots: SlotState[];
  history: SetLog[];
  readinessLog?: Readiness[];
  week?: number;
  already?: boolean;
  recentDeload?: boolean;
}) {
  return analyzeCoachAdaptation({
    slots: args.slots,
    history: args.history,
    readinessLog: args.readinessLog ?? [],
    week: args.week ?? 3,
    weekStart: '2026-08-03',
    throughDate: '2026-08-09',
    deloadAlreadyThisBlock: args.already,
    completedDeloadWithinSignalWindow: args.recentDeload,
  });
}

async function seedProgram(
  db: SqlDb,
  args: {
    userId: string;
    programId: string;
    dayId: string;
    slots?: SlotState[];
    status?: string;
  },
) {
  const timestamp = '2026-07-01T00:00:00.000Z';
  await db.runAsync(
    `insert into programs (
       id, user_id, archetype_id, status, started_at, current_week, updated_at, deleted_at
     ) values (?, ?, 'ul4_strength', ?, ?, 1, ?, null)`,
    args.programId,
    args.userId,
    args.status ?? 'active',
    timestamp,
    timestamp,
  );
  await db.runAsync(
    `insert into program_days (
       id, program_id, day_index, name, updated_at, deleted_at
     ) values (?, ?, 0, 'Upper', ?, null)`,
    args.dayId,
    args.programId,
    timestamp,
  );
  for (const [index, state] of (args.slots ?? []).entries()) {
    await db.runAsync(
      `insert into program_slots (
         id, program_day_id, slot_index, pattern, exercise_id, scheme, rule,
         rest_s, state, updated_at, deleted_at
       ) values (?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, null)`,
      state.slotId,
      args.dayId,
      index,
      state.pattern,
      state.exerciseId,
      state.rule,
      state.rest_s,
      JSON.stringify(state),
      timestamp,
    );
  }
}

async function insertWorkout(
  db: SqlDb,
  args: {
    id: string;
    userId: string;
    dayId: string;
    startedAt: string;
    completed: boolean;
    readinessScore?: number | null;
  },
) {
  const endedAt = args.completed
    ? new Date(new Date(args.startedAt).getTime() + 60 * 60 * 1_000).toISOString()
    : null;
  await db.runAsync(
    `insert into workouts (
       id, user_id, program_day_id, started_at, ended_at, notes,
       readiness_at_start, updated_at, deleted_at
     ) values (?, ?, ?, ?, ?, null, ?, ?, null)`,
    args.id,
    args.userId,
    args.dayId,
    args.startedAt,
    endedAt,
    args.readinessScore ?? null,
    endedAt ?? args.startedAt,
  );
  return endedAt;
}

async function insertSet(
  db: SqlDb,
  args: {
    id: string;
    workoutId: string;
    exerciseId: string;
    setIndex: number;
    isWarmup?: boolean;
  },
) {
  const completedAt = '2026-08-08T12:00:00.000Z';
  await db.runAsync(
    `insert into sets (
       id, workout_id, exercise_id, set_index, weight, reps, is_warmup,
       completed_at, updated_at, deleted_at
     ) values (?, ?, ?, ?, 100, 6, ?, ?, ?, null)`,
    args.id,
    args.workoutId,
    args.exerciseId,
    args.setIndex,
    args.isWarmup ? 1 : 0,
    completedAt,
    completedAt,
  );
}

async function insertFlatWorkout(
  db: SqlDb,
  args: {
    id: string;
    userId: string;
    dayId: string;
    startedAt: string;
    completed: boolean;
    exerciseIds: string[];
  },
) {
  await insertWorkout(db, args);
  for (const exerciseId of args.exerciseIds) {
    for (let setIndex = 0; setIndex < 3; setIndex += 1) {
      await insertSet(db, {
        id: `${args.id}-${exerciseId}-${setIndex}`,
        workoutId: args.id,
        exerciseId,
        setIndex,
      });
    }
  }
}

describe('Coach adaptation signal', () => {
  it('recommends a deload only when two distinct lifts stall in the current week', () => {
    const dates = ['2026-07-28', '2026-08-01', '2026-08-05'];
    const signal = analyze({
      slots: [slot('bench-a', 'bb_bench'), slot('bench-b', 'bb_bench'), slot('row', 'bb_row')],
      history: [...flatHistory('bb_bench', dates), ...flatHistory('bb_row', dates)],
    });
    expect(signal.stalled.map((item) => item.exerciseName)).toEqual(['Bench Press', 'Barbell Row']);
    expect(signal.deload).toMatchObject({ deload: true, reason: 'two_plus_stalls_same_week' });
    expect(signal.reasonLabel).toContain('2 lifts');
  });

  it('does not keep an old unresolved stall as a new weekly trigger', () => {
    const signal = analyze({
      slots: [slot('bench', 'bb_bench'), slot('row', 'bb_row')],
      history: [
        ...flatHistory('bb_bench', ['2026-07-21', '2026-07-23', '2026-07-25']),
        ...flatHistory('bb_row', ['2026-07-21', '2026-07-23', '2026-07-25']),
      ],
    });
    expect(signal.stalled).toEqual([]);
    expect(signal.deload.deload).toBe(false);
  });

  it('uses observed low-readiness days and suppresses a repeated scheduled deload', () => {
    const lowRecovery = analyze({ slots: [], history: [], readinessLog: ['red', 'green', 'red', 'red'] });
    expect(lowRecovery.deload).toMatchObject({ deload: true, reason: 'readiness_red_3plus' });
    expect(lowRecovery.recentReadiness).toMatchObject({ observedDays: 4, redDays: 3 });

    expect(analyze({ slots: [], history: [], week: 7 }).deload).toMatchObject({
      deload: true,
      reason: 'scheduled_week_7',
    });
    expect(analyze({ slots: [], history: [], week: 7, already: true }).deload.deload).toBe(false);
  });

  it('retains the observed signal but suppresses repeated acute deloads for seven days', () => {
    const dates = ['2026-07-28', '2026-08-01', '2026-08-05'];
    const stalled = analyze({
      slots: [slot('bench', 'bb_bench'), slot('row', 'bb_row')],
      history: [...flatHistory('bb_bench', dates), ...flatHistory('bb_row', dates)],
      recentDeload: true,
    });
    expect(stalled.stalled).toHaveLength(2);
    expect(stalled.deload).toEqual({ deload: false, reason: 'none' });
    expect(stalled.reasonLabel).toBeNull();

    const readiness = analyze({
      slots: [],
      history: [],
      readinessLog: ['red', 'red', 'green', 'red'],
      recentDeload: true,
    });
    expect(readiness.recentReadiness).toMatchObject({ observedDays: 4, redDays: 3 });
    expect(readiness.deload).toEqual({ deload: false, reason: 'none' });
    expect(analyze({
      slots: [],
      history: [],
      readinessLog: ['red', 'red', 'red'],
      recentDeload: false,
    }).deload).toMatchObject({ deload: true, reason: 'readiness_red_3plus' });
  });

  it('maps UTC instants to the injected device calendar day near midnight', () => {
    expect(coachDeviceDateKey('2026-08-02T19:10:00.000Z', -330)).toBe('2026-08-03');
    expect(coachDeviceDateKey('2026-08-03T07:10:00.000Z', 480)).toBe('2026-08-02');
  });

  it('requires an explicit production rollout flag while remaining available locally', () => {
    expect(adaptiveDeloadEnabled('development', undefined)).toBe(true);
    expect(adaptiveDeloadEnabled('test', undefined)).toBe(true);
    expect(adaptiveDeloadEnabled('production', undefined)).toBe(false);
    expect(adaptiveDeloadEnabled('production', '0')).toBe(false);
    expect(adaptiveDeloadEnabled('production', '1')).toBe(true);
  });

  it('uses only completed workouts from the current Program and applies device-day week boundaries', async () => {
    const db = openNodeDb();
    await migrate(db);
    const userId = 'scoped-history-user';
    const currentProgramId = 'current-program';
    const currentDayId = 'current-day';
    const priorProgramId = 'prior-program';
    const priorDayId = 'prior-day';
    const slots = [slot('current-bench', 'bb_bench'), slot('current-row', 'bb_row')];
    await seedProgram(db, { userId, programId: currentProgramId, dayId: currentDayId, slots });
    await seedProgram(db, {
      userId,
      programId: priorProgramId,
      dayId: priorDayId,
      status: 'archived',
    });

    const timestamps = [
      '2026-07-28T19:10:00.000Z',
      '2026-07-30T19:10:00.000Z',
      // UTC Sunday, but Monday on an IST device.
      '2026-08-02T19:10:00.000Z',
    ];
    for (const [index, startedAt] of timestamps.entries()) {
      await insertFlatWorkout(db, {
        id: `prior-${index}`,
        userId,
        dayId: priorDayId,
        startedAt,
        completed: true,
        exerciseIds: ['bb_bench', 'bb_row'],
      });
      await insertFlatWorkout(db, {
        id: `incomplete-${index}`,
        userId,
        dayId: currentDayId,
        startedAt,
        completed: false,
        exerciseIds: ['bb_bench', 'bb_row'],
      });
    }

    const ignored = await buildCoachAdaptationSignal(db, userId, {
      programId: currentProgramId,
      week: 3,
      now: new Date('2026-08-03T02:00:00.000Z'),
      timezoneOffsetMinutes: -330,
    });
    expect(ignored.stalled).toEqual([]);
    expect(ignored.deload.deload).toBe(false);
    const archived = await buildCoachAdaptationSignal(db, userId, {
      programId: priorProgramId,
      week: 7,
      now: new Date('2026-08-03T02:00:00.000Z'),
      timezoneOffsetMinutes: -330,
    });
    expect(archived).toMatchObject({
      stalled: [],
      recentReadiness: { observedDays: 0, redDays: 0 },
      deload: { deload: false, reason: 'none' },
    });

    for (const [index, startedAt] of timestamps.entries()) {
      await insertFlatWorkout(db, {
        id: `current-${index}`,
        userId,
        dayId: currentDayId,
        startedAt,
        completed: true,
        exerciseIds: ['bb_bench', 'bb_row'],
      });
    }
    const current = await buildCoachAdaptationSignal(db, userId, {
      programId: currentProgramId,
      week: 3,
      now: new Date('2026-08-03T02:00:00.000Z'),
      timezoneOffsetMinutes: -330,
    });
    expect(current.stalled.map((item) => item.exerciseName)).toEqual(['Bench Press', 'Barbell Row']);
    expect(current.deload).toMatchObject({ deload: true, reason: 'two_plus_stalls_same_week' });
    db.close();
  });

  it('does not let completed deload sets create a new stall signal', async () => {
    const db = openNodeDb();
    await migrate(db);
    const userId = 'deload-history-user';
    const programId = 'deload-history-program';
    const dayId = 'deload-history-day';
    await seedProgram(db, {
      userId,
      programId,
      dayId,
      slots: [slot('bench', 'bb_bench'), slot('row', 'bb_row')],
    });
    const timestamps = [
      '2026-07-28T10:00:00.000Z',
      '2026-08-01T10:00:00.000Z',
      '2026-08-05T10:00:00.000Z',
    ];
    for (const [index, startedAt] of timestamps.entries()) {
      const workoutId = `deload-history-${index}`;
      await insertFlatWorkout(db, {
        id: workoutId,
        userId,
        dayId,
        startedAt,
        completed: true,
        exerciseIds: ['bb_bench', 'bb_row'],
      });
      await db.runAsync(
        `insert into workout_training_intents (id, intent, updated_at, deleted_at)
         values (?, 'coach_deload', ?, null)`,
        workoutId,
        startedAt,
      );
    }
    const args = {
      programId,
      week: 3,
      now: new Date('2026-08-05T12:00:00.000Z'),
      timezoneOffsetMinutes: 0,
    };
    expect((await buildCoachAdaptationSignal(db, userId, args)).stalled).toEqual([]);

    await db.runAsync(
      `update workout_training_intents
          set deleted_at = '2026-08-05T13:00:00.000Z',
              updated_at = '2026-08-05T13:00:00.000Z'`,
    );
    expect((await buildCoachAdaptationSignal(db, userId, args)).stalled).toHaveLength(2);
    db.close();
  });

  it('counts only a deload with completed working sets and cools acute signals for seven days', async () => {
    const db = openNodeDb();
    await migrate(db);
    const userId = 'completed-deload-user';
    const programId = 'deload-program';
    const dayId = 'deload-day';
    const workoutId = 'marked-deload';
    await seedProgram(db, { userId, programId, dayId });
    const endedAt = await insertWorkout(db, {
      id: workoutId,
      userId,
      dayId,
      startedAt: '2026-08-08T10:00:00.000Z',
      completed: true,
    });
    await db.runAsync(
      `insert into workout_training_intents (id, intent, updated_at, deleted_at)
       values (?, 'coach_deload', ?, null)`,
      workoutId,
      endedAt,
    );
    const args = {
      programId,
      week: 7,
      now: new Date('2026-08-09T12:00:00.000Z'),
      timezoneOffsetMinutes: 0,
    };

    expect((await buildCoachAdaptationSignal(db, userId, args)).deload).toMatchObject({
      deload: true,
      reason: 'scheduled_week_7',
    });
    await insertSet(db, {
      id: 'warmup-only',
      workoutId,
      exerciseId: 'bb_bench',
      setIndex: -1,
      isWarmup: true,
    });
    expect((await buildCoachAdaptationSignal(db, userId, args)).deload.deload).toBe(true);
    await insertSet(db, {
      id: 'completed-work',
      workoutId,
      exerciseId: 'bb_bench',
      setIndex: 0,
    });
    expect((await buildCoachAdaptationSignal(db, userId, args)).deload.deload).toBe(false);

    await db.runAsync(
      'update workout_training_intents set deleted_at = ?, updated_at = ? where id = ?',
      endedAt,
      endedAt,
      workoutId,
    );
    expect((await buildCoachAdaptationSignal(db, userId, args)).deload).toMatchObject({
      deload: true,
      reason: 'scheduled_week_7',
    });
    await db.runAsync(
      'update workout_training_intents set deleted_at = null, updated_at = ? where id = ?',
      endedAt,
      workoutId,
    );

    for (const [index, day] of ['07', '08', '09'].entries()) {
      await insertWorkout(db, {
        id: `red-readiness-${index}`,
        userId,
        dayId,
        startedAt: `2026-08-${day}T08:00:00.000Z`,
        completed: true,
        readinessScore: 50,
      });
    }
    const acuteArgs = { ...args, week: 3 };
    const fallbackOnly = await buildCoachAdaptationSignal(db, userId, acuteArgs);
    expect(fallbackOnly.recentReadiness).toMatchObject({ observedDays: 0, redDays: 0 });
    expect(fallbackOnly.deload).toEqual({ deload: false, reason: 'none' });

    for (const [index, day] of ['07', '08', '09'].entries()) {
      const date = `2026-08-${day}`;
      await db.runAsync(
        `insert into subjective_tags (
           id, user_id, workout_id, date, energy, mood, sleep_quality, soreness,
           updated_at, deleted_at
         ) values (?, ?, null, ?, 1, 1, 1, 5, ?, null)`,
        `low-check-in-${index}`,
        userId,
        date,
        `${date}T08:00:00.000Z`,
      );
      await db.runAsync(
        `insert into health_samples (
           id, user_id, source, type, date, value, external_id, updated_at, deleted_at
         ) values (?, ?, 'test', 'sleep', ?, ?, ?, ?, null)`,
        `low-sleep-${index}`,
        userId,
        date,
        JSON.stringify({ minutes: 300 }),
        `low-sleep-${index}`,
        `${date}T08:00:00.000Z`,
      );
    }
    const cooled = await buildCoachAdaptationSignal(db, userId, acuteArgs);
    expect(cooled.recentReadiness).toMatchObject({ observedDays: 3, redDays: 3 });
    expect(cooled.deload).toEqual({ deload: false, reason: 'none' });

    await db.runAsync(
      `update workouts
          set started_at = '2026-07-31T10:00:00.000Z', ended_at = '2026-07-31T11:00:00.000Z'
        where id = ?`,
      workoutId,
    );
    expect((await buildCoachAdaptationSignal(db, userId, acuteArgs)).deload).toMatchObject({
      deload: true,
      reason: 'readiness_red_3plus',
    });
    db.close();
  });
});
