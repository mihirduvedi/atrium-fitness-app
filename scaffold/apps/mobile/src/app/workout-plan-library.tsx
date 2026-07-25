import { archetypeById } from '@atrium/engine';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { useApp } from '@/AppContext';
import { Button, Card, Eyebrow, ScreenScroll } from '@/components/ui';
import {
  cloneProgramIntoWorkoutPlan,
  createWorkoutPlanTemplate,
  listWorkoutPlanLibrary,
  removeProgramFromWorkoutPlan,
  saveWorkoutPlanSettings,
  setWorkoutPlanActive,
  type ProgramLibraryItem,
  type WorkoutPlanGoal,
  type WorkoutPlanLibraryItem,
} from '@/db/queries';
import { borderWidth, radius, space, useTheme } from '@/theme';
import { formatWorkoutDayName } from '@/workoutNames';

type Mode = 'list' | 'edit' | 'create';
type GoalFilter = WorkoutPlanGoal | 'all';

const GOALS: { key: GoalFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'strength', label: 'Strength' },
  { key: 'weight_loss', label: 'Weight loss' },
  { key: 'muscle', label: 'Muscle' },
  { key: 'agility', label: 'Agility' },
  { key: 'general', label: 'General' },
  { key: 'other', label: 'Other' },
];

const GOAL_CHOICES = GOALS.filter((item): item is { key: WorkoutPlanGoal; label: string } => item.key !== 'all');

function titleCase(value: string) {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function planName(plan: WorkoutPlanLibraryItem) {
  return plan.name ?? archetypeById.get(plan.archetypeId)?.name ?? titleCase(plan.archetypeId);
}

function goalLabel(goal: WorkoutPlanGoal) {
  return GOAL_CHOICES.find((item) => item.key === goal)?.label ?? 'General';
}

function plural(value: number, one: string) {
  return `${value} ${one}${value === 1 ? '' : 's'}`;
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

function fieldStyle(t: ReturnType<typeof useTheme>) {
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

function notesStyle(t: ReturnType<typeof useTheme>) {
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

function ProgramSummary({ program }: { program: ProgramLibraryItem }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text numberOfLines={1} style={t.text('bodyM')}>{formatWorkoutDayName(program.name)}</Text>
      <Text numberOfLines={1} style={t.text('bodyS', 'textMuted')}>
        {plural(program.movements.length, 'movement')} · {program.active ? 'Active' : 'Inactive'}
      </Text>
      <Text numberOfLines={1} style={t.text('bodyS', 'textFaint')}>
        {program.movements.map((movement) => movement.exerciseName).join(' · ') || 'No movements'}
      </Text>
    </View>
  );
}

export default function WorkoutPlanLibraryScreen() {
  const t = useTheme();
  const { db, userId, newId, sync } = useApp();
  const [plans, setPlans] = useState<WorkoutPlanLibraryItem[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<GoalFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('list');
  const [status, setStatus] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftGoal, setDraftGoal] = useState<WorkoutPlanGoal>('general');
  const [draftNotes, setDraftNotes] = useState('');

  const load = useCallback(async () => {
    setPlans(await listWorkoutPlanLibrary(db, userId));
  }, [db, userId]);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      listWorkoutPlanLibrary(db, userId)
        .then((next) => {
          if (live) setPlans(next);
        })
        .catch(() => {
          if (live) setPlans([]);
        });
      return () => {
        live = false;
      };
    }, [db, userId]),
  );

  const selected = plans.find((plan) => plan.planId === selectedId) ?? null;
  const allPrograms = useMemo(() => plans.flatMap((plan) => plan.programs), [plans]);
  const availablePrograms = useMemo(() => {
    if (!selected) return [];
    const selectedProgramIds = new Set(selected.programs.map((program) => program.programDayId));
    return allPrograms.filter((program) => program.workoutPlanId !== selected.planId && !selectedProgramIds.has(program.programDayId));
  }, [allPrograms, selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return plans.filter((plan) => {
      const haystack = [
        planName(plan),
        plan.goal,
        goalLabel(plan.goal),
        plan.notes ?? '',
        ...plan.programs.map((program) => program.name),
        ...plan.programs.flatMap((program) => program.movements.map((movement) => movement.exerciseName)),
      ].join(' ').toLowerCase();
      return (filter === 'all' || plan.goal === filter) && (!q || haystack.includes(q));
    });
  }, [filter, plans, query]);

  const beginCreate = () => {
    setMode('create');
    setStatus(null);
    setSelectedId(null);
    setDraftName('');
    setDraftGoal('general');
    setDraftNotes('');
  };

  const beginEdit = (plan: WorkoutPlanLibraryItem) => {
    setMode('edit');
    setStatus(null);
    setSelectedId(plan.planId);
    setDraftName(planName(plan));
    setDraftGoal(plan.goal);
    setDraftNotes(plan.notes ?? '');
  };

  const closeEditor = () => {
    setMode('list');
    setSelectedId(null);
  };

  const saveDraft = async () => {
    const name = draftName.trim();
    if (!name) return;
    if (mode === 'create') {
      const id = await createWorkoutPlanTemplate(db, userId, {
        name,
        goal: draftGoal,
        notes: draftNotes,
        active: false,
      }, newId);
      sync?.sync().catch(() => {});
      await load();
      setSelectedId(id);
      setMode('edit');
      setStatus('Workout plan created. Add programs below.');
      return;
    }

    if (!selected) return;
    await saveWorkoutPlanSettings(db, {
      userId,
      planId: selected.planId,
      name,
      goal: draftGoal,
      notes: draftNotes,
    });
    sync?.sync().catch(() => {});
    await load();
    closeEditor();
    setStatus('Workout plan saved.');
  };

  const toggleActive = async (plan: WorkoutPlanLibraryItem) => {
    if (!plan.active && plan.programs.length === 0) {
      Alert.alert('Add programs first', 'A workout plan needs at least one program before it can be active.');
      return;
    }
    await setWorkoutPlanActive(db, userId, plan.planId, !plan.active, newId);
    sync?.sync().catch(() => {});
    await load();
  };

  const removeProgram = (program: ProgramLibraryItem) => {
    Alert.alert('Remove program?', `${formatWorkoutDayName(program.name)} will be removed from this workout plan.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          removeProgramFromWorkoutPlan(db, userId, program.programDayId, newId)
            .then(() => {
              sync?.sync().catch(() => {});
              return load();
            })
            .catch(() => {});
        },
      },
    ]);
  };

  const addProgram = async (program: ProgramLibraryItem) => {
    if (!selected) return;
    await cloneProgramIntoWorkoutPlan(db, userId, program.programDayId, selected.planId, newId);
    sync?.sync().catch(() => {});
    await load();
    setStatus('Program added.');
  };

  if (mode !== 'list') {
    const programs = selected?.programs ?? [];
    return (
      <ScreenScroll>
        <View style={{ paddingHorizontal: 2, paddingTop: space[2], paddingBottom: space[2] }}>
          <Pressable onPress={closeEditor} hitSlop={10}>
            <Text style={t.text('bodyS', 'textMuted')}>‹ Workout Plans</Text>
          </Pressable>
          <View style={{ marginTop: space[5] }}>
            <Eyebrow>{mode === 'create' ? 'New workout plan' : 'Edit workout plan'}</Eyebrow>
            <Text style={t.text('screenTitle')}>{mode === 'create' ? 'New Workout Plan' : 'Edit Workout Plan'}</Text>
          </View>
        </View>

        {status && <Text style={[t.text('bodyM', 'textMuted'), { paddingHorizontal: 2 }]}>{status}</Text>}

        <Card style={{ gap: space[3] }}>
          <TextInput
            value={draftName}
            onChangeText={setDraftName}
            placeholder="Workout plan name"
            placeholderTextColor={t.colors.textFaint}
            style={fieldStyle(t)}
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            {GOAL_CHOICES.map((item) => (
              <Chip key={item.key} label={item.label} active={draftGoal === item.key} onPress={() => setDraftGoal(item.key)} />
            ))}
          </View>
          <TextInput
            value={draftNotes}
            onChangeText={setDraftNotes}
            placeholder="Notes"
            placeholderTextColor={t.colors.textFaint}
            multiline
            style={notesStyle(t)}
          />

          {mode === 'edit' && (
            <View style={{ borderTopWidth: borderWidth.hairline, borderTopColor: t.colors.borderHairline, paddingTop: space[3], gap: 2 }}>
              <Eyebrow>Programs</Eyebrow>
              {programs.length === 0 ? (
                <Text style={t.text('bodyM', 'textMuted')}>No programs yet.</Text>
              ) : (
                programs.map((program, index) => (
                  <View
                    key={program.programDayId}
                    style={{
                      minHeight: 72,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space[3],
                      borderTopWidth: index === 0 ? 0 : borderWidth.hairline,
                      borderColor: t.colors.borderHairline,
                      paddingVertical: 10,
                    }}
                  >
                    <ProgramSummary program={program} />
                    <Pressable onPress={() => removeProgram(program)} hitSlop={8} style={{ paddingHorizontal: 4, paddingVertical: 8 }}>
                      <Text style={t.text('bodyS', 'dataCoral')}>Remove</Text>
                    </Pressable>
                  </View>
                ))
              )}
            </View>
          )}

          {mode === 'edit' && (
            <View style={{ borderTopWidth: borderWidth.hairline, borderTopColor: t.colors.borderHairline, paddingTop: space[3], gap: 2 }}>
              <Eyebrow>Add program</Eyebrow>
              {availablePrograms.length === 0 ? (
                <Text style={t.text('bodyM', 'textMuted')}>Create or save another program to add it here.</Text>
              ) : (
                availablePrograms.map((program, index) => (
                  <View
                    key={program.programDayId}
                    style={{
                      minHeight: 72,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space[3],
                      borderTopWidth: index === 0 ? 0 : borderWidth.hairline,
                      borderColor: t.colors.borderHairline,
                      paddingVertical: 10,
                    }}
                  >
                    <ProgramSummary program={program} />
                    <Pressable onPress={() => void addProgram(program)} hitSlop={8} style={{ paddingHorizontal: 4, paddingVertical: 8 }}>
                      <Text style={t.text('bodyS')}>Add</Text>
                    </Pressable>
                  </View>
                ))
              )}
            </View>
          )}

          <Button title={mode === 'create' ? 'Create' : 'Save'} onPress={() => void saveDraft()} disabled={!draftName.trim()} />
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
            <Eyebrow>Workout plan library</Eyebrow>
            <Text style={t.text('screenTitle')}>Workout Plans</Text>
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
          placeholder="Search workout plans"
          placeholderTextColor={t.colors.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          style={[t.text('bodyM'), { flex: 1, height: 52, lineHeight: 18, paddingVertical: 0, paddingTop: 1, paddingBottom: 0, includeFontPadding: false, textAlignVertical: 'center' }]}
        />
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
        {GOALS.map((item) => (
          <Chip key={item.key} label={item.label} active={filter === item.key} onPress={() => setFilter(item.key)} />
        ))}
      </View>

      <Card style={{ paddingVertical: 4, paddingHorizontal: 18 }}>
        {filtered.length === 0 ? (
          <Text style={[t.text('bodyM', 'textMuted'), { paddingVertical: space[4] }]}>No workout plans match that search.</Text>
        ) : (
          filtered.map((plan, index) => {
            const activePrograms = plan.programs.filter((program) => program.active);
            return (
              <Pressable
                key={plan.planId}
                onPress={() => beginEdit(plan)}
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
                <ActiveCheck active={plan.active} onPress={() => void toggleActive(plan)} />
                <View style={{ flex: 1, minWidth: 0, paddingVertical: 12 }}>
                  <Text numberOfLines={1} style={t.text('bodyM')}>{planName(plan)}</Text>
                  <Text numberOfLines={1} style={t.text('bodyS', 'textMuted')}>
                    {goalLabel(plan.goal)} · {plural(activePrograms.length, 'active program')} · {plan.active ? 'Active' : 'Inactive'}
                  </Text>
                  <Text numberOfLines={1} style={t.text('bodyS', 'textFaint')}>
                    {plan.programs.map((program) => formatWorkoutDayName(program.name)).join(' · ') || 'No programs'}
                  </Text>
                </View>
                <Text style={t.text('bodyM', 'textFaint')}>›</Text>
              </Pressable>
            );
          })
        )}
      </Card>
    </ScreenScroll>
  );
}
