import {
  archetypeById,
  exerciseCatalog,
  type Readiness,
  type SessionPlan,
} from '@atrium/engine';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useApp } from '@/AppContext';
import { Button, Card, ConsistencyMeter, Eyebrow, ReadinessRing, ScreenScroll, Teaser } from '@/components/ui';
import { getActiveProgram, getNextProgramDay, planSession, type NextDay } from '@/db/queries';
import { getReadinessSignal, type ReadinessSignal } from '@/health/readiness';
import { radius, space, useTheme } from '@/theme';

const READINESS: { value: Readiness; label: string }[] = [
  { value: 'green', label: 'Ready' },
  { value: 'yellow', label: 'Worn' },
  { value: 'red', label: 'Rough' },
];

const RING_LABEL: Record<Readiness, string> = {
  green: 'Ready',
  yellow: 'Worn',
  red: 'Rough',
};

const OVERRIDE_COPY: Record<Readiness, { score: number; title: string; body: string }> = {
  green: {
    score: 82,
    title: 'Ready',
    body: 'Manual override is set to full working weights today.',
  },
  yellow: {
    score: 68,
    title: 'Worn',
    body: 'Manual override trims stress while keeping the workout pattern intact.',
  },
  red: {
    score: 51,
    title: 'Rough',
    body: 'Manual override lowers volume and load for a technique-focused day.',
  },
};

function dayTitle(name: string): string {
  const focus = name.split(' — ')[0] ?? name;
  if (focus === 'Upper') return 'Upper body';
  if (focus === 'Lower') return 'Lower body';
  if (focus === 'Full') return 'Full body';
  return focus;
}

function formatSets(p: SessionPlan['prescriptions'][number]): string {
  const top = p.sets.find((s) => s.kind === 'top');
  const backoffs = p.sets.filter((s) => s.kind === 'backoff');
  if (top && backoffs.length > 0) {
    return `1 × ${top.targetReps[0]}–${top.targetReps[1]} + ${backoffs.length} × ${backoffs[0]!.targetReps[0]}–${backoffs[0]!.targetReps[1]}`;
  }
  const first = p.sets[0];
  if (!first) return '';
  if (first.targetSeconds !== undefined) return `${p.sets.length} × ${first.targetSeconds}s`;
  return first.targetReps[0] === first.targetReps[1]
    ? `${p.sets.length} × ${first.targetReps[0]}`
    : `${p.sets.length} × ${first.targetReps[0]}–${first.targetReps[1]}`;
}

export default function TodayScreen() {
  const t = useTheme();
  const { db, userId, newId } = useApp();
  const [day, setDay] = useState<NextDay | null>(null);
  const [plan, setPlan] = useState<SessionPlan | null>(null);
  const [archetypeName, setArchetypeName] = useState('');
  const [readinessSignal, setReadinessSignal] = useState<ReadinessSignal | null>(null);
  const [manualReadiness, setManualReadiness] = useState<Readiness | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const effectiveReadiness = manualReadiness ?? readinessSignal?.readiness ?? 'green';

  useFocusEffect(
    useCallback(() => {
      let live = true;
      (async () => {
        const signal = await getReadinessSignal(db, userId);
        const program = await getActiveProgram(db, userId);
        if (!program) {
          if (live) {
            setDay(null);
            setPlan(null);
            setArchetypeName('');
            setReadinessSignal(signal);
            setNeedsSetup(true);
          }
          return;
        }
        const next = await getNextProgramDay(db, program.id);
        if (!next || !live) return;
        const p = await planSession(db, userId, next, newId, manualReadiness ?? signal.readiness);
        if (!live) return;
        setNeedsSetup(false);
        setReadinessSignal(signal);
        setDay(next);
        setPlan(p);
        setArchetypeName(archetypeById.get(program.archetype_id)?.name ?? program.archetype_id);
      })();
      return () => {
        live = false;
      };
    }, [db, userId, manualReadiness, newId]),
  );

  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  const readinessCopy = manualReadiness ? OVERRIDE_COPY[manualReadiness] : readinessSignal ?? OVERRIDE_COPY.green;
  const exerciseCount = Object.keys(exerciseCatalog).length;

  return (
    <ScreenScroll>
      <View style={{ paddingHorizontal: 2, paddingTop: space[2], paddingBottom: space[4] }}>
        <Eyebrow>{today}</Eyebrow>
        <Text style={t.text('screenTitle')}>
          {needsSetup ? 'Welcome' : day ? dayTitle(day.name) : 'Loading...'}
        </Text>
      </View>

      {needsSetup && (
        <Card>
          <Eyebrow>First plan</Eyebrow>
          <Text style={t.text('displayS')}>Build your starting week.</Text>
          <Text style={[t.text('bodyM', 'textMuted'), { marginTop: space[1], marginBottom: space[4] }]}>
            Four quick answers pick the safest program match from the engine.
          </Text>
          <Button title="Set up plan" onPress={() => router.replace('/onboarding')} />
        </Card>
      )}

      {!needsSetup && (
        <Card style={{ gap: space[3] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
            <ReadinessRing score={readinessCopy.score} label={RING_LABEL[effectiveReadiness]} />
            <View style={{ flex: 1 }}>
              <Text style={[t.text('displayS'), { fontSize: 15 }]}>{readinessCopy.title}</Text>
              <Text style={[t.text('bodyS', 'textMuted'), { marginTop: space[1] }]}>{readinessCopy.body}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: space[2] }}>
            {READINESS.map((r) => {
              const active = effectiveReadiness === r.value;
              return (
                <Pressable
                  key={r.value}
                  onPress={() => setManualReadiness((current) => (current === r.value ? null : r.value))}
                  style={{
                    flex: 1,
                    height: 36,
                    borderRadius: radius.control,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: active ? t.colors.actionInk : t.colors.bgSurface2,
                  }}
                >
                  <Text style={t.text('bodyS', active ? 'actionOnInk' : 'textMuted')}>{r.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </Card>
      )}

      {day && plan && (
        <Card>
          <Eyebrow>{`Week ${day.week} · Day ${day.dayIndex + 1} of ${day.daysPerWeek}`}</Eyebrow>
          <Text style={t.text('displayM')}>{day.name}</Text>
          <Text style={[t.text('bodyS', 'textMuted'), { marginTop: 2, marginBottom: space[3] }]}>
            52 min est · {archetypeName} · {plan.prescriptions.length} exercises
          </Text>
          <View style={{ borderTopWidth: 1, borderTopColor: t.colors.borderHairline }}>
            {plan.prescriptions.slice(0, 3).map((p) => (
              <View
                key={p.slotId}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  paddingVertical: space[2],
                  borderBottomWidth: 1,
                  borderBottomColor: t.colors.borderHairline,
                }}
              >
                <Text style={t.text('bodyM')}>{exerciseCatalog[p.exerciseId]?.name ?? p.exerciseId}</Text>
                <Text style={t.text('dataS', 'textFaint')}>{formatSets(p)}</Text>
              </View>
            ))}
          </View>
          <View style={{ marginTop: space[4] }}>
            <Button title="Start workout" onPress={() => router.push({ pathname: '/workout', params: { readiness: effectiveReadiness } })} />
          </View>
        </Card>
      )}

      {day && (
        <Card style={{ paddingVertical: 4, paddingHorizontal: 16 }}>
          <Pressable
            onPress={() => router.push('/library')}
            style={({ pressed }) => ({
              minHeight: 54,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: space[3],
              opacity: pressed ? 0.62 : 1,
            })}
          >
            <Text style={t.text('bodyM')}>Exercise library</Text>
            <Text style={t.text('bodyS', 'textMuted')}>{exerciseCount} movements ›</Text>
          </Pressable>
        </Card>
      )}

      {day && (
        <View style={{ flexDirection: 'row', gap: 14 }}>
          <Card style={{ flex: 1 }}>
            <Eyebrow>This week</Eyebrow>
            <Text style={t.text('heroNumXL')}>
              {day.completedThisWeek}
              <Text style={t.text('bodyM', 'textMuted')}> / {day.daysPerWeek}</Text>
            </Text>
            <ConsistencyMeter total={day.daysPerWeek} done={day.completedThisWeek} />
          </Card>
          <Card style={{ flex: 1 }}>
            <Eyebrow>Body weight</Eyebrow>
            <Text style={t.text('heroNumXL')}>176.2</Text>
            <Text style={[t.text('bodyS', 'dataBlue'), { fontWeight: '600' }]}>Down 0.4 lb · 7-day avg</Text>
          </Card>
        </View>
      )}

      {!needsSetup && (
        <Teaser
          marker="+"
          title="Your weekly review is ready."
          detail="A few wins, one thing to watch, and a cleaner plan for next week."
        />
      )}
    </ScreenScroll>
  );
}
