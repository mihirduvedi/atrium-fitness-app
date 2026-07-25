import { type Pattern } from '@atrium/engine';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { useApp } from '@/AppContext';
import { Button, Card, Eyebrow, ScreenScroll } from '@/components/ui';
import {
  addMovementToProgramDay,
  createCustomExercise,
  deleteCustomExercise,
  listExercises,
  type ExerciseLibraryEntry,
} from '@/db/queries';
import { borderWidth, radius, space, useTheme } from '@/theme';

type FilterKey = 'all' | 'chest' | 'back' | 'legs' | 'shoulders' | 'arms' | 'core' | 'custom';

interface ExerciseRow {
  id: string;
  name: string;
  group: FilterKey;
  groupLabel: string;
  detail: string;
  exercise: ExerciseLibraryEntry;
  inPlan: boolean;
  custom: boolean;
}

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'custom', label: 'Custom' },
  { key: 'chest', label: 'Chest' },
  { key: 'back', label: 'Back' },
  { key: 'legs', label: 'Legs' },
  { key: 'shoulders', label: 'Shoulders' },
  { key: 'arms', label: 'Arms' },
  { key: 'core', label: 'Core' },
];

const GROUP_BY_PATTERN: Record<Pattern, { key: FilterKey; label: string }> = {
  squat: { key: 'legs', label: 'Legs' },
  hinge: { key: 'legs', label: 'Posterior chain' },
  hpress: { key: 'chest', label: 'Chest' },
  vpress: { key: 'shoulders', label: 'Shoulders' },
  hpull: { key: 'back', label: 'Back' },
  vpull: { key: 'back', label: 'Back' },
  lunge: { key: 'legs', label: 'Legs' },
  chest_iso: { key: 'chest', label: 'Chest' },
  side_delt: { key: 'shoulders', label: 'Shoulders' },
  rear_delt: { key: 'shoulders', label: 'Rear delts' },
  biceps: { key: 'arms', label: 'Arms' },
  triceps: { key: 'arms', label: 'Arms' },
  quad_iso: { key: 'legs', label: 'Quads' },
  ham_iso: { key: 'legs', label: 'Hamstrings' },
  glute_iso: { key: 'legs', label: 'Glutes' },
  calf: { key: 'legs', label: 'Calves' },
  core: { key: 'core', label: 'Core' },
  carry: { key: 'core', label: 'Carry' },
  cond: { key: 'core', label: 'Conditioning' },
};

const COMPOUND = new Set<Pattern>(['squat', 'hinge', 'hpress', 'vpress', 'hpull', 'vpull', 'lunge', 'carry']);
const CUSTOM_PATTERN_OPTIONS: { pattern: Pattern; label: string }[] = [
  { pattern: 'squat', label: 'Squat' },
  { pattern: 'hinge', label: 'Hinge' },
  { pattern: 'hpress', label: 'Press' },
  { pattern: 'hpull', label: 'Pull' },
  { pattern: 'quad_iso', label: 'Legs' },
  { pattern: 'core', label: 'Core' },
];
const EQUIPMENT_OPTIONS = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'band'];

function titleCase(value: string) {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function initials(name: string) {
  return name
    .replace(/\(.+?\)/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

function SearchIcon() {
  const t = useTheme();
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Circle cx={10.8} cy={10.8} r={6.4} fill="none" stroke={t.colors.textFaint} strokeWidth={1.9} />
      <Line x1={15.6} y1={15.6} x2={20} y2={20} stroke={t.colors.textFaint} strokeWidth={1.9} strokeLinecap="round" />
    </Svg>
  );
}

function Thumb({ name, custom }: { name: string; custom?: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{
        width: 42,
        height: 42,
        borderRadius: 21,
        backgroundColor: custom ? t.colors.actionInk : t.colors.bgSurface2,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={t.text('dataS', custom ? 'actionOnInk' : 'textMuted')}>{initials(name)}</Text>
    </View>
  );
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        height: 34,
        paddingHorizontal: 13,
        borderRadius: radius.control,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active ? t.colors.actionInk : t.colors.bgSurface,
        borderWidth: active ? 0 : borderWidth.hairline,
        borderColor: t.colors.borderHairline,
        opacity: pressed ? 0.68 : 1,
      })}
    >
      <Text style={t.text('bodyS', active ? 'actionOnInk' : 'textMuted')}>{label}</Text>
    </Pressable>
  );
}

function ChoiceChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 34,
        paddingHorizontal: 11,
        borderRadius: radius.control,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active ? t.colors.actionInk : t.colors.bgSurface2,
        opacity: pressed ? 0.68 : 1,
      })}
    >
      <Text style={t.text('bodyS', active ? 'actionOnInk' : 'textMuted')}>{label}</Text>
    </Pressable>
  );
}

function NumberField({
  label,
  value,
  onChangeText,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
}) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, gap: 9 }}>
      <Text style={[t.text('labelCaps', 'textMuted'), { textAlign: 'center' }]}>{label}</Text>
      <View
        style={{
          height: 56,
          borderRadius: radius.control,
          backgroundColor: t.colors.bgSurface2,
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          keyboardType="number-pad"
          placeholder={label}
          placeholderTextColor={t.colors.textFaint}
          style={[
            t.text('dataM'),
            {
              height: 56,
              paddingHorizontal: 0,
              paddingTop: 0,
              paddingBottom: 3,
              includeFontPadding: false,
              textAlign: 'center',
              textAlignVertical: 'center',
              backgroundColor: 'transparent',
            },
          ]}
        />
      </View>
    </View>
  );
}

function ExerciseItem({
  row,
  selected,
  last,
  addMode,
  onSelect,
  onDelete,
}: {
  row: ExerciseRow;
  selected: boolean;
  last: boolean;
  addMode: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onSelect}
      style={({ pressed }) => ({
        minHeight: 68,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        borderBottomWidth: last ? 0 : borderWidth.hairline,
        borderBottomColor: t.colors.borderHairline,
        opacity: pressed ? 0.62 : 1,
      })}
    >
      <Thumb name={row.name} custom={row.custom} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
          <Text numberOfLines={1} style={[t.text('bodyM'), { flexShrink: 1 }]}>
            {row.name}
          </Text>
          {selected && (
            <View style={{ borderRadius: 5, backgroundColor: t.colors.actionInk, paddingHorizontal: 6, paddingVertical: 2 }}>
              <Text style={[t.text('labelCaps', 'actionOnInk'), { fontSize: 8 }]}>Selected</Text>
            </View>
          )}
          {row.inPlan && !selected && (
            <View style={{ borderRadius: 5, backgroundColor: t.colors.bgSurface2, paddingHorizontal: 6, paddingVertical: 2 }}>
              <Text style={[t.text('labelCaps', 'textFaint'), { fontSize: 8 }]}>Plan</Text>
            </View>
          )}
        </View>
        <Text numberOfLines={1} style={t.text('bodyS', 'textMuted')}>{row.detail}</Text>
      </View>
      {row.custom && !addMode ? (
        <Pressable onPress={onDelete} hitSlop={8} style={{ paddingHorizontal: 4, paddingVertical: 8 }}>
          <Text style={t.text('bodyS', 'dataCoral')}>Delete</Text>
        </Pressable>
      ) : (
        <Text style={t.text('bodyM', 'textFaint')}>{addMode ? '+' : '›'}</Text>
      )}
    </Pressable>
  );
}

export default function ExerciseLibraryScreen() {
  const t = useTheme();
  const { db, userId, newId, sync, queueWorkoutMovement } = useApp();
  const params = useLocalSearchParams<{ mode?: string; programDayId?: string; returnTo?: string }>();
  const addMode = params.mode === 'add';
  const programDayId = Array.isArray(params.programDayId) ? params.programDayId[0] : params.programDayId;
  const returnTo = Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo;

  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');
  const [planIds, setPlanIds] = useState<Set<string>>(new Set());
  const [exercises, setExercises] = useState<ExerciseLibraryEntry[]>([]);
  const [selected, setSelected] = useState<ExerciseRow | null>(null);
  const [addSets, setAddSets] = useState('3');
  const [addReps, setAddReps] = useState('8');
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customDescription, setCustomDescription] = useState('');
  const [customSets, setCustomSets] = useState('3');
  const [customReps, setCustomReps] = useState('8');
  const [customPattern, setCustomPattern] = useState<Pattern>('hpress');
  const [customEquipment, setCustomEquipment] = useState('dumbbell');

  const reload = useCallback(async () => {
    const [exerciseRows, planRows] = await Promise.all([
      listExercises(db, userId),
      db.getAllAsync<{ exercise_id: string }>(
        `select distinct s.exercise_id
           from program_slots s
           join program_days d on d.id = s.program_day_id
           join programs p on p.id = d.program_id
          where p.user_id = ? and p.status = 'active'
            and p.deleted_at is null and d.deleted_at is null and s.deleted_at is null`,
        userId,
      ),
    ]);
    setExercises(exerciseRows);
    setPlanIds(new Set(planRows.map((row) => row.exercise_id)));
  }, [db, userId]);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      reload().catch(() => {
        if (live) setExercises([]);
      });
      return () => {
        live = false;
      };
    }, [reload]),
  );

  const rows = useMemo<ExerciseRow[]>(() => {
    return exercises
      .map((exercise) => {
        const group = GROUP_BY_PATTERN[exercise.pattern] ?? { key: 'core' as const, label: 'General' };
        const custom = exercise.ownerUserId !== null;
        const type = custom ? 'Custom' : COMPOUND.has(exercise.pattern) ? 'Compound' : 'Accessory';
        return {
          id: exercise.id,
          name: exercise.name,
          group: custom ? 'custom' : group.key,
          groupLabel: group.label,
          detail: exercise.description || `${group.label} · ${titleCase(exercise.equipment)} · ${type}`,
          exercise,
          inPlan: planIds.has(exercise.id),
          custom,
        };
      })
      .sort((a, b) => Number(b.custom) - Number(a.custom) || Number(b.inPlan) - Number(a.inPlan) || a.name.localeCompare(b.name));
  }, [exercises, planIds]);

  const filtered = rows.filter((row) => {
    const q = query.trim().toLowerCase();
    const matchesFilter = filter === 'all' || row.group === filter;
    const matchesQuery =
      q.length === 0 ||
      row.name.toLowerCase().includes(q) ||
      row.detail.toLowerCase().includes(q) ||
      row.exercise.pattern.toLowerCase().includes(q);
    return matchesFilter && matchesQuery;
  });

  const selectedSets = Math.max(1, Math.min(12, Number.parseInt(addSets || selected?.exercise.defaultSets?.toString() || '3', 10) || 3));
  const selectedReps = Math.max(1, Math.min(50, Number.parseInt(addReps || selected?.exercise.defaultReps?.toString() || '8', 10) || 8));

  const selectRow = (row: ExerciseRow) => {
    if (!addMode) {
      router.push({ pathname: '/exercise/[id]', params: { id: row.id } });
      return;
    }
    setSelected(row);
    setAddSets(String(row.exercise.defaultSets ?? 3));
    setAddReps(String(row.exercise.defaultReps ?? 8));
  };

  const createCustom = async () => {
    const name = customName.trim();
    if (!name) return;
    const created = await createCustomExercise(db, userId, {
      name,
      pattern: customPattern,
      equipment: customEquipment,
      description: customDescription,
      defaultSets: Number.parseInt(customSets, 10) || 3,
      defaultReps: Number.parseInt(customReps, 10) || 8,
    }, newId);
    sync?.sync().catch(() => {});
    setCustomName('');
    setCustomDescription('');
    setCustomOpen(false);
    await reload();
    if (addMode) {
      const group = GROUP_BY_PATTERN[created.pattern] ?? { key: 'core' as const, label: 'General' };
      setSelected({
        id: created.id,
        name: created.name,
        group: 'custom',
        groupLabel: group.label,
        detail: created.description || `${group.label} · ${titleCase(created.equipment)} · Custom`,
        exercise: created,
        inPlan: false,
        custom: true,
      });
      setAddSets(String(created.defaultSets ?? 3));
      setAddReps(String(created.defaultReps ?? 8));
    }
  };

  const confirmDelete = (row: ExerciseRow) => {
    Alert.alert('Delete custom movement?', `${row.name} will be removed from your library.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteCustomExercise(db, userId, row.id, newId)
            .then((deleted) => {
              if (deleted && selected?.id === row.id) setSelected(null);
              sync?.sync().catch(() => {});
              return reload();
            })
            .catch(() => {});
        },
      },
    ]);
  };

  const addSelected = async (scope: 'session' | 'program') => {
    if (!selected || !programDayId) return;
    let slotId = newId();
    if (scope === 'program') {
      const slot = await addMovementToProgramDay(db, programDayId, selected.id, { sets: selectedSets, reps: selectedReps }, newId);
      slotId = slot.slotId;
      sync?.sync().catch(() => {});
    }
    if (returnTo === 'workout') {
      queueWorkoutMovement({
        id: newId(),
        programDayId,
        slotId,
        exerciseId: selected.id,
        exerciseName: selected.name,
        pattern: selected.exercise.pattern,
        equipment: selected.exercise.equipment,
        sets: selectedSets,
        reps: selectedReps,
        scope,
      });
    }
    router.back();
  };

  return (
    <ScreenScroll>
      <View style={{ paddingHorizontal: 2, paddingTop: space[2], paddingBottom: space[2] }}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={t.text('bodyS', 'textMuted')}>‹ {addMode ? 'Back' : 'Back'}</Text>
        </Pressable>
        <Text style={[t.text('screenTitle'), { marginTop: space[5] }]}>{addMode ? 'Add Movement' : 'Exercises'}</Text>
        <Text style={[t.text('bodyS', 'textMuted'), { marginTop: 3 }]}>
          {addMode ? 'Pick a movement, choose its sets, then decide where it belongs.' : exerciseRowsLabel(rows.length, planIds.size)}
        </Text>
      </View>

      <Button title={customOpen ? 'Close custom movement' : 'Create custom movement'} ghost onPress={() => setCustomOpen((open) => !open)} />

      {customOpen && (
        <Card style={{ gap: space[3] }}>
          <Eyebrow>Custom movement</Eyebrow>
          <TextInput
            value={customName}
            onChangeText={setCustomName}
            placeholder="Movement name"
            placeholderTextColor={t.colors.textFaint}
            style={[
              t.text('bodyM'),
              {
                height: 46,
                borderRadius: radius.control,
                backgroundColor: t.colors.bgSurface2,
                paddingHorizontal: 13,
                paddingTop: 0,
                paddingBottom: 2,
                includeFontPadding: false,
                textAlignVertical: 'center',
              },
            ]}
          />
          <TextInput
            value={customDescription}
            onChangeText={setCustomDescription}
            placeholder="Description"
            placeholderTextColor={t.colors.textFaint}
            multiline
            style={[t.text('bodyM'), { minHeight: 78, borderRadius: radius.control, backgroundColor: t.colors.bgSurface2, paddingHorizontal: 13, paddingTop: 12 }]}
          />
          <View style={{ flexDirection: 'row', gap: space[3] }}>
            <NumberField label="Sets" value={customSets} onChangeText={setCustomSets} />
            <NumberField label="Reps" value={customReps} onChangeText={setCustomReps} />
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            {CUSTOM_PATTERN_OPTIONS.map((option) => (
              <ChoiceChip
                key={option.pattern}
                label={option.label}
                active={customPattern === option.pattern}
                onPress={() => setCustomPattern(option.pattern)}
              />
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            {EQUIPMENT_OPTIONS.map((item) => (
              <ChoiceChip key={item} label={titleCase(item)} active={customEquipment === item} onPress={() => setCustomEquipment(item)} />
            ))}
          </View>
          <Button title="Save custom movement" onPress={() => void createCustom()} disabled={!customName.trim()} />
        </Card>
      )}

      {addMode && (
        <Card style={{ gap: space[4] }}>
          <View style={{ gap: 12 }}>
            <Text style={t.text('labelCaps', 'textMuted')}>Add to workout</Text>
            <Text style={t.text('displayS')}>{selected?.name ?? 'Choose a movement'}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: space[3] }}>
            <NumberField label="Sets" value={addSets} onChangeText={setAddSets} />
            <NumberField label="Reps" value={addReps} onChangeText={setAddReps} />
          </View>
          {returnTo === 'workout' && (
            <Button title="Add only to this program session" onPress={() => void addSelected('session')} disabled={!selected || !programDayId} />
          )}
          <Button
            title={returnTo === 'program-library' ? 'Add to program' : 'Add to all programs'}
            ghost={returnTo === 'workout'}
            onPress={() => void addSelected('program')}
            disabled={!selected || !programDayId}
          />
        </Card>
      )}

      <View
        style={{
          minHeight: 46,
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
          placeholder="Search movements"
          placeholderTextColor={t.colors.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          style={[t.text('bodyM'), { flex: 1, paddingVertical: 10 }]}
        />
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
        {FILTERS.map((item) => (
          <FilterChip key={item.key} label={item.label} active={filter === item.key} onPress={() => setFilter(item.key)} />
        ))}
      </View>

      <Card style={{ paddingVertical: 4, paddingHorizontal: 18 }}>
        {filtered.length === 0 ? (
          <Text style={[t.text('bodyM', 'textMuted'), { paddingVertical: space[4] }]}>No exercises match that search.</Text>
        ) : (
          filtered.map((row, index) => (
            <ExerciseItem
              key={row.id}
              row={row}
              selected={selected?.id === row.id}
              last={index === filtered.length - 1}
              addMode={addMode}
              onSelect={() => selectRow(row)}
              onDelete={() => confirmDelete(row)}
            />
          ))
        )}
      </Card>

      <Card>
        <Eyebrow>Catalog</Eyebrow>
        <Text style={t.text('bodyM')}>Built-ins come from the program engine; custom movements stay in your library until you delete them.</Text>
      </Card>
    </ScreenScroll>
  );
}

function exerciseRowsLabel(total: number, inPlan: number) {
  return inPlan > 0 ? `${total} movements · ${inPlan} in your current plan` : `${total} movements`;
}
