import { exerciseCatalog, type Pattern, type Readiness, type RuleId, type SessionPlan } from '@atrium/engine';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Animated, LayoutAnimation, PanResponder, Pressable, Text, TextInput, Vibration, View } from 'react-native';
import { useApp } from '@/AppContext';
import { Button, Card, Eyebrow, ScreenCenter, ScreenScroll } from '@/components/ui';
import {
  discardEmptyInProgressWorkouts,
  discardWorkout,
  finishWorkout,
  getActiveProgram,
  getInProgressWorkoutOverview,
  getNextProgramDay,
  getProgramDayContext,
  getPreviousSession,
  getWorkoutDraft,
  getWorkoutOverview,
  listExercises,
  logSet,
  planSession,
  saveWorkoutDraft,
  startWorkout,
  type InProgressWorkoutOverview,
  type NextDay,
  type WorkoutDraftData,
  unlogSet,
} from '@/db/queries';
import { borderWidth, radius, space, useTheme } from '@/theme';
import { sanitizeDecimalInput, sanitizeWholeNumberInput } from '@/numericInput';
import { getReadinessSignal } from '@/health/readiness';
import {
  completedWorkoutQueuePrefixLength,
  constrainWorkoutQueueTarget,
  isWorkoutQueuePrescriptionDone,
  moveWorkoutQueuePrescription,
  normalizeWorkoutQueue,
  postponeActiveWorkoutQueuePrescription,
  workoutQueueFinishedKey,
} from '@/workoutQueue';
import { displayWorkoutName } from '@/workoutNames';
import { runWorkoutBoot } from '@/workoutBoot';
import { restSecondsAfterLoggedSet } from '@/workoutRest';

interface SetUiState {
  weight: string;
  reps: string;
  done: boolean;
}

interface Ghost {
  weight: number | null;
  reps: number | null;
}

const fmtClock = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

function formatSets(p: SessionPlan['prescriptions'][number]): string {
  const workSets = p.sets.filter((set) => !set.isWarmup);
  const first = workSets[0];
  if (!first) return '';
  if (first.targetSeconds !== undefined) return `${workSets.length} × ${first.targetSeconds}s`;
  return first.targetReps[0] === first.targetReps[1]
    ? `${workSets.length} × ${first.targetReps[0]}`
    : `${workSets.length} × ${first.targetReps[0]}-${first.targetReps[1]}`;
}

const TIMELINE_ROW_HEIGHT = 62;

const COMPOUND_PATTERNS = new Set<string>(['squat', 'hinge', 'hpress', 'vpress', 'hpull', 'vpull', 'lunge', 'carry']);

function defaultRule(pattern: string, equipment: string): RuleId {
  return equipment === 'bodyweight' ? 'rep_progression' : 'double_progression';
}

function defaultRest(pattern: string) {
  return COMPOUND_PATTERNS.has(pattern) ? 150 : 90;
}

function targetIndexForDrag(from: number, deltaY: number, total: number, rowHeight: number) {
  if (Math.abs(deltaY) < 8) return from;
  const offset = Math.round(deltaY / rowHeight);
  return Math.max(0, Math.min(from + offset, total - 1));
}

function insertionIndexForTarget(from: number, target: number) {
  if (from === target) return null;
  return target > from ? target + 1 : target;
}

function shiftedRowOffset(index: number, startIndex: number, targetIndex: number, rowHeight: number) {
  if (targetIndex > startIndex && index > startIndex && index <= targetIndex) return -rowHeight;
  if (targetIndex < startIndex && index >= targetIndex && index < startIndex) return rowHeight;
  return 0;
}

function initialSetUiForPlan(plan: SessionPlan): Record<string, SetUiState> {
  const ui: Record<string, SetUiState> = {};
  for (const prescription of plan.prescriptions) {
    for (const set of prescription.sets) {
      ui[`${prescription.slotId}:${set.setIndex}`] = {
        weight: set.weight !== undefined ? String(set.weight) : '',
        reps: String(set.targetSeconds ?? set.targetReps[1]),
        done: false,
      };
    }
  }
  return ui;
}

function animateReorderLayout() {
  LayoutAnimation.configureNext({
    duration: 140,
    update: { type: LayoutAnimation.Types.easeInEaseOut },
    create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  });
}

function DragHandle({ dragging, disabled = false }: { dragging: boolean; disabled?: boolean }) {
  const t = useTheme();

  return (
    <View
      accessibilityLabel={disabled ? 'Completed movement locked in place' : 'Reorder movement'}
      accessibilityRole="adjustable"
      accessibilityHint={disabled ? 'Completed movements cannot be reordered.' : 'Drag up or down to reorder.'}
      accessibilityState={{ disabled }}
      style={{
        width: 54,
        height: 54,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        borderRadius: radius.control,
        backgroundColor: dragging ? t.colors.bgSurface2 : 'transparent',
        opacity: disabled ? 0.3 : 1,
      }}
    >
      {[0, 1, 2].map((line) => (
        <View
          key={line}
          style={{
            width: 18,
            height: 2,
            borderRadius: 1,
            backgroundColor: t.colors.textFaint,
          }}
        />
      ))}
    </View>
  );
}

function InsertionMarker({
  index,
  rowHeight,
  left,
  right,
}: {
  index: number | null;
  rowHeight: number;
  left: number;
  right: number;
}) {
  const t = useTheme();
  const translateY = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (index === null) {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 80,
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.parallel([
      Animated.spring(translateY, {
        toValue: index * rowHeight,
        stiffness: 320,
        damping: 28,
        mass: 0.55,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 60,
        useNativeDriver: true,
      }),
    ]).start();
  }, [index, opacity, rowHeight, translateY]);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        zIndex: 30,
        left,
        right,
        top: -2,
        height: 5,
        borderRadius: 3,
        backgroundColor: t.colors.dataBlue,
        opacity,
        shadowColor: '#000',
        shadowOpacity: 0.16,
        shadowRadius: 5,
        shadowOffset: { width: 0, height: 2 },
        transform: [{ translateY }],
      }}
    />
  );
}

function TimelineRow({
  prescription,
  index,
  total,
  active,
  done,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  exerciseName,
  draggingPreview,
  reorderDisabled,
  shiftY,
}: {
  prescription: SessionPlan['prescriptions'][number];
  index: number;
  total: number;
  active: boolean;
  done: boolean;
  onSelect: () => void;
  onDragStart: (slotId: string, index: number) => void;
  onDragMove: (slotId: string, deltaY: number) => void;
  onDragEnd: (slotId: string, deltaY: number | null) => void;
  exerciseName: string;
  draggingPreview: boolean;
  reorderDisabled: boolean;
  shiftY: number;
}) {
  const t = useTheme();
  const status = done ? 'Done' : active ? 'Now' : 'Queued';
  const slotIdRef = useRef(prescription.slotId);
  const indexRef = useRef(index);
  const dragStartIndex = useRef<number | null>(null);
  const lastDragDeltaY = useRef(0);
  const onDragStartRef = useRef(onDragStart);
  const onDragMoveRef = useRef(onDragMove);
  const onDragEndRef = useRef(onDragEnd);
  const reorderDisabledRef = useRef(reorderDisabled);
  const panResponder = useRef<ReturnType<typeof PanResponder.create> | null>(null);
  const [dragging, setDragging] = useState(false);
  const rowDragging = dragging || draggingPreview;
  const animatedShiftY = useRef(new Animated.Value(0)).current;

  slotIdRef.current = prescription.slotId;
  indexRef.current = index;
  onDragStartRef.current = onDragStart;
  onDragMoveRef.current = onDragMove;
  onDragEndRef.current = onDragEnd;
  reorderDisabledRef.current = reorderDisabled;

  useEffect(() => {
    Animated.spring(animatedShiftY, {
      toValue: shiftY,
      stiffness: 420,
      damping: 34,
      mass: 0.65,
      useNativeDriver: true,
    }).start();
  }, [animatedShiftY, shiftY]);

  const startDrag = () => {
    if (reorderDisabledRef.current) return;
    if (dragStartIndex.current !== null) return;
    dragStartIndex.current = indexRef.current;
    lastDragDeltaY.current = 0;
    setDragging(true);
    onDragStartRef.current(slotIdRef.current, indexRef.current);
  };

  const updateDrag = (deltaY: number) => {
    if (reorderDisabledRef.current) return;
    if (dragStartIndex.current === null) startDrag();
    lastDragDeltaY.current = deltaY;
    onDragMoveRef.current(slotIdRef.current, deltaY);
  };

  const finishDrag = (deltaY: number | null) => {
    dragStartIndex.current = null;
    lastDragDeltaY.current = 0;
    setDragging(false);
    onDragEndRef.current(slotIdRef.current, deltaY);
  };

  if (!panResponder.current) {
    panResponder.current = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: (_event, gestureState) => Math.abs(gestureState.dy) > 2,
      onMoveShouldSetPanResponderCapture: (_event, gestureState) => Math.abs(gestureState.dy) > 2,
      onPanResponderGrant: startDrag,
      onPanResponderMove: (_event, gestureState) => updateDrag(gestureState.dy),
      onPanResponderRelease: (_event, gestureState) => {
        const finalDeltaY = Math.abs(gestureState.dy) >= Math.abs(lastDragDeltaY.current) ? gestureState.dy : lastDragDeltaY.current;
        finishDrag(Math.abs(finalDeltaY) < 8 ? null : finalDeltaY);
      },
      onPanResponderTerminate: () => finishDrag(null),
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
    });
  }

  const renderRowBody = (handle: ReactNode, disabled = false) => (
    <>
      <View style={{ width: 20, alignItems: 'center', alignSelf: 'stretch' }}>
        <View
          style={{
            flex: 1,
            width: 1,
            backgroundColor: index === 0 ? 'transparent' : t.colors.borderHairline,
          }}
        />
        <View
          style={{
            width: active && !done ? 13 : 9,
            height: active && !done ? 13 : 9,
            borderRadius: active && !done ? 7 : 5,
            backgroundColor: done ? t.colors.dataBlue : active ? t.colors.actionInk : t.colors.bgSurface2,
            borderWidth: active || done ? 0 : borderWidth.hairline,
            borderColor: t.colors.borderStrong,
          }}
        />
        <View
          style={{
            flex: 1,
            width: 1,
            backgroundColor: index === total - 1 ? 'transparent' : t.colors.borderHairline,
          }}
        />
      </View>

      <Pressable
        disabled={disabled}
        onPress={onSelect}
        style={({ pressed }) => ({
          flex: 1,
          minWidth: 0,
          paddingVertical: 8,
          opacity: pressed ? 0.72 : 1,
        })}
      >
        <Text style={t.text('bodyM')} numberOfLines={1}>
          {exerciseName}
        </Text>
        <Text style={[t.text('dataS', active ? 'textPrimary' : 'textMuted'), { marginTop: 3 }]}>
          {status} · {formatSets(prescription)}
        </Text>
      </Pressable>

      {handle}
    </>
  );

  return (
    <Animated.View
      style={{
        minHeight: TIMELINE_ROW_HEIGHT,
        position: 'relative',
        zIndex: 0,
        borderRadius: radius.card,
        backgroundColor: 'transparent',
        transform: [{ translateY: animatedShiftY }],
      }}
    >
      <View
        style={{
          minHeight: TIMELINE_ROW_HEIGHT,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space[3],
          opacity: rowDragging ? 0 : 1,
        }}
      >
        {renderRowBody(
          reorderDisabled ? (
            <DragHandle dragging={false} disabled />
          ) : (
            <View {...panResponder.current.panHandlers}>
              <DragHandle dragging={rowDragging} />
            </View>
          ),
          rowDragging,
        )}
      </View>
    </Animated.View>
  );
}

function TimelineFloatingRow({
  prescription,
  active,
  done,
  exerciseName,
  top,
}: {
  prescription: SessionPlan['prescriptions'][number];
  active: boolean;
  done: boolean;
  exerciseName: string;
  top: number;
}) {
  const t = useTheme();
  const status = done ? 'Done' : active ? 'Now' : 'Queued';
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top,
        minHeight: TIMELINE_ROW_HEIGHT,
        zIndex: 80,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        borderRadius: radius.card,
        backgroundColor: t.colors.bgSurface,
        shadowColor: '#000',
        shadowOpacity: 0.16,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
      }}
    >
      <View style={{ width: 20, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' }}>
        <View
          style={{
            width: active && !done ? 13 : 9,
            height: active && !done ? 13 : 9,
            borderRadius: active && !done ? 7 : 5,
            backgroundColor: done ? t.colors.dataBlue : active ? t.colors.actionInk : t.colors.bgSurface2,
            borderWidth: active || done ? 0 : borderWidth.hairline,
            borderColor: t.colors.borderStrong,
          }}
        />
      </View>
      <View style={{ flex: 1, minWidth: 0, paddingVertical: 8 }}>
        <Text style={t.text('bodyM')} numberOfLines={1}>
          {exerciseName}
        </Text>
        <Text style={[t.text('dataS', active ? 'textPrimary' : 'textMuted'), { marginTop: 3 }]}>
          {status} · {formatSets(prescription)}
        </Text>
      </View>
      <DragHandle dragging />
    </View>
  );
}

export default function WorkoutScreen() {
  const t = useTheme();
  const { db, userId, newId, sync, pendingWorkoutMovement, clearPendingWorkoutMovement } = useApp();
  const params = useLocalSearchParams<{ readiness?: string; workoutId?: string }>();

  const [day, setDay] = useState<NextDay | null>(null);
  const [plan, setPlan] = useState<SessionPlan | null>(null);
  const planRef = useRef<SessionPlan | null>(null);
  const [workoutId, setWorkoutId] = useState<string | null>(null);
  const [workoutStartedAt, setWorkoutStartedAt] = useState<string | null>(null);
  const [workoutCustomName, setWorkoutCustomName] = useState<string | null>(null);
  const [ghosts, setGhosts] = useState<Record<string, Ghost[]>>({});
  const [exerciseNames, setExerciseNames] = useState<Record<string, string>>({});
  const [setUi, setSetUi] = useState<Record<string, SetUiState>>({});
  const [activeIndex, setActiveIndex] = useState(0);
  const [bootAttempt, setBootAttempt] = useState(0);
  const [bootError, setBootError] = useState<string | null>(null);
  const activeIndexRef = useRef(0);
  const draftReady = useRef(false);
  const [timelineDragging, setTimelineDragging] = useState(false);
  const [timelineDropLineIndex, setTimelineDropLineIndex] = useState<number | null>(null);
  const [timelineDragVisual, setTimelineDragVisual] = useState<{ slotId: string; startIndex: number; targetIndex: number; deltaY: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [rest, setRest] = useState<number | null>(null);
  const restTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTimelineDropLine = useRef<number | null>(null);
  const timelineDragStart = useRef<{ slotId: string; index: number } | null>(null);

  // boot: resume an unfinished draft first; otherwise plan a fresh session.
  useEffect(() => {
    let live = true;
    const routeReadiness: Readiness | null = params.readiness === 'green'
      || params.readiness === 'yellow'
      || params.readiness === 'red'
      ? params.readiness
      : null;
    draftReady.current = false;
    setBootError(null);

    const exerciseNameMap = (rows: Awaited<ReturnType<typeof listExercises>>) =>
      Object.fromEntries(rows.map((exercise) => [exercise.id, exercise.name]));

    const loadGhostMap = async (sessionPlan: SessionPlan, activeWorkoutId: string) => {
      const g: Record<string, Ghost[]> = {};
      for (const presc of sessionPlan.prescriptions) {
        g[presc.slotId] = await getPreviousSession(db, userId, presc.exerciseId, activeWorkoutId);
      }
      return g;
    };

    const applyDraft = async (draft: WorkoutDraftData, names: Record<string, string>) => {
      const normalizedQueue = normalizeWorkoutQueue(draft.plan.prescriptions, draft.setUi);
      const normalizedPlan = normalizedQueue.moved
        ? { ...draft.plan, prescriptions: normalizedQueue.prescriptions }
        : draft.plan;
      const g = await loadGhostMap(normalizedPlan, draft.workoutId);
      if (!live) return;
      setDay(draft.day);
      setPlan(normalizedPlan);
      planRef.current = normalizedPlan;
      setWorkoutId(draft.workoutId);
      setWorkoutStartedAt(draft.startedAt);
      setWorkoutCustomName(draft.customName);
      setGhosts(g);
      setExerciseNames(names);
      setSetUi(draft.setUi);
      setActiveIndex(normalizedQueue.activeIndex);
      activeIndexRef.current = normalizedQueue.activeIndex;
      setRest(draft.restRemainingS);
      draftReady.current = true;
    };

    const openExistingWorkout = async (existing: InProgressWorkoutOverview, names: Record<string, string>) => {
      if (live) {
        setWorkoutId(existing.workoutId);
        setWorkoutStartedAt(existing.startedAt);
        setWorkoutCustomName(existing.customName);
      }

      let draft: WorkoutDraftData | null = null;
      try {
        draft = await getWorkoutDraft(db, existing.workoutId);
      } catch {
        // Local-only drafts can be stale or malformed after an interrupted
        // upgrade. Treat that cache as absent and rebuild through the same
        // guarded Program/synced-intent path.
      }
      if (draft) {
        await applyDraft(draft, names);
        return;
      }

      const context = existing.programDayId ? await getProgramDayContext(db, existing.programDayId) : null;
      if (!context) {
        throw new Error('This active workout cannot be safely resumed without its Program day.');
      }
      const readiness = routeReadiness ?? (await getReadinessSignal(db, userId)).readiness;
      const sessionPlan = await planSession(db, userId, context, newId, readiness);
      const ui = initialSetUiForPlan(sessionPlan);
      await saveWorkoutDraft(db, {
        workoutId: existing.workoutId,
        userId,
        programDayId: context.dayId,
        day: context,
        plan: sessionPlan,
        setUi: ui,
        activeIndex: 0,
        restRemainingS: null,
      });
      const freshDraft = await getWorkoutDraft(db, existing.workoutId);
      if (!freshDraft) {
        throw new Error('This active workout cannot be safely resumed without a verified draft.');
      }
      await applyDraft(freshDraft, names);
    };

    void runWorkoutBoot(async () => {
      const exerciseRows = await listExercises(db, userId);
      const names = exerciseNameMap(exerciseRows);
      const requestedWorkoutId = typeof params.workoutId === 'string' ? params.workoutId : null;
      const requestedWorkout = requestedWorkoutId ? await getWorkoutOverview(db, requestedWorkoutId, userId) : null;
      const existingWorkout = requestedWorkout ?? await getInProgressWorkoutOverview(db, userId);
      if (existingWorkout) {
        await discardEmptyInProgressWorkouts(db, userId, newId, existingWorkout.workoutId);
        await openExistingWorkout(existingWorkout, names);
        return;
      }

      const program = await getActiveProgram(db, userId);
      if (!program) throw new Error('Atrium cannot safely prepare a workout without an active Program.');
      const next = await getNextProgramDay(db, program.id);
      if (!next) throw new Error('Atrium cannot safely prepare a workout without a next Program day.');
      const readinessSignal = await getReadinessSignal(db, userId);
      const readiness = routeReadiness ?? readinessSignal.readiness;
      const wid = await startWorkout(db, userId, next.dayId, newId, readinessSignal.score);
      if (live) setWorkoutId(wid);
      const overview = await getWorkoutOverview(db, wid, userId);
      if (!overview) throw new Error('Atrium could not verify the workout it just created.');
      if (overview.programDayId !== next.dayId) {
        await openExistingWorkout(overview, names);
        return;
      }
      const p = await planSession(db, userId, next, newId, readiness);
      const ui = initialSetUiForPlan(p);
      await saveWorkoutDraft(db, {
        workoutId: wid,
        userId,
        programDayId: next.dayId,
        day: next,
        plan: p,
        setUi: ui,
        activeIndex: 0,
        restRemainingS: null,
      });
      const g = await loadGhostMap(p, wid);
      if (!live) return;
      setDay(next);
      setPlan(p);
      planRef.current = p;
      setWorkoutId(wid);
      setWorkoutStartedAt(overview?.startedAt ?? new Date().toISOString());
      setWorkoutCustomName(overview?.customName ?? null);
      setGhosts(g);
      setExerciseNames(names);
      setSetUi(ui);
      setActiveIndex(0);
      activeIndexRef.current = 0;
      setRest(null);
      draftReady.current = true;
    }, (message) => {
      if (!live) return;
      draftReady.current = false;
      setBootError(message);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootAttempt]);

  useEffect(() => {
    planRef.current = plan;
  }, [plan]);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  // session clock
  useEffect(() => {
    if (!workoutStartedAt) return;
    const tick = () => {
      setElapsed(Math.max(0, Math.floor((Date.now() - Date.parse(workoutStartedAt)) / 1000)));
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [workoutStartedAt]);

  const restRunning = rest !== null;

  useEffect(() => {
    if (!restRunning) {
      if (restTimer.current) clearInterval(restTimer.current);
      restTimer.current = null;
      return;
    }
    if (restTimer.current) clearInterval(restTimer.current);
    restTimer.current = setInterval(() => {
      setRest((r) => {
        if (r === null || r <= 1) return null;
        return r - 1;
      });
    }, 1000);
    return () => {
      if (restTimer.current) clearInterval(restTimer.current);
      restTimer.current = null;
    };
  }, [restRunning]);

  useEffect(() => {
    if (!draftReady.current || !workoutId || !day || !plan) return;
    saveWorkoutDraft(db, {
      workoutId,
      userId,
      programDayId: day.dayId,
      day,
      plan,
      setUi,
      activeIndex,
      restRemainingS: rest,
      restSavedAt: rest === null ? null : new Date().toISOString(),
    }).catch(() => {});
  }, [activeIndex, day, db, plan, rest, setUi, userId, workoutId]);

  const startRest = (seconds: number) => {
    setRest(seconds > 0 ? seconds : null);
  };

  useEffect(() => {
    if (!pendingWorkoutMovement || !plan || !day || pendingWorkoutMovement.programDayId !== day.dayId) return;
    if (plan.prescriptions.some((prescription) => prescription.slotId === pendingWorkoutMovement.slotId)) {
      clearPendingWorkoutMovement(pendingWorkoutMovement.id);
      return;
    }
    const reps = Math.max(1, pendingWorkoutMovement.reps);
    const sets = Math.max(1, pendingWorkoutMovement.sets);
    const rule = defaultRule(pendingWorkoutMovement.pattern, pendingWorkoutMovement.equipment);
    const restS = defaultRest(pendingWorkoutMovement.pattern);
    const prescription: SessionPlan['prescriptions'][number] = {
      slotId: pendingWorkoutMovement.slotId,
      exerciseId: pendingWorkoutMovement.exerciseId,
      rule,
      rest_s: restS,
      sets: Array.from({ length: sets }, (_, index) => ({
        setIndex: index,
        targetReps: [reps, reps] as [number, number],
        kind: 'work' as const,
      })),
      nextState: {
        slotId: pendingWorkoutMovement.slotId,
        exerciseId: pendingWorkoutMovement.exerciseId,
        pattern: pendingWorkoutMovement.pattern as Pattern,
        rule,
        rest_s: restS,
        sets,
        reps: [reps, reps] as [number, number],
        stallCycles: 0,
      },
    };
    const nextPlan = { ...plan, prescriptions: [...plan.prescriptions, prescription] };
    planRef.current = nextPlan;
    setPlan(nextPlan);
    setGhosts((current) => ({ ...current, [pendingWorkoutMovement.slotId]: [] }));
    setExerciseNames((current) => ({ ...current, [pendingWorkoutMovement.exerciseId]: pendingWorkoutMovement.exerciseName }));
    setSetUi((current) => {
      const next = { ...current };
      for (const set of prescription.sets) {
        next[`${prescription.slotId}:${set.setIndex}`] = {
          weight: '',
          reps: String(set.targetReps[1]),
          done: false,
        };
      }
      return next;
    });
    clearPendingWorkoutMovement(pendingWorkoutMovement.id);
  }, [clearPendingWorkoutMovement, day, pendingWorkoutMovement, plan]);

  const isPrescriptionDone = (presc: SessionPlan['prescriptions'][number], uiState = setUi) =>
    isWorkoutQueuePrescriptionDone(presc, uiState);

  const advanceFrom = (index: number) => {
    setActiveIndex((current) => {
      if (current !== index) return current;
      return Math.min(index + 1, (plan?.prescriptions.length ?? 1) - 1);
    });
  };

  const skipMovement = () => {
    setRest(null);
    const currentPlan = planRef.current;
    if (!currentPlan) return;
    const nextQueue = postponeActiveWorkoutQueuePrescription(
      currentPlan.prescriptions,
      setUi,
      activeIndexRef.current,
    );
    if (!nextQueue.moved) return;
    const nextPlan = { ...currentPlan, prescriptions: nextQueue.prescriptions };
    planRef.current = nextPlan;
    activeIndexRef.current = nextQueue.activeIndex;
    animateReorderLayout();
    setPlan(nextPlan);
    setActiveIndex(nextQueue.activeIndex);
  };

  const finishExercise = () => {
    const currentPlan = planRef.current;
    const currentIndex = activeIndexRef.current;
    const current = currentPlan?.prescriptions[currentIndex];
    if (!currentPlan || !current || isPrescriptionDone(current)) return;

    const nextSetUi = {
      ...setUi,
      [workoutQueueFinishedKey(current.slotId)]: { weight: '', reps: '', done: true },
    };
    const hasNextExercise = currentIndex < currentPlan.prescriptions.length - 1;
    setSetUi(nextSetUi);
    if (hasNextExercise) {
      const nextIndex = currentIndex + 1;
      activeIndexRef.current = nextIndex;
      setActiveIndex(nextIndex);
    }
    setRest(null);
  };

  const movePrescription = (from: number, to: number) => {
    const currentPlan = planRef.current;
    if (!currentPlan || from === to) return;
    const currentActiveIndex = activeIndexRef.current;
    const nextQueue = moveWorkoutQueuePrescription(
      currentPlan.prescriptions,
      setUi,
      currentActiveIndex,
      from,
      to,
    );
    if (!nextQueue.moved) return;
    const currentActiveSlotId = currentPlan.prescriptions[currentActiveIndex]?.slotId;
    const nextActiveSlotId = nextQueue.prescriptions[nextQueue.activeIndex]?.slotId;
    const nextPlan = { ...currentPlan, prescriptions: nextQueue.prescriptions };
    planRef.current = nextPlan;
    activeIndexRef.current = nextQueue.activeIndex;
    animateReorderLayout();
    setPlan(nextPlan);
    setActiveIndex(nextQueue.activeIndex);
    if (currentActiveSlotId !== nextActiveSlotId) setRest(null);
  };

  const selectTimelinePrescription = (index: number) => {
    const currentPlan = planRef.current;
    const selectedPrescription = currentPlan?.prescriptions[index];
    if (!currentPlan || !selectedPrescription) return;
    setRest(null);
    if (isPrescriptionDone(selectedPrescription)) {
      setActiveIndex(index);
      activeIndexRef.current = index;
      return;
    }
    const queueStart = completedWorkoutQueuePrefixLength(currentPlan.prescriptions, setUi);
    if (index === queueStart) {
      setActiveIndex(queueStart);
      activeIndexRef.current = queueStart;
      return;
    }
    movePrescription(index, queueStart);
  };

  const updateTimelineDropLine = (index: number | null) => {
    if (lastTimelineDropLine.current === index) return;
    lastTimelineDropLine.current = index;
    setTimelineDropLineIndex(index);
    if (index !== null) Vibration.vibrate(8);
  };

  const applyTimelineDrag = (slotId: string, deltaY: number, showDropLine: boolean) => {
    const currentPlan = planRef.current;
    if (!currentPlan) return;
    const dragStart = timelineDragStart.current;
    if (dragStart?.slotId !== slotId) return;
    const startIndex = dragStart.index;
    const rawTarget = targetIndexForDrag(startIndex, deltaY, currentPlan.prescriptions.length, TIMELINE_ROW_HEIGHT);
    const target = constrainWorkoutQueueTarget(currentPlan.prescriptions, setUi, startIndex, rawTarget);
    setTimelineDragVisual((current) => (
      current?.slotId === slotId ? { ...current, targetIndex: target, deltaY } : current
    ));
    if (showDropLine) updateTimelineDropLine(insertionIndexForTarget(startIndex, target));
  };

  const beginTimelineDrag = (slotId: string, index: number) => {
    const prescription = planRef.current?.prescriptions[index];
    if (!prescription || isPrescriptionDone(prescription)) return;
    timelineDragStart.current = { slotId, index };
    lastTimelineDropLine.current = null;
    setTimelineDropLineIndex(null);
    setTimelineDragVisual({ slotId, startIndex: index, targetIndex: index, deltaY: 0 });
    setTimelineDragging(true);
  };

  const previewTimelineDrag = (slotId: string, deltaY: number) => {
    applyTimelineDrag(slotId, deltaY, true);
  };

  const endTimelineDrag = (slotId: string, deltaY: number | null) => {
    const currentPlan = planRef.current;
    const dragStart = timelineDragStart.current;
    if (deltaY !== null && currentPlan && dragStart?.slotId === slotId) {
      const target = targetIndexForDrag(dragStart.index, deltaY, currentPlan.prescriptions.length, TIMELINE_ROW_HEIGHT);
      if (target !== dragStart.index) movePrescription(dragStart.index, target);
    }
    timelineDragStart.current = null;
    setTimelineDragVisual(null);
    updateTimelineDropLine(null);
    setTimelineDragging(false);
  };

  // durable per-set toggle: checking writes immediately; unchecking tombstones the set row.
  const toggleSet = async (slotId: string, exerciseId: string, setIndex: number, rest_s: number, isWarmup?: boolean) => {
    if (!workoutId) return;
    const key = `${slotId}:${setIndex}`;
    const ui = setUi[key];
    if (!ui) return;

    if (ui.done) {
      await unlogSet(db, { workoutId, exerciseId, setIndex, isWarmup }, newId);
      setSetUi({ ...setUi, [key]: { ...ui, done: false } });
      sync?.sync().catch(() => {});
      return;
    }

    await logSet(db, {
      workoutId,
      exerciseId,
      setIndex,
      weight: ui.weight === '' ? null : Number(ui.weight),
      reps: ui.reps === '' ? null : Number(ui.reps),
      isWarmup,
    }, newId);
    const nextSetUi = { ...setUi, [key]: { ...ui, done: true } };
    const activeNow = plan?.prescriptions[activeIndex];
    const shouldAdvance = !!activeNow && activeNow.slotId === slotId && isPrescriptionDone(activeNow, nextSetUi);
    setSetUi(nextSetUi);
    const restSeconds = restSecondsAfterLoggedSet({
      exerciseDone: shouldAdvance,
      setRestSeconds: day?.setRestSeconds,
      fallbackSeconds: rest_s,
    });
    setRest(restSeconds && restSeconds > 0 ? restSeconds : null);
    sync?.sync().catch(() => {}); // opportunistic; offline just queues
    if (shouldAdvance) advanceFrom(activeIndex);
  };

  const completeWorkout = async () => {
    if (!workoutId) return;
    draftReady.current = false;
    await finishWorkout(db, workoutId, newId);
    await discardEmptyInProgressWorkouts(db, userId, newId);
    sync?.sync().catch(() => {});
    router.replace({ pathname: '/summary', params: { workoutId } });
  };

  const finish = () => {
    if (!workoutId) return;
    Alert.alert(
      'Finish workout?',
      'This will skip any unlogged sets and movements, then log this workout.',
      [
        { text: 'Keep training', style: 'cancel' },
        { text: 'Finish', onPress: () => void completeWorkout() },
      ],
    );
  };

  const pause = () => {
    router.dismissAll();
    router.replace('/(tabs)/today');
  };

  const discard = () => {
    if (!workoutId) return;
    Alert.alert(
      'Discard workout?',
      'This removes the in-progress workout and any sets logged in it.',
      [
        { text: 'Keep training', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: async () => {
            draftReady.current = false;
            await discardWorkout(db, workoutId, newId);
            sync?.sync().catch(() => {});
            router.dismissAll();
            router.replace('/(tabs)/today');
          },
        },
      ],
    );
  };

  const retryBoot = () => {
    setBootError(null);
    void (sync?.sync() ?? Promise.resolve())
      .catch(() => {})
      .finally(() => setBootAttempt((attempt) => attempt + 1));
  };

  if (bootError) {
    return (
      <ScreenCenter>
        <View style={{ width: '100%', gap: space[3] }}>
          <Card style={{ gap: space[2] }}>
            <Eyebrow coral>Workout paused</Eyebrow>
            <Text style={t.text('displayM')}>Couldn’t verify this workout</Text>
            <Text style={t.text('bodyM', 'textMuted')}>{bootError}</Text>
          </Card>
          <Button title="Sync & retry" onPress={retryBoot} />
          {workoutId && <Button title="Discard active workout" ghost onPress={discard} />}
          <Button title="Back to Today" ghost onPress={pause} />
        </View>
      </ScreenCenter>
    );
  }

  if (!plan || !day) {
    return (
      <ScreenCenter>
        <Text style={t.text('bodyM', 'textMuted')}>Planning session…</Text>
      </ScreenCenter>
    );
  }

  const active = plan.prescriptions[activeIndex] ?? plan.prescriptions[0];
  const activeExercise = active ? exerciseCatalog[active.exerciseId] : null;
  const activeDone = active ? isPrescriptionDone(active) : false;
  const activeExerciseName = active ? exerciseNames[active.exerciseId] ?? activeExercise?.name ?? active.exerciseId : '';
  const activeGhosts = active ? ghosts[active.slotId] ?? [] : [];
  const activeWarmups = active?.sets.filter((s) => s.isWarmup) ?? [];
  const hasTimedSets = active?.sets.some((s) => s.targetSeconds !== undefined);
  const activeGuide = activeGhosts.length > 0
    ? `Use today's targets and adjust the load if the warmups feel slower than last time.`
    : hasTimedSets
      ? 'Hold each set for the target time with clean form.'
      : active?.sets.some((s) => s.kind === 'top')
        ? 'Use these sets to find a challenging top-set weight with clean form.'
        : 'Choose a load you can complete for every target rep with clean form.';
  const setLabel = (set: SessionPlan['prescriptions'][number]['sets'][number]) => {
    if (set.isWarmup) return `W${activeWarmups.findIndex((x) => x.setIndex === set.setIndex) + 1}`;
    if (set.kind === 'top') return 'Top';
    return String(set.setIndex + 1);
  };
  const timelineFloatingPrescription = timelineDragVisual
    ? plan.prescriptions.find((prescription) => prescription.slotId === timelineDragVisual.slotId)
    : null;
  const workoutDisplayName = displayWorkoutName(workoutCustomName, day.name);

  return (
    <View style={{ flex: 1 }}>
      <ScreenScroll scrollEnabled={!timelineDragging}>
        <View style={{ paddingHorizontal: 2, paddingTop: space[2], paddingBottom: space[3], gap: 3 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space[3] }}>
            <Text style={[t.text('screenTitle'), { flex: 1, minWidth: 0 }]}>
              {workoutDisplayName}
            </Text>
            <View style={{ flexDirection: 'row', gap: space[2] }}>
              <Pressable
                onPress={discard}
                style={{
                  minWidth: 72,
                  height: 34,
                  borderRadius: radius.control,
                  borderWidth: borderWidth.hairline,
                  borderColor: t.colors.borderHairline,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={t.text('bodyS', 'textMuted')}>Discard</Text>
              </Pressable>
              <Pressable
                onPress={pause}
                style={{
                  minWidth: 62,
                  height: 34,
                  borderRadius: radius.control,
                  borderWidth: borderWidth.hairline,
                  borderColor: t.colors.borderHairline,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={t.text('bodyS', 'textMuted')}>Pause</Text>
              </Pressable>
              <Pressable
                onPress={finish}
                style={{
                  minWidth: 76,
                  height: 34,
                  borderRadius: radius.control,
                  borderWidth: borderWidth.hairline,
                  borderColor: t.colors.borderStrong,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={t.text('bodyS')}>Finish</Text>
              </Pressable>
            </View>
          </View>
          <Text style={t.text('dataS', 'textFaint')}>{fmtClock(elapsed)}</Text>
        </View>

        {active && (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[3] }}>
              <Pressable
                onPress={() => router.push({ pathname: '/exercise/[id]', params: { id: active.exerciseId } })}
                style={{ flex: 1, minWidth: 0 }}
              >
                <Text style={t.text('displayS')} numberOfLines={2}>
                  {activeExerciseName}
                </Text>
              </Pressable>
              {!activeDone && (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    gap: space[2],
                    transform: [{ translateY: -3 }],
                  }}
                >
                  {activeIndex < plan.prescriptions.length - 1 && (
                    <Pressable
                      onPress={skipMovement}
                      accessibilityRole="button"
                      accessibilityLabel="Skip exercise"
                      style={{
                        minWidth: 62,
                        height: 32,
                        borderRadius: radius.control,
                        borderWidth: borderWidth.hairline,
                        borderColor: t.colors.borderStrong,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text style={t.text('bodyS', 'textMuted')}>Skip</Text>
                    </Pressable>
                  )}
                  <Pressable
                    onPress={finishExercise}
                    accessibilityRole="button"
                    accessibilityLabel="Finish exercise"
                    style={{
                      minWidth: 112,
                      height: 32,
                      borderRadius: radius.control,
                      borderWidth: borderWidth.hairline,
                      borderColor: t.colors.borderStrong,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={t.text('bodyS')}>Finish Exercise</Text>
                  </Pressable>
                </View>
              )}
            </View>
            <Text style={[t.text('bodyS', 'textMuted'), { marginTop: 3, marginBottom: 13 }]}>
              {activeGuide}
            </Text>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], paddingBottom: 9 }}>
              {['Set', 'Prev', 'lb', active.sets[0]?.targetSeconds !== undefined ? 's' : 'Reps', ''].map((h, i) => (
                <Text
                  key={h + i}
                  style={[
                    t.text('labelCaps', 'textFaint'),
                    { width: i === 0 ? 34 : undefined, flex: i === 0 || i === 4 ? undefined : 1, textAlign: i > 0 ? 'center' : 'left' },
                    i === 4 && { width: 40 },
                  ]}
                >
                  {h}
                </Text>
              ))}
            </View>

            {active.sets.map((s) => {
              const key = `${active.slotId}:${s.setIndex}`;
              const ui = setUi[key]!;
              const ghost = activeGhosts[s.setIndex];
              return (
                <View
                  key={key}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space[2],
                    paddingVertical: space[2],
                    borderTopWidth: 1,
                    borderTopColor: t.colors.borderHairline,
                    opacity: ui.done ? 0.5 : 1,
                  }}
                >
                  <Text style={[t.text('dataS', 'textFaint'), { width: 34 }]}>
                    {setLabel(s)}
                  </Text>
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    style={[t.text('dataS', 'textFaint'), { flex: 1, minWidth: 0, textAlign: 'center' }]}
                  >
                    {ghost ? `${ghost.weight ?? '—'}×${ghost.reps ?? '—'}` : '—'}
                  </Text>
                  <TextInput
                    value={ui.weight}
                    editable={!ui.done && !activeDone}
                    keyboardType="decimal-pad"
                    onChangeText={(value) => setSetUi((prev) => ({
                      ...prev,
                      [key]: { ...prev[key]!, weight: sanitizeDecimalInput(value) },
                    }))}
                    style={[
                      t.text('dataM'),
                      { flex: 1, minWidth: 0, height: 36, textAlign: 'center', backgroundColor: t.colors.bgSurface2, borderRadius: radius.control },
                    ]}
                  />
                  <TextInput
                    value={ui.reps}
                    editable={!ui.done && !activeDone}
                    keyboardType="number-pad"
                    onChangeText={(value) => setSetUi((prev) => ({
                      ...prev,
                      [key]: { ...prev[key]!, reps: sanitizeWholeNumberInput(value) },
                    }))}
                    style={[
                      t.text('dataM'),
                      { flex: 1, minWidth: 0, height: 36, textAlign: 'center', backgroundColor: t.colors.bgSurface2, borderRadius: radius.control },
                    ]}
                  />
                  <Pressable
                    disabled={activeDone && !ui.done}
                    onPress={() => toggleSet(active.slotId, active.exerciseId, s.setIndex, active.rest_s, s.isWarmup)}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 16,
                      borderWidth: borderWidth.emphasis,
                      borderColor: ui.done ? t.colors.dataBlue : t.colors.borderStrong,
                      backgroundColor: ui.done ? t.colors.dataBlue : 'transparent',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ color: ui.done ? t.colors.actionOnInk : t.colors.textFaint, fontSize: 16 }}>✓</Text>
                  </Pressable>
                </View>
              );
            })}
          </Card>
        )}

        {plan.prescriptions.length > 1 && (
          <Card style={{ opacity: 0.9 }}>
            <Eyebrow>Workout timeline</Eyebrow>
            <View style={{ position: 'relative' }}>
              <InsertionMarker index={timelineDropLineIndex} rowHeight={TIMELINE_ROW_HEIGHT} left={0} right={0} />
              {plan.prescriptions.map((p, i) => (
                <TimelineRow
                  key={p.slotId}
                  prescription={p}
                  index={i}
                  total={plan.prescriptions.length}
                  active={i === activeIndex}
                  done={isPrescriptionDone(p)}
                  exerciseName={exerciseNames[p.exerciseId] ?? exerciseCatalog[p.exerciseId]?.name ?? p.exerciseId}
                  onDragStart={beginTimelineDrag}
                  onDragMove={previewTimelineDrag}
                  onDragEnd={endTimelineDrag}
                  onSelect={() => selectTimelinePrescription(i)}
                  draggingPreview={timelineDragVisual?.slotId === p.slotId}
                  reorderDisabled={isPrescriptionDone(p)}
                  shiftY={timelineDragVisual ? shiftedRowOffset(i, timelineDragVisual.startIndex, timelineDragVisual.targetIndex, TIMELINE_ROW_HEIGHT) : 0}
                />
              ))}
              {timelineDragVisual && timelineFloatingPrescription && (
                <TimelineFloatingRow
                  prescription={timelineFloatingPrescription}
                  active={timelineFloatingPrescription.slotId === active?.slotId}
                  done={isPrescriptionDone(timelineFloatingPrescription)}
                  exerciseName={exerciseNames[timelineFloatingPrescription.exerciseId] ?? exerciseCatalog[timelineFloatingPrescription.exerciseId]?.name ?? timelineFloatingPrescription.exerciseId}
                  top={timelineDragVisual.startIndex * TIMELINE_ROW_HEIGHT + timelineDragVisual.deltaY}
                />
              )}
            </View>
          </Card>
        )}

        <Card style={{ gap: space[3] }}>
          <Eyebrow>Movements</Eyebrow>
          <Text style={t.text('bodyM')}>Add a movement to this workout or save it into this program day.</Text>
          <Button
            title="Add movement"
            onPress={() => router.push({ pathname: '/library', params: { mode: 'add', programDayId: day.dayId, returnTo: 'workout' } })}
          />
        </Card>
      </ScreenScroll>

      {rest !== null && (
        <View
          style={{
            position: 'absolute',
            left: 20,
            right: 20,
            bottom: 128,
            backgroundColor: t.colors.bgSurface,
            borderColor: t.colors.borderStrong,
            borderWidth: borderWidth.hairline,
            borderRadius: radius.card,
            paddingVertical: 13,
            paddingHorizontal: 17,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            shadowColor: '#000',
            shadowOpacity: 0.25,
            shadowRadius: 34,
            shadowOffset: { width: 0, height: 16 },
            elevation: 8,
          }}
        >
          <View>
            <Text style={t.text('labelCaps', 'textMuted')}>Rest</Text>
            <Text style={t.text('heroNumXL')}>{fmtClock(rest)}</Text>
          </View>
          <Pressable onPress={() => setRest(null)}>
            <Text style={[t.text('bodyM', 'textMuted'), { textDecorationLine: 'underline' }]}>Skip</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
