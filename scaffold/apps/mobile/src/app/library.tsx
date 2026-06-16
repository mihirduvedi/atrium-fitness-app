import { exerciseCatalog, type CatalogExercise, type Pattern } from '@atrium/engine';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { useApp } from '@/AppContext';
import { Card, Eyebrow, ScreenScroll } from '@/components/ui';
import { borderWidth, radius, space, useTheme } from '@/theme';

type FilterKey = 'all' | 'chest' | 'back' | 'legs' | 'shoulders' | 'arms' | 'core';

interface ExerciseRow {
  id: string;
  name: string;
  group: FilterKey;
  groupLabel: string;
  detail: string;
  catalog: CatalogExercise;
  inPlan: boolean;
}

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
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

function Thumb({ name }: { name: string }) {
  const t = useTheme();
  return (
    <View
      style={{
        width: 42,
        height: 42,
        borderRadius: 21,
        backgroundColor: t.colors.bgSurface2,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={t.text('dataS', 'textMuted')}>{initials(name)}</Text>
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

function ExerciseItem({ row, last }: { row: ExerciseRow; last: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/exercise/[id]', params: { id: row.id } })}
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
      <Thumb name={row.name} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
          <Text numberOfLines={1} style={[t.text('bodyM'), { flexShrink: 1 }]}>
            {row.name}
          </Text>
          {row.inPlan && (
            <View
              style={{
                borderRadius: 5,
                backgroundColor: t.colors.bgSurface2,
                paddingHorizontal: 6,
                paddingVertical: 2,
              }}
            >
              <Text style={[t.text('labelCaps', 'textFaint'), { fontSize: 8 }]}>Plan</Text>
            </View>
          )}
        </View>
        <Text numberOfLines={1} style={t.text('bodyS', 'textMuted')}>{row.detail}</Text>
      </View>
      <Text style={t.text('bodyM', 'textFaint')}>›</Text>
    </Pressable>
  );
}

export default function ExerciseLibraryScreen() {
  const t = useTheme();
  const { db, userId } = useApp();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');
  const [planIds, setPlanIds] = useState<Set<string>>(new Set());

  useFocusEffect(
    useCallback(() => {
      let live = true;
      (async () => {
        const rows = await db.getAllAsync<{ exercise_id: string }>(
          `select distinct s.exercise_id
             from program_slots s
             join program_days d on d.id = s.program_day_id
             join programs p on p.id = d.program_id
            where p.user_id = ? and p.status = 'active'
              and p.deleted_at is null and d.deleted_at is null and s.deleted_at is null`,
          userId,
        );
        if (live) setPlanIds(new Set(rows.map((row) => row.exercise_id)));
      })();
      return () => {
        live = false;
      };
    }, [db, userId]),
  );

  const rows = useMemo<ExerciseRow[]>(() => {
    return Object.entries(exerciseCatalog)
      .map(([id, catalog]) => {
        const group = GROUP_BY_PATTERN[catalog.pattern];
        const type = COMPOUND.has(catalog.pattern) ? 'Compound' : 'Accessory';
        return {
          id,
          name: catalog.name,
          group: group.key,
          groupLabel: group.label,
          detail: `${group.label} · ${titleCase(catalog.equipment)} · ${type}`,
          catalog,
          inPlan: planIds.has(id),
        };
      })
      .sort((a, b) => Number(b.inPlan) - Number(a.inPlan) || a.name.localeCompare(b.name));
  }, [planIds]);

  const filtered = rows.filter((row) => {
    const q = query.trim().toLowerCase();
    const matchesFilter = filter === 'all' || row.group === filter;
    const matchesQuery =
      q.length === 0 ||
      row.name.toLowerCase().includes(q) ||
      row.detail.toLowerCase().includes(q) ||
      row.catalog.pattern.toLowerCase().includes(q);
    return matchesFilter && matchesQuery;
  });

  return (
    <ScreenScroll>
      <View style={{ paddingHorizontal: 2, paddingTop: space[2], paddingBottom: space[2] }}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={t.text('bodyS', 'textMuted')}>‹ Back</Text>
        </Pressable>
        <Text style={[t.text('screenTitle'), { marginTop: space[5] }]}>Exercises</Text>
        <Text style={[t.text('bodyS', 'textMuted'), { marginTop: 3 }]}>{exerciseRowsLabel(rows.length, planIds.size)}</Text>
      </View>

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
          filtered.map((row, index) => <ExerciseItem key={row.id} row={row} last={index === filtered.length - 1} />)
        )}
      </Card>

      <Card>
        <Eyebrow>Catalog</Eyebrow>
        <Text style={t.text('bodyM')}>Built from the current program engine catalog.</Text>
        <Text style={[t.text('bodyS', 'textMuted'), { marginTop: 3 }]}>Swaps and substitutions use these same movement patterns.</Text>
      </Card>
    </ScreenScroll>
  );
}

function exerciseRowsLabel(total: number, inPlan: number) {
  return inPlan > 0 ? `${total} movements · ${inPlan} in your current plan` : `${total} movements`;
}
