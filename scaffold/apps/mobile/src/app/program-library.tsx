import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, LayoutAnimation, PanResponder, Pressable, Text, TextInput, Vibration, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { useApp } from '@/AppContext';
import { Button, Card, Eyebrow, ScreenScroll } from '@/components/ui';
import {
  createProgramDayTemplate,
  listProgramLibrary,
  removeMovementFromProgramDay,
  renameProgramDay,
  reorderProgramSlots,
  saveProgramDaySettings,
  setProgramDayActive,
  type ProgramCategory,
  type ProgramLibraryItem,
  type ProgramRepeatUnit,
  type ProgramSlotOverview,
} from '@/db/queries';
import { borderWidth, radius, space, useTheme } from '@/theme';
import { formatWorkoutDayName } from '@/workoutNames';

type EditorMode = 'list' | 'edit' | 'create';
type ScheduleMode = 'interval' | 'weekdays';

const CATEGORIES: { key: ProgramCategory | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'upper', label: 'Upper' },
  { key: 'lower', label: 'Lower' },
  { key: 'chest', label: 'Chest' },
  { key: 'back', label: 'Back' },
  { key: 'arms', label: 'Arms' },
  { key: 'free', label: 'Free' },
  { key: 'other', label: 'Other' },
];

const CATEGORY_CHOICES = CATEGORIES.filter((item): item is { key: ProgramCategory; label: string } => item.key !== 'all');
const WEEKDAYS = [
  { value: 1, short: 'Mon', tiny: 'M' },
  { value: 2, short: 'Tue', tiny: 'Tu' },
  { value: 3, short: 'Wed', tiny: 'W' },
  { value: 4, short: 'Thu', tiny: 'Th' },
  { value: 5, short: 'Fri', tiny: 'F' },
  { value: 6, short: 'Sat', tiny: 'Sa' },
  { value: 0, short: 'Sun', tiny: 'Su' },
];

const MOVEMENT_ROW_HEIGHT = 62;

function SearchIcon() {
  const t = useTheme();
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Circle cx={10.8} cy={10.8} r={6.4} fill="none" stroke={t.colors.textFaint} strokeWidth={1.9} />
      <Line x1={15.6} y1={15.6} x2={20} y2={20} stroke={t.colors.textFaint} strokeWidth={1.9} strokeLinecap="round" />
    </Svg>
  );
}

function labelForCategory(category: ProgramCategory) {
  return CATEGORY_CHOICES.find((item) => item.key === category)?.label ?? 'Other';
}

function plural(value: number, one: string) {
  return `${value} ${one}${value === 1 ? '' : 's'}`;
}

function weekdayLabel(value: number) {
  return WEEKDAYS.find((day) => day.value === value)?.short ?? '';
}

function scheduleLabel(item: Pick<ProgramLibraryItem, 'repeatEvery' | 'repeatUnit' | 'weekdays'>) {
  if (item.weekdays.length > 0) return `On ${item.weekdays.map(weekdayLabel).filter(Boolean).join(', ')}`;
  const unit = item.repeatUnit === 'day' ? 'day' : 'week';
  return `Every ${plural(item.repeatEvery, unit)}`;
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
  return 'Programmed';
}

function shortProgramName(name: string) {
  return formatWorkoutDayName(name)
    .replace('Upper Body', 'Upper')
    .replace('Lower Body', 'Lower')
    .replace(' - ', ' ');
}

function targetIndexForDrag(from: number, deltaY: number, total: number) {
  if (Math.abs(deltaY) < 8) return from;
  const offset = Math.round(deltaY / MOVEMENT_ROW_HEIGHT);
  return Math.max(0, Math.min(from + offset, total - 1));
}

function shiftedRowOffset(index: number, startIndex: number, targetIndex: number) {
  if (targetIndex > startIndex && index > startIndex && index <= targetIndex) return -MOVEMENT_ROW_HEIGHT;
  if (targetIndex < startIndex && index >= targetIndex && index < startIndex) return MOVEMENT_ROW_HEIGHT;
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

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 34,
        paddingHorizontal: 12,
        borderRadius: radius.control,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active ? t.colors.actionInk : t.colors.bgSurface,
        borderWidth: active ? 0 : borderWidth.hairline,
        borderColor: t.colors.borderHairline,
        opacity: pressed ? 0.66 : 1,
      })}
    >
      <Text style={t.text('bodyS', active ? 'actionOnInk' : 'textMuted')}>{label}</Text>
    </Pressable>
  );
}

function DayCircle({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active ? t.colors.actionInk : t.colors.bgSurface2,
        opacity: pressed ? 0.66 : 1,
      })}
    >
      <Text numberOfLines={1} adjustsFontSizeToFit style={[t.text('bodyS', active ? 'actionOnInk' : 'textMuted'), { fontSize: 11 }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function ActiveCheck({ active, onPress }: { active: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 32,
        height: 32,
        borderRadius: 16,
        borderWidth: borderWidth.emphasis,
        borderColor: active ? t.colors.dataBlue : t.colors.borderStrong,
        backgroundColor: active ? t.colors.dataBlue : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.66 : 1,
      })}
    >
      <Text style={{ color: active ? t.colors.actionOnInk : t.colors.textFaint, fontSize: 16 }}>✓</Text>
    </Pressable>
  );
}

function ReorderHandle({ dragging }: { dragging?: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{
        width: 42,
        height: 42,
        borderRadius: radius.control,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        backgroundColor: dragging ? t.colors.bgSurface2 : 'transparent',
      }}
    >
      {[0, 1, 2].map((line) => (
        <View key={line} style={{ width: 17, height: 2, borderRadius: 1, backgroundColor: t.colors.textFaint }} />
      ))}
    </View>
  );
}

function singleLineInputStyle(t: ReturnType<typeof useTheme>) {
  return [
    t.text('bodyM'),
    {
      height: 52,
      lineHeight: 18,
      borderRadius: radius.control,
      backgroundColor: t.colors.bgSurface2,
      paddingHorizontal: 13,
      paddingTop: 1,
      paddingBottom: 0,
      includeFontPadding: false,
      textAlignVertical: 'center' as const,
    },
  ];
}

function notesInputStyle(t: ReturnType<typeof useTheme>) {
  return [
    t.text('bodyM'),
    {
      minHeight: 84,
      borderRadius: radius.control,
      backgroundColor: t.colors.bgSurface2,
      paddingHorizontal: 13,
      paddingTop: 12,
      paddingBottom: 12,
      textAlignVertical: 'top' as const,
    },
  ];
}

function CalendarPreview({ items }: { items: ProgramLibraryItem[] }) {
  const t = useTheme();
  const active = items.filter((item) => item.active);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const programsForDay = (weekday: number) =>
    active.filter((item) => {
      const targets = item.weekdays.length > 0 ? item.weekdays : [WEEKDAYS[item.dayIndex % WEEKDAYS.length]!.value];
      return targets.includes(weekday);
    });
  const selected = selectedDay === null ? null : WEEKDAYS.find((day) => day.value === selectedDay) ?? null;
  const selectedPrograms = selected ? programsForDay(selected.value) : [];

  return (
    <Card style={{ gap: space[3] }}>
      <Eyebrow>Schedule preview</Eyebrow>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {WEEKDAYS.map((day) => {
          const programs = programsForDay(day.value);
          const selectedTile = selectedDay === day.value;
          return (
            <Pressable
              key={day.value}
              onPress={() => setSelectedDay((current) => current === day.value ? null : day.value)}
              style={{
                width: '31.2%',
                minHeight: 82,
                borderRadius: radius.control,
                backgroundColor: selectedTile ? t.colors.bgSurface : t.colors.bgSurface2,
                borderWidth: selectedTile ? borderWidth.emphasis : borderWidth.hairline,
                borderColor: selectedTile ? t.colors.dataBlue : programs.length ? t.colors.borderStrong : t.colors.borderHairline,
                paddingHorizontal: 10,
                paddingVertical: 9,
                gap: 6,
              }}
            >
              <Text style={[t.text('labelCaps', programs.length ? 'textPrimary' : 'textMuted'), { fontSize: 9.5, letterSpacing: 0 }]}>
                {day.short}
              </Text>
              <View
                style={{
                  gap: 4,
                }}
              >
                {programs.slice(0, 2).map((program) => (
                  <Text key={program.programDayId} numberOfLines={1} style={[t.text('bodyS', 'textMuted'), { fontSize: 10.5, lineHeight: 13 }]}>
                    {shortProgramName(program.name)}
                  </Text>
                ))}
                {programs.length > 2 && (
                  <Text style={[t.text('bodyS', 'textFaint'), { fontSize: 10.5, lineHeight: 13 }]}>+{programs.length - 2} more</Text>
                )}
                {programs.length === 0 && (
                  <Text style={[t.text('bodyS', 'textFaint'), { fontSize: 10.5, lineHeight: 13 }]}>Open</Text>
                )}
              </View>
            </Pressable>
          );
        })}
      </View>
      {selected && (
        <View
          style={{
            borderTopWidth: borderWidth.hairline,
            borderTopColor: t.colors.borderHairline,
            paddingTop: space[3],
            gap: 8,
          }}
        >
          <Text style={[t.text('labelCaps', 'textMuted'), { letterSpacing: 0 }]}>{selected.short}</Text>
          {selectedPrograms.length === 0 ? (
            <Text style={t.text('bodyS', 'textMuted')}>No active programs scheduled.</Text>
          ) : (
            selectedPrograms.map((program) => (
              <View key={program.programDayId} style={{ gap: 2 }}>
                <Text numberOfLines={2} style={t.text('bodyM')}>{formatWorkoutDayName(program.name)}</Text>
                <Text numberOfLines={1} style={t.text('bodyS', 'textMuted')}>
                  {labelForCategory(program.category)} · {plural(program.movements.length, 'movement')}
                </Text>
              </View>
            ))
          )}
        </View>
      )}
      {active.length === 0 && <Text style={t.text('bodyS', 'textMuted')}>No active programs selected.</Text>}
    </Card>
  );
}

function MovementRow({
  slot,
  index,
  last,
  draggingPreview,
  shiftY,
  onDragStart,
  onDragMove,
  onDragEnd,
  onRemove,
}: {
  slot: ProgramSlotOverview;
  index: number;
  last: boolean;
  draggingPreview: boolean;
  shiftY: number;
  onDragStart: (slotId: string, index: number) => void;
  onDragMove: (slotId: string, deltaY: number) => void;
  onDragEnd: (slotId: string, deltaY: number | null) => void;
  onRemove: () => void;
}) {
  const t = useTheme();
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => onDragStart(slot.slotId, index),
      onPanResponderMove: (_, gesture) => onDragMove(slot.slotId, gesture.dy),
      onPanResponderRelease: (_, gesture) => onDragEnd(slot.slotId, gesture.dy),
      onPanResponderTerminate: () => onDragEnd(slot.slotId, null),
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;

  return (
    <Animated.View
      style={{
        minHeight: MOVEMENT_ROW_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2],
        borderTopWidth: index === 0 ? 0 : borderWidth.hairline,
        borderBottomWidth: last ? borderWidth.hairline : 0,
        borderColor: t.colors.borderHairline,
        opacity: draggingPreview ? 0 : 1,
        transform: [{ translateY: shiftY }],
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={t.text('bodyM')}>{slot.exerciseName}</Text>
        <Text numberOfLines={1} style={t.text('bodyS', 'textMuted')}>{schemeLabel(slot)}</Text>
      </View>
      <Pressable onPress={onRemove} hitSlop={8} style={{ paddingHorizontal: 4, paddingVertical: 8 }}>
        <Text style={t.text('bodyS', 'dataCoral')}>Remove</Text>
      </Pressable>
      <View {...panResponder.panHandlers}>
        <ReorderHandle />
      </View>
    </Animated.View>
  );
}

function FloatingMovement({ slot, top }: { slot: ProgramSlotOverview; top: number }) {
  const t = useTheme();
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top,
        minHeight: MOVEMENT_ROW_HEIGHT,
        zIndex: 80,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2],
        borderRadius: radius.card,
        backgroundColor: t.colors.bgSurface,
        paddingHorizontal: 10,
        shadowColor: '#000',
        shadowOpacity: 0.14,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 8 },
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={t.text('bodyM')}>{slot.exerciseName}</Text>
        <Text numberOfLines={1} style={t.text('bodyS', 'textMuted')}>{schemeLabel(slot)}</Text>
      </View>
      <ReorderHandle dragging />
    </View>
  );
}

function DropLine({ index }: { index: number | null }) {
  const t = useTheme();
  if (index === null) return null;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: index * MOVEMENT_ROW_HEIGHT - 1,
        left: 0,
        right: 0,
        height: 2,
        borderRadius: 1,
        backgroundColor: t.colors.dataBlue,
        zIndex: 60,
      }}
    />
  );
}

export default function ProgramLibraryScreen() {
  const t = useTheme();
  const { db, userId, newId, sync } = useApp();
  const params = useLocalSearchParams<{ programDayId?: string }>();
  const consumedParam = useRef<string | null>(null);
  const dragStart = useRef<{ slotId: string; index: number } | null>(null);
  const lastDropLine = useRef<number | null>(null);

  const [items, setItems] = useState<ProgramLibraryItem[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ProgramCategory | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<EditorMode>('list');
  const [status, setStatus] = useState<string | null>(null);
  const [dropLineIndex, setDropLineIndex] = useState<number | null>(null);
  const [dragVisual, setDragVisual] = useState<{ slotId: string; startIndex: number; targetIndex: number; deltaY: number } | null>(null);

  const [draftName, setDraftName] = useState('');
  const [draftCategory, setDraftCategory] = useState<ProgramCategory>('other');
  const [draftNotes, setDraftNotes] = useState('');
  const [draftRepeatEvery, setDraftRepeatEvery] = useState('1');
  const [draftRepeatUnit, setDraftRepeatUnit] = useState<ProgramRepeatUnit>('week');
  const [draftWeekdays, setDraftWeekdays] = useState<number[]>([]);
  const [draftScheduleMode, setDraftScheduleMode] = useState<ScheduleMode>('interval');

  const load = useCallback(async () => {
    setItems(await listProgramLibrary(db, userId));
  }, [db, userId]);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      listProgramLibrary(db, userId)
        .then((next) => {
          if (live) setItems(next);
        })
        .catch(() => {
          if (live) setItems([]);
        });
      return () => {
        live = false;
      };
    }, [db, userId]),
  );

  const selected = items.find((item) => item.programDayId === selectedId) ?? null;

  const beginEdit = useCallback((item: ProgramLibraryItem) => {
    setMode('edit');
    setStatus(null);
    setSelectedId(item.programDayId);
    setDraftName(formatWorkoutDayName(item.name));
    setDraftCategory(item.category);
    setDraftNotes(item.notes ?? '');
    setDraftRepeatEvery(String(item.repeatEvery));
    setDraftRepeatUnit(item.repeatUnit);
    setDraftWeekdays(item.weekdays);
    setDraftScheduleMode(item.weekdays.length > 0 ? 'weekdays' : 'interval');
  }, []);

  useEffect(() => {
    const requested = Array.isArray(params.programDayId) ? params.programDayId[0] : params.programDayId;
    if (!requested || consumedParam.current === requested) return;
    const item = items.find((program) => program.programDayId === requested);
    if (!item) return;
    consumedParam.current = requested;
    beginEdit(item);
  }, [beginEdit, items, params.programDayId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      const haystack = [
        item.name,
        item.category,
        labelForCategory(item.category),
        item.notes ?? '',
        ...item.movements.map((movement) => movement.exerciseName),
      ].join(' ').toLowerCase();
      return (filter === 'all' || item.category === filter) && (!q || haystack.includes(q));
    });
  }, [filter, items, query]);

  const beginCreate = () => {
    setMode('create');
    setStatus(null);
    setSelectedId(null);
    setDraftName('');
    setDraftCategory('other');
    setDraftNotes('');
    setDraftRepeatEvery('1');
    setDraftRepeatUnit('week');
    setDraftWeekdays([]);
    setDraftScheduleMode('interval');
  };

  const closeEditor = () => {
    setMode('list');
    setSelectedId(null);
    setDropLineIndex(null);
    setDragVisual(null);
  };

  const selectScheduleMode = (nextMode: ScheduleMode) => {
    setDraftScheduleMode(nextMode);
    if (nextMode === 'interval') {
      setDraftWeekdays([]);
    } else {
      setDraftRepeatEvery('1');
      setDraftRepeatUnit('week');
    }
  };

  const toggleDay = (value: number) => {
    setDraftScheduleMode('weekdays');
    setDraftWeekdays((current) => (
      current.includes(value) ? current.filter((day) => day !== value) : [...current, value]
    ));
  };

  const toggleActive = async (item: ProgramLibraryItem) => {
    if (!item.active && item.movements.length === 0) {
      Alert.alert('Add movements first', 'A program needs at least one movement before it can be active.');
      return;
    }
    await setProgramDayActive(db, userId, item.programDayId, !item.active);
    await load();
  };

  const saveDraft = async () => {
    const name = draftName.trim();
    if (!name) return;
    const repeatEvery = Math.max(1, Math.min(7, Number.parseInt(draftRepeatEvery, 10) || 1));
    const weekdays = draftScheduleMode === 'weekdays' ? draftWeekdays : [];
    const repeatUnit = draftScheduleMode === 'weekdays' ? 'week' : draftRepeatUnit;

    if (mode === 'create') {
      const id = await createProgramDayTemplate(db, userId, {
        name,
        category: draftCategory,
        notes: draftNotes,
        repeatEvery: draftScheduleMode === 'weekdays' ? 1 : repeatEvery,
        repeatUnit,
        weekdays,
        active: false,
      }, newId);
      sync?.sync().catch(() => {});
      await load();
      setSelectedId(id);
      setMode('edit');
      setStatus('Program created. Add movements below.');
      return;
    }

    if (!selected) return;
    await renameProgramDay(db, selected.programDayId, name, newId);
    await saveProgramDaySettings(db, {
      userId,
      programDayId: selected.programDayId,
      category: draftCategory,
      notes: draftNotes,
      repeatEvery: draftScheduleMode === 'weekdays' ? 1 : repeatEvery,
      repeatUnit,
      weekdays,
    });
    sync?.sync().catch(() => {});
    await load();
    closeEditor();
    setStatus('Program saved.');
  };

  const removeMovement = (slot: ProgramSlotOverview) => {
    Alert.alert('Remove movement?', `${slot.exerciseName} will be removed from this program.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          removeMovementFromProgramDay(db, slot.slotId, newId)
            .then(() => {
              sync?.sync().catch(() => {});
              return load();
            })
            .catch(() => {});
        },
      },
    ]);
  };

  const openExerciseLibrary = () => {
    if (!selectedId) return;
    router.push({ pathname: '/library', params: { mode: 'add', programDayId: selectedId, returnTo: 'program-library' } });
  };

  const updateDropLine = (index: number | null) => {
    if (lastDropLine.current === index) return;
    lastDropLine.current = index;
    setDropLineIndex(index);
    if (index !== null) Vibration.vibrate(8);
  };

  const beginDrag = (slotId: string, index: number) => {
    dragStart.current = { slotId, index };
    lastDropLine.current = null;
    setDropLineIndex(null);
    setDragVisual({ slotId, startIndex: index, targetIndex: index, deltaY: 0 });
  };

  const moveDrag = (slotId: string, deltaY: number) => {
    const current = selected;
    const start = dragStart.current;
    if (!current || start?.slotId !== slotId) return;
    const target = targetIndexForDrag(start.index, deltaY, current.movements.length);
    setDragVisual((visual) => visual?.slotId === slotId ? { ...visual, targetIndex: target, deltaY } : visual);
    updateDropLine(target === start.index ? null : target > start.index ? target + 1 : target);
  };

  const moveMovementLocal = (from: number, to: number) => {
    const current = selected;
    if (!current || from === to) return null;
    const target = Math.max(0, Math.min(to, current.movements.length - 1));
    if (from === target) return null;
    const nextMovements = [...current.movements];
    const [moved] = nextMovements.splice(from, 1);
    if (!moved) return null;
    nextMovements.splice(target, 0, moved);
    const ordered = nextMovements.map((slot) => slot.slotId);
    setItems((currentItems) => currentItems.map((item) => (
      item.programDayId === current.programDayId
        ? { ...item, movements: nextMovements.map((slot, index) => ({ ...slot, slotIndex: index })) }
        : item
    )));
    animateReorderLayout();
    return ordered;
  };

  const endDrag = (slotId: string, deltaY: number | null) => {
    const current = selected;
    const start = dragStart.current;
    if (deltaY !== null && current && start?.slotId === slotId) {
      const target = targetIndexForDrag(start.index, deltaY, current.movements.length);
      const ordered = moveMovementLocal(start.index, target);
      if (ordered) {
        reorderProgramSlots(db, current.programDayId, ordered, newId)
          .then(() => {
            sync?.sync().catch(() => {});
            return load();
          })
          .catch(() => {});
      }
    }
    dragStart.current = null;
    setDragVisual(null);
    updateDropLine(null);
  };

  if (mode !== 'list') {
    const movements = selected?.movements ?? [];
    const floatingSlot = dragVisual ? movements.find((slot) => slot.slotId === dragVisual.slotId) : null;
    return (
      <ScreenScroll scrollEnabled={!dragVisual}>
        <View style={{ paddingHorizontal: 2, paddingTop: space[2], paddingBottom: space[2] }}>
          <Pressable onPress={closeEditor} hitSlop={10}>
            <Text style={t.text('bodyS', 'textMuted')}>‹ Program Library</Text>
          </Pressable>
          <View style={{ marginTop: space[5] }}>
            <Eyebrow>{mode === 'create' ? 'New program' : 'Edit program'}</Eyebrow>
            <Text style={t.text('screenTitle')}>{mode === 'create' ? 'New Program' : 'Edit Program'}</Text>
          </View>
        </View>

        {status && <Text style={[t.text('bodyM', 'textMuted'), { paddingHorizontal: 2 }]}>{status}</Text>}

        <Card style={{ gap: space[3] }}>
          <TextInput
            value={draftName}
            onChangeText={setDraftName}
            placeholder="Program name"
            placeholderTextColor={t.colors.textFaint}
            style={singleLineInputStyle(t)}
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            {CATEGORY_CHOICES.map((item) => (
              <Chip key={item.key} label={item.label} active={draftCategory === item.key} onPress={() => setDraftCategory(item.key)} />
            ))}
          </View>
          <TextInput
            value={draftNotes}
            onChangeText={setDraftNotes}
            placeholder="Notes"
            placeholderTextColor={t.colors.textFaint}
            multiline
            style={notesInputStyle(t)}
          />

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            <Chip label="Interval" active={draftScheduleMode === 'interval'} onPress={() => selectScheduleMode('interval')} />
            <Chip label="Specific days" active={draftScheduleMode === 'weekdays'} onPress={() => selectScheduleMode('weekdays')} />
          </View>

          {draftScheduleMode === 'interval' ? (
            <View style={{ flexDirection: 'row', gap: space[3], alignItems: 'center' }}>
              <Text style={[t.text('bodyM', 'textMuted'), { width: 92 }]}>Repeat every</Text>
              <TextInput
                value={draftRepeatEvery}
                onChangeText={setDraftRepeatEvery}
                keyboardType="number-pad"
                style={[...singleLineInputStyle(t), { width: 58, textAlign: 'center', paddingHorizontal: 0 }]}
              />
              <Chip label="Days" active={draftRepeatUnit === 'day'} onPress={() => setDraftRepeatUnit('day')} />
              <Chip label="Weeks" active={draftRepeatUnit === 'week'} onPress={() => setDraftRepeatUnit('week')} />
            </View>
          ) : (
            <View style={{ gap: space[2] }}>
              <Text style={t.text('bodyS', 'textMuted')}>Repeat on</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 5 }}>
                {WEEKDAYS.map((day) => (
                  <DayCircle key={day.value} label={day.tiny} active={draftWeekdays.includes(day.value)} onPress={() => toggleDay(day.value)} />
                ))}
              </View>
            </View>
          )}

          {mode === 'edit' && (
            <View style={{ borderTopWidth: borderWidth.hairline, borderTopColor: t.colors.borderHairline, paddingTop: space[3], gap: 2 }}>
              <Eyebrow>Movements</Eyebrow>
              {movements.length === 0 ? (
                <Text style={t.text('bodyM', 'textMuted')}>No movements yet.</Text>
              ) : (
                <View style={{ position: 'relative' }}>
                  <DropLine index={dropLineIndex} />
                  {movements.map((slot, index) => (
                    <MovementRow
                      key={slot.slotId}
                      slot={slot}
                      index={index}
                      last={index === movements.length - 1}
                      draggingPreview={dragVisual?.slotId === slot.slotId}
                      shiftY={dragVisual ? shiftedRowOffset(index, dragVisual.startIndex, dragVisual.targetIndex) : 0}
                      onDragStart={beginDrag}
                      onDragMove={moveDrag}
                      onDragEnd={endDrag}
                      onRemove={() => removeMovement(slot)}
                    />
                  ))}
                  {dragVisual && floatingSlot && (
                    <FloatingMovement slot={floatingSlot} top={dragVisual.startIndex * MOVEMENT_ROW_HEIGHT + dragVisual.deltaY} />
                  )}
                </View>
              )}
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: space[3] }}>
            {mode === 'edit' && <Button title="Add movement" ghost onPress={openExerciseLibrary} style={{ flex: 1 }} />}
            <Button title={mode === 'create' ? 'Create' : 'Save'} onPress={() => void saveDraft()} disabled={!draftName.trim()} style={{ flex: 1 }} />
          </View>
        </Card>
      </ScreenScroll>
    );
  }

  return (
    <ScreenScroll>
      <View style={{ paddingHorizontal: 2, paddingTop: space[2], paddingBottom: space[2] }}>
        <Pressable onPress={() => router.replace('/(tabs)/libraries')} hitSlop={10}>
          <Text style={t.text('bodyS', 'textMuted')}>‹ Libraries</Text>
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space[3], marginTop: space[5] }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Eyebrow>Current workout plan</Eyebrow>
            <Text style={t.text('screenTitle')}>Program Library</Text>
          </View>
          <Pressable
            onPress={beginCreate}
            style={({ pressed }) => ({
              width: 42,
              height: 42,
              borderRadius: 21,
              backgroundColor: t.colors.actionInk,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.66 : 1,
            })}
          >
            <Text style={t.text('heroNumL', 'actionOnInk')}>+</Text>
          </Pressable>
        </View>
      </View>

      {status && <Text style={[t.text('bodyM', 'textMuted'), { paddingHorizontal: 2 }]}>{status}</Text>}

      <CalendarPreview items={items} />

      <View
        style={{
          height: 52,
          borderRadius: radius.control,
          borderWidth: borderWidth.hairline,
          borderColor: t.colors.borderHairline,
          backgroundColor: t.colors.bgSurface,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space[2],
          paddingHorizontal: 13,
        }}
      >
        <SearchIcon />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search programs"
          placeholderTextColor={t.colors.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          style={[t.text('bodyM'), { flex: 1, height: 52, paddingVertical: 0, paddingTop: 0, paddingBottom: 2, includeFontPadding: false, textAlignVertical: 'center' }]}
        />
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
        {CATEGORIES.map((item) => (
          <Chip key={item.key} label={item.label} active={filter === item.key} onPress={() => setFilter(item.key)} />
        ))}
      </View>

      <Card style={{ paddingVertical: 4, paddingHorizontal: 18 }}>
        {filtered.length === 0 ? (
          <Text style={[t.text('bodyM', 'textMuted'), { paddingVertical: space[4] }]}>No programs match that search.</Text>
        ) : (
          filtered.map((item, index) => (
            <Pressable
              key={item.programDayId}
              onPress={() => beginEdit(item)}
              style={({ pressed }) => ({
                minHeight: 78,
                flexDirection: 'row',
                alignItems: 'center',
                gap: space[3],
                borderTopWidth: index === 0 ? 0 : borderWidth.hairline,
                borderTopColor: t.colors.borderHairline,
                opacity: pressed ? 0.64 : 1,
              })}
            >
              <ActiveCheck active={item.active} onPress={() => void toggleActive(item)} />
              <View style={{ flex: 1, minWidth: 0, paddingVertical: 12 }}>
                <Text numberOfLines={1} style={t.text('bodyM')}>{formatWorkoutDayName(item.name)}</Text>
                <Text numberOfLines={1} style={t.text('bodyS', 'textMuted')}>
                  {labelForCategory(item.category)} · {plural(item.movements.length, 'movement')} · {scheduleLabel(item)}
                </Text>
                <Text numberOfLines={1} style={t.text('bodyS', 'textFaint')}>
                  {item.movements.map((movement) => movement.exerciseName).join(' · ') || 'No movements'}
                </Text>
              </View>
              <Text style={t.text('bodyM', 'textFaint')}>›</Text>
            </Pressable>
          ))
        )}
      </Card>
    </ScreenScroll>
  );
}
