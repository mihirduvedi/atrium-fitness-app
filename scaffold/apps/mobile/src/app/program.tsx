import { archetypeById, type Readiness, type SessionPlan } from '@atrium/engine';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, LayoutAnimation, PanResponder, Pressable, Text, Vibration, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useApp } from '@/AppContext';
import { Button, Card, ConsistencyMeter, Eyebrow, ScreenScroll } from '@/components/ui';
import {
  getProgramOverview,
  previewProgramDay,
  reorderProgramSlots,
  type ProgramDayOverview,
  type ProgramOverview,
  type ProgramSlotOverview,
} from '@/db/queries';
import { getReadinessSignal, type ReadinessSignal } from '@/health/readiness';
import { borderWidth, radius, space, useTheme } from '@/theme';
import { formatWorkoutDayName } from '@/workoutNames';

interface ProgramScreenData {
  overview: ProgramOverview | null;
  readiness: ReadinessSignal | null;
  basePlan: SessionPlan | null;
  adjustedPlan: SessionPlan | null;
}

const emptyData: ProgramScreenData = {
  overview: null,
  readiness: null,
  basePlan: null,
  adjustedPlan: null,
};

const READINESS_LABEL: Record<Readiness, string> = {
  green: 'Ready',
  yellow: 'Worn',
  red: 'Rough',
};

const REORDER_ROW_HEIGHT = 58;

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

function animateReorderLayout() {
  LayoutAnimation.configureNext({
    duration: 140,
    update: { type: LayoutAnimation.Types.easeInEaseOut },
    create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  });
}

function titleCase(value: string) {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function shortDate(iso: string | null) {
  if (!iso) return 'Not logged';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function schemeLabel(slot: ProgramSlotOverview) {
  if (slot.scheme.top && slot.scheme.backoff) {
    return `${slot.scheme.top.sets} top + ${slot.scheme.backoff.sets} back-off`;
  }
  if (slot.scheme.duration_min) return `${slot.scheme.duration_min} min`;
  if (slot.scheme.sets && slot.scheme.reps) {
    const [lo, hi] = slot.scheme.reps;
    return lo === hi ? `${slot.scheme.sets} x ${lo}` : `${slot.scheme.sets} x ${lo}-${hi}`;
  }
  return titleCase(slot.rule);
}

function setCount(plan: SessionPlan | null) {
  return plan?.prescriptions.reduce((sum, p) => sum + p.sets.filter((s) => !s.isWarmup).length, 0) ?? 0;
}

function impactLine(readiness: ReadinessSignal | null, basePlan: SessionPlan | null, adjustedPlan: SessionPlan | null) {
  if (!readiness || !basePlan || !adjustedPlan) return 'Recovery preview is waiting on your next session.';
  const delta = setCount(basePlan) - setCount(adjustedPlan);
  if (readiness.readiness === 'green') return 'Health data keeps the next session at full planned work.';
  if (delta > 0) return `Health data trims ${delta} set${delta === 1 ? '' : 's'} from the next session preview.`;
  return 'Health data lowers the session target without adding extra work.';
}

function formatPrescription(p: SessionPlan['prescriptions'][number]) {
  const workSets = p.sets.filter((s) => !s.isWarmup);
  const first = workSets[0];
  if (!first) return 'No sets';
  if (first.targetSeconds !== undefined) return `${workSets.length} x ${first.targetSeconds}s`;
  const [lo, hi] = first.targetReps;
  return lo === hi ? `${workSets.length} x ${lo}` : `${workSets.length} x ${lo}-${hi}`;
}

function Metric({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View
      style={{
        flex: 1,
        minHeight: 74,
        borderRadius: radius.card,
        borderWidth: borderWidth.hairline,
        borderColor: t.colors.borderHairline,
        backgroundColor: t.colors.bgSurface,
        paddingHorizontal: space[3],
        paddingVertical: space[3],
        justifyContent: 'space-between',
      }}
    >
      <Text numberOfLines={1} adjustsFontSizeToFit style={t.text('heroNumL')}>
        {value}
      </Text>
      <Text numberOfLines={1} style={t.text('labelCaps', 'textMuted')}>
        {label}
      </Text>
    </View>
  );
}

function MiniPill({ label, active }: { label: string; active?: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{
        borderRadius: radius.control,
        backgroundColor: active ? t.colors.actionInk : t.colors.bgSurface2,
        paddingHorizontal: 9,
        paddingVertical: 5,
      }}
    >
      <Text style={[t.text('labelCaps', active ? 'actionOnInk' : 'textMuted'), { fontSize: 8.5 }]}>
        {label}
      </Text>
    </View>
  );
}

function BackChevron() {
  const t = useTheme();
  return (
    <Svg width={19} height={19} viewBox="0 0 20 20">
      <Path
        d="M12.25 4.75 7 10l5.25 5.25"
        fill="none"
        stroke={t.colors.textMuted}
        strokeWidth={2.15}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function TodayBackButton() {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back to Today"
      hitSlop={8}
      onPress={() => router.replace('/(tabs)/today')}
      style={({ pressed }) => ({
        minHeight: 34,
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 2,
        marginLeft: -5,
        opacity: pressed ? 0.58 : 1,
      })}
    >
      <BackChevron />
      <Text style={[t.text('bodyM', 'textMuted'), { fontSize: 14.5, fontWeight: '500' }]}>Today</Text>
    </Pressable>
  );
}

function ReorderHandle({ dragging }: { dragging: boolean }) {
  const t = useTheme();

  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel="Reorder movement"
      accessibilityHint="Drag up or down to reorder."
      style={{
        width: 54,
        height: 54,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        borderRadius: radius.control,
        backgroundColor: dragging ? t.colors.bgSurface2 : 'transparent',
      }}
    >
      {[0, 1, 2].map((line) => (
        <View key={line} style={{ width: 18, height: 2, borderRadius: 1, backgroundColor: t.colors.textFaint }} />
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

function ExerciseSlotRow({
  slot,
  dayId,
  index,
  last,
  onDragStart,
  onDragMove,
  onDragEnd,
  draggingPreview,
  shiftY,
}: {
  slot: ProgramSlotOverview;
  dayId: string;
  index: number;
  last: boolean;
  onDragStart: (dayId: string, slotId: string, index: number) => void;
  onDragMove: (dayId: string, slotId: string, deltaY: number) => void;
  onDragEnd: (dayId: string, slotId: string, deltaY: number | null) => void;
  draggingPreview: boolean;
  shiftY: number;
}) {
  const t = useTheme();
  const dayIdRef = useRef(dayId);
  const slotIdRef = useRef(slot.slotId);
  const indexRef = useRef(index);
  const dragStartIndex = useRef<number | null>(null);
  const lastDragDeltaY = useRef(0);
  const onDragStartRef = useRef(onDragStart);
  const onDragMoveRef = useRef(onDragMove);
  const onDragEndRef = useRef(onDragEnd);
  const panResponder = useRef<ReturnType<typeof PanResponder.create> | null>(null);
  const [dragging, setDragging] = useState(false);
  const rowDragging = dragging || draggingPreview;
  const animatedShiftY = useRef(new Animated.Value(0)).current;

  dayIdRef.current = dayId;
  slotIdRef.current = slot.slotId;
  indexRef.current = index;
  onDragStartRef.current = onDragStart;
  onDragMoveRef.current = onDragMove;
  onDragEndRef.current = onDragEnd;

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
    if (dragStartIndex.current !== null) return;
    dragStartIndex.current = indexRef.current;
    lastDragDeltaY.current = 0;
    setDragging(true);
    onDragStartRef.current(dayIdRef.current, slotIdRef.current, indexRef.current);
  };

  const updateDrag = (deltaY: number) => {
    if (dragStartIndex.current === null) startDrag();
    lastDragDeltaY.current = deltaY;
    onDragMoveRef.current(dayIdRef.current, slotIdRef.current, deltaY);
  };

  const finishDrag = (deltaY: number | null) => {
    dragStartIndex.current = null;
    lastDragDeltaY.current = 0;
    setDragging(false);
    onDragEndRef.current(dayIdRef.current, slotIdRef.current, deltaY);
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
      <Pressable
        disabled={disabled}
        onPress={() => router.push({ pathname: '/exercise/[id]', params: { id: slot.exerciseId } })}
        style={({ pressed }) => ({
          flex: 1,
          minWidth: 0,
          opacity: pressed ? 0.62 : 1,
        })}
      >
        <Text numberOfLines={1} style={t.text('bodyM')}>
          {slot.exerciseName}
        </Text>
        <Text numberOfLines={1} style={t.text('bodyS', 'textMuted')}>
          {titleCase(slot.pattern)} - {titleCase(slot.rule)}
        </Text>
      </Pressable>
      <Text numberOfLines={1} adjustsFontSizeToFit style={t.text('dataS', 'textFaint')}>
        {schemeLabel(slot)}
      </Text>
      {handle}
    </>
  );

  return (
    <Animated.View
      style={{
        minHeight: REORDER_ROW_HEIGHT,
        position: 'relative',
        zIndex: 0,
        borderRadius: radius.card,
        backgroundColor: 'transparent',
        transform: [{ translateY: animatedShiftY }],
      }}
    >
      <View
        style={{
          minHeight: REORDER_ROW_HEIGHT,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space[3],
          borderBottomWidth: last ? 0 : borderWidth.hairline,
          borderBottomColor: t.colors.borderHairline,
          opacity: rowDragging ? 0 : 1,
        }}
      >
        {renderRowBody(
          <View {...panResponder.current.panHandlers}>
            <ReorderHandle dragging={rowDragging} />
          </View>,
          rowDragging,
        )}
      </View>
    </Animated.View>
  );
}

function ProgramFloatingRow({
  slot,
  top,
}: {
  slot: ProgramSlotOverview;
  top: number;
}) {
  const t = useTheme();
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top,
        minHeight: REORDER_ROW_HEIGHT,
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
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={t.text('bodyM')}>
          {slot.exerciseName}
        </Text>
        <Text numberOfLines={1} style={t.text('bodyS', 'textMuted')}>
          {titleCase(slot.pattern)} - {titleCase(slot.rule)}
        </Text>
      </View>
      <Text numberOfLines={1} adjustsFontSizeToFit style={t.text('dataS', 'textFaint')}>
        {schemeLabel(slot)}
      </Text>
      <ReorderHandle dragging />
    </View>
  );
}

function ProgramDayBlock({
  day,
  nextDayId,
  dropLineIndex,
  dragVisual,
  onDragStart,
  onDragMove,
  onDragEnd,
  onEdit,
}: {
  day: ProgramDayOverview;
  nextDayId?: string;
  dropLineIndex: number | null;
  dragVisual: { slotId: string; startIndex: number; targetIndex: number; deltaY: number } | null;
  onDragStart: (dayId: string, slotId: string, index: number) => void;
  onDragMove: (dayId: string, slotId: string, deltaY: number) => void;
  onDragEnd: (dayId: string, slotId: string, deltaY: number | null) => void;
  onEdit: (dayId: string) => void;
}) {
  const t = useTheme();
  const isNext = day.dayId === nextDayId;
  const floatingSlot = dragVisual ? day.slots.find((slot) => slot.slotId === dragVisual.slotId) : null;
  return (
    <View
      style={{
        paddingTop: space[3],
        borderTopWidth: day.dayIndex === 0 ? 0 : borderWidth.hairline,
        borderTopColor: t.colors.borderHairline,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3], marginBottom: 4 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
            <Text numberOfLines={1} style={t.text('displayS')}>
              Day {day.dayIndex + 1}
            </Text>
            {isNext && <MiniPill label="Next" active />}
          </View>
          <Text numberOfLines={1} style={t.text('bodyS', 'textMuted')}>
            {formatWorkoutDayName(day.name)} - last {shortDate(day.lastCompletedAt)}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 3 }}>
          <Text style={t.text('dataS', 'textMuted')}>{day.completedWorkouts} done</Text>
          <Pressable onPress={() => onEdit(day.dayId)} hitSlop={8}>
            <Text style={t.text('bodyS', 'textMuted')}>Edit</Text>
          </Pressable>
        </View>
      </View>
      <View style={{ position: 'relative' }}>
        <InsertionMarker index={dropLineIndex} rowHeight={REORDER_ROW_HEIGHT} left={0} right={0} />
        {day.slots.map((slot, index) => (
          <ExerciseSlotRow
            key={slot.slotId}
            slot={slot}
            dayId={day.dayId}
            index={index}
            last={index === day.slots.length - 1}
            onDragStart={onDragStart}
            onDragMove={onDragMove}
            onDragEnd={onDragEnd}
            draggingPreview={dragVisual?.slotId === slot.slotId}
            shiftY={dragVisual ? shiftedRowOffset(index, dragVisual.startIndex, dragVisual.targetIndex, REORDER_ROW_HEIGHT) : 0}
          />
        ))}
        {dragVisual && floatingSlot && (
          <ProgramFloatingRow
            slot={floatingSlot}
            top={dragVisual.startIndex * REORDER_ROW_HEIGHT + dragVisual.deltaY}
          />
        )}
      </View>
    </View>
  );
}

export default function ProgramScreen() {
  const t = useTheme();
  const { db, userId, newId, sync } = useApp();
  const [data, setData] = useState<ProgramScreenData>(emptyData);
  const dataRef = useRef<ProgramScreenData>(emptyData);
  const [programDragging, setProgramDragging] = useState(false);
  const [programDropLine, setProgramDropLine] = useState<{ dayId: string; index: number } | null>(null);
  const [programDragVisual, setProgramDragVisual] = useState<{ dayId: string; slotId: string; startIndex: number; targetIndex: number; deltaY: number } | null>(null);
  const lastProgramDropLine = useRef<string | null>(null);
  const programDragStart = useRef<{ dayId: string; slotId: string; index: number } | null>(null);

  const loadProgramData = useCallback(async () => {
    const [overview, readiness] = await Promise.all([
      getProgramOverview(db, userId),
      getReadinessSignal(db, userId),
    ]);
    let basePlan: SessionPlan | null = null;
    let adjustedPlan: SessionPlan | null = null;
    if (overview?.nextDay) {
      [basePlan, adjustedPlan] = await Promise.all([
        previewProgramDay(db, userId, overview.nextDay, 'green'),
        previewProgramDay(db, userId, overview.nextDay, readiness.readiness),
      ]);
    }
    const nextData = { overview, readiness, basePlan, adjustedPlan };
    dataRef.current = nextData;
    setData(nextData);
  }, [db, userId]);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      loadProgramData().catch(() => {
        if (live) setData(emptyData);
      });
      return () => {
        live = false;
      };
    }, [loadProgramData]),
  );

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const moveProgramSlotLocal = (dayId: string, from: number, to: number) => {
    const currentData = dataRef.current;
    const overview = currentData.overview;
    if (!overview) return null;
    const day = overview.days.find((item) => item.dayId === dayId);
    if (!day || from === to) return null;
    const target = Math.max(0, Math.min(to, day.slots.length - 1));
    if (from === target) return null;
    const nextDays = overview.days.map((item) => {
      if (item.dayId !== dayId) return item;
      const slots = [...item.slots];
      const [moved] = slots.splice(from, 1);
      if (!moved) return item;
      slots.splice(target, 0, moved);
      return { ...item, slots: slots.map((slot, index) => ({ ...slot, slotIndex: index })) };
    });
    const ordered = nextDays.find((item) => item.dayId === dayId)?.slots.map((slot) => slot.slotId) ?? [];
    const nextData = { ...currentData, overview: { ...overview, days: nextDays } };
    dataRef.current = nextData;
    animateReorderLayout();
    setData(nextData);
    return ordered;
  };

  const persistProgramSlotOrder = (dayId: string) => {
    const ordered = dataRef.current.overview?.days.find((item) => item.dayId === dayId)?.slots.map((slot) => slot.slotId) ?? [];
    if (ordered.length === 0) return;
    reorderProgramSlots(db, dayId, ordered, newId)
      .then(() => {
        sync?.sync().catch(() => {});
        return loadProgramData();
      })
      .catch(() => {});
  };

  const updateProgramDropLine = (dayId: string, index: number | null) => {
    const key = index === null ? null : `${dayId}:${index}`;
    if (lastProgramDropLine.current === key) return;
    lastProgramDropLine.current = key;
    setProgramDropLine(index === null ? null : { dayId, index });
    if (index !== null) Vibration.vibrate(8);
  };

  const applyProgramDrag = (dayId: string, slotId: string, deltaY: number, showDropLine: boolean) => {
    const day = dataRef.current.overview?.days.find((item) => item.dayId === dayId);
    if (!day) return;
    const currentIndex = day.slots.findIndex((slot) => slot.slotId === slotId);
    if (currentIndex < 0) return;
    const dragStart = programDragStart.current;
    if (dragStart?.dayId !== dayId || dragStart.slotId !== slotId) return;
    const startIndex = dragStart.index;
    const target = targetIndexForDrag(startIndex, deltaY, day.slots.length, REORDER_ROW_HEIGHT);
    setProgramDragVisual((current) => (
      current?.dayId === dayId && current.slotId === slotId ? { ...current, targetIndex: target, deltaY } : current
    ));
    if (showDropLine) updateProgramDropLine(dayId, insertionIndexForTarget(startIndex, target));
  };

  const beginProgramDrag = (dayId: string, slotId: string, index: number) => {
    programDragStart.current = { dayId, slotId, index };
    lastProgramDropLine.current = null;
    setProgramDropLine(null);
    setProgramDragVisual({ dayId, slotId, startIndex: index, targetIndex: index, deltaY: 0 });
    setProgramDragging(true);
  };

  const previewProgramDrag = (dayId: string, slotId: string, deltaY: number) => {
    applyProgramDrag(dayId, slotId, deltaY, true);
  };

  const endProgramDrag = (dayId: string, slotId: string, deltaY: number | null) => {
    const dragStart = programDragStart.current;
    if (deltaY !== null && dragStart?.dayId === dayId && dragStart.slotId === slotId) {
      const day = dataRef.current.overview?.days.find((item) => item.dayId === dayId);
      const target = day ? targetIndexForDrag(dragStart.index, deltaY, day.slots.length, REORDER_ROW_HEIGHT) : dragStart.index;
      if (target !== dragStart.index) {
        const ordered = moveProgramSlotLocal(dayId, dragStart.index, target);
        if (ordered) persistProgramSlotOrder(dayId);
      }
    }
    programDragStart.current = null;
    setProgramDragVisual(null);
    updateProgramDropLine(dayId, null);
    setProgramDragging(false);
  };

  const archetypeName = useMemo(() => {
    const id = data.overview?.program.archetype_id;
    return id ? archetypeById.get(id)?.name ?? titleCase(id) : 'Training plan';
  }, [data.overview?.program.archetype_id]);

  const nextPreviewRows = data.adjustedPlan?.prescriptions.slice(0, 4) ?? [];
  const remaining = Math.max(0, (data.overview?.daysPerWeek ?? 0) - (data.overview?.completedThisWeek ?? 0));

  if (!data.overview) {
    return (
      <ScreenScroll scrollEnabled={!programDragging}>
        <TodayBackButton />
        <Card>
          <Eyebrow>Program</Eyebrow>
          <Text style={t.text('displayS')}>No active program yet.</Text>
          <Text style={[t.text('bodyM', 'textMuted'), { marginTop: space[2], marginBottom: space[4] }]}>
            Set up your first plan to see the week map.
          </Text>
          <Button title="Set up plan" onPress={() => router.replace('/onboarding')} />
        </Card>
      </ScreenScroll>
    );
  }

  return (
    <ScreenScroll scrollEnabled={!programDragging}>
      <TodayBackButton />

      <View style={{ paddingTop: space[1], paddingBottom: space[2] }}>
        <Eyebrow>Program</Eyebrow>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[3] }}>
          <Text style={[t.text('screenTitle'), { flex: 1, minWidth: 0 }]}>{archetypeName}</Text>
          <Pressable
            onPress={() => router.push('/program-library')}
            style={({ pressed }) => ({
              minWidth: 74,
              height: 34,
              borderRadius: radius.control,
              borderWidth: borderWidth.hairline,
              borderColor: t.colors.borderStrong,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.62 : 1,
            })}
          >
            <Text style={t.text('bodyS', 'textMuted')}>Library</Text>
          </Pressable>
        </View>
        <Text style={[t.text('bodyM', 'textMuted'), { marginTop: space[2] }]}>
          Week {data.overview.week} - {data.overview.daysPerWeek} training days - {data.overview.totalCompletedWorkouts} completed
        </Text>
      </View>

      <View style={{ flexDirection: 'row', gap: space[3] }}>
        <Metric label="This week" value={`${data.overview.completedThisWeek}/${data.overview.daysPerWeek}`} />
        <Metric label="Remaining" value={String(remaining)} />
        <Metric label="Readiness" value={String(data.readiness?.score ?? '--')} />
      </View>

      <Card>
        <Eyebrow>Week status</Eyebrow>
        <Text style={t.text('displayS')}>
          {data.overview.nextDay ? formatWorkoutDayName(data.overview.nextDay.name) : 'Program complete'}
        </Text>
        <Text style={[t.text('bodyS', 'textMuted'), { marginTop: space[1] }]}>
          {data.readiness ? `${data.readiness.title}: ${impactLine(data.readiness, data.basePlan, data.adjustedPlan)}` : impactLine(null, null, null)}
        </Text>
        <ConsistencyMeter total={data.overview.daysPerWeek} done={data.overview.completedThisWeek} />
      </Card>

      {data.overview.nextDay && data.adjustedPlan && (
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space[3], alignItems: 'flex-start' }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Eyebrow>{`Up next - ${READINESS_LABEL[data.readiness?.readiness ?? 'green']}`}</Eyebrow>
              <Text numberOfLines={1} adjustsFontSizeToFit style={t.text('displayM')}>
                {formatWorkoutDayName(data.adjustedPlan.name)}
              </Text>
            </View>
            <MiniPill label={`${setCount(data.adjustedPlan)} sets`} />
          </View>

          <View style={{ marginTop: space[3], borderTopWidth: borderWidth.hairline, borderTopColor: t.colors.borderHairline }}>
            {nextPreviewRows.map((p) => (
              <View
                key={p.slotId}
                style={{
                  minHeight: 44,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: space[3],
                  borderBottomWidth: borderWidth.hairline,
                  borderBottomColor: t.colors.borderHairline,
                }}
              >
                <Text numberOfLines={1} style={[t.text('bodyM'), { flex: 1, minWidth: 0 }]}>
                  {data.overview!.days
                    .flatMap((day) => day.slots)
                    .find((slot) => slot.slotId === p.slotId)?.exerciseName ?? p.exerciseId}
                </Text>
                <Text numberOfLines={1} style={t.text('dataS', 'textFaint')}>
                  {formatPrescription(p)}
                </Text>
              </View>
            ))}
          </View>

          <View style={{ flexDirection: 'row', gap: space[3], marginTop: space[4] }}>
            <Button
              title="Start workout"
              onPress={() => router.push({ pathname: '/workout', params: { readiness: data.readiness?.readiness ?? 'green' } })}
              style={{ flex: 1 }}
            />
            <Button
              title="Add"
              ghost
              onPress={() => router.push({ pathname: '/library', params: { mode: 'add', programDayId: data.overview!.nextDay!.dayId, returnTo: 'program' } })}
              style={{ width: 86 }}
            />
          </View>
        </Card>
      )}

      <Card>
        <Eyebrow>Training days</Eyebrow>
        {data.overview.days.map((day) => (
          <ProgramDayBlock
            key={day.dayId}
            day={day}
            nextDayId={data.overview?.nextDay?.dayId}
            dropLineIndex={programDropLine?.dayId === day.dayId ? programDropLine.index : null}
            dragVisual={programDragVisual?.dayId === day.dayId ? programDragVisual : null}
            onDragStart={beginProgramDrag}
            onDragMove={previewProgramDrag}
            onDragEnd={endProgramDrag}
            onEdit={(dayId) => router.push({ pathname: '/program-library', params: { programDayId: dayId } })}
          />
        ))}
      </Card>
    </ScreenScroll>
  );
}
