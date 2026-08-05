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
import {
  discardEmptyInProgressWorkouts,
  getActiveProgram,
  getInProgressWorkoutOverview,
  getNextProgramDay,
  getWorkoutDraft,
  planSession,
  type InProgressWorkoutOverview,
  type NextDay,
} from '@/db/queries';
import {
  getBodyWeightSummary,
  getDailyCheckIn,
  getReadinessSignal,
  type BodyWeightSummary,
  type ReadinessSignal,
} from '@/health/readiness';
import { shouldShowConversionTeaser } from '@/subscriptions/subscription';
import { radius, space, useTheme } from '@/theme';
import { displayWorkoutName, formatWorkoutDayName, formatWorkoutFocusName } from '@/workoutNames';

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
  return formatWorkoutFocusName(name);
}

function formatSets(p: SessionPlan['prescriptions'][number]): string {
  const workSets = p.sets.filter((s) => !s.isWarmup);
  const top = workSets.find((s) => s.kind === 'top');
  const backoffs = workSets.filter((s) => s.kind === 'backoff');
  if (top && backoffs.length > 0) {
    return `1 × ${top.targetReps[0]}–${top.targetReps[1]} + ${backoffs.length} × ${backoffs[0]!.targetReps[0]}–${backoffs[0]!.targetReps[1]}`;
  }
  const first = workSets[0];
  if (!first) return '';
  if (first.targetSeconds !== undefined) return `${workSets.length} × ${first.targetSeconds}s`;
  return first.targetReps[0] === first.targetReps[1]
    ? `${workSets.length} × ${first.targetReps[0]}`
    : `${workSets.length} × ${first.targetReps[0]}–${first.targetReps[1]}`;
}

function startedLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function bodyWeightDetail(summary: BodyWeightSummary | null) {
  if (!summary?.latestDate) return 'Log in daily check-in';
  if (summary.sevenDayDelta != null) {
    if (Math.abs(summary.sevenDayDelta) < 0.05) return 'Steady · 7-day avg';
    const direction = summary.sevenDayDelta > 0 ? 'Up' : 'Down';
    return `${direction} ${Math.abs(summary.sevenDayDelta).toFixed(1)} ${summary.units} · 7-day avg`;
  }
  return `Last logged ${new Date(`${summary.latestDate}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

export default function TodayScreen() {
  const t = useTheme();
  const { db, userId, newId, subscription } = useApp();
  const [day, setDay] = useState<NextDay | null>(null);
  const [plan, setPlan] = useState<SessionPlan | null>(null);
  const [archetypeName, setArchetypeName] = useState('');
  const [readinessSignal, setReadinessSignal] = useState<ReadinessSignal | null>(null);
  const [bodyWeight, setBodyWeight] = useState<BodyWeightSummary | null>(null);
  const [hasDailyCheckIn, setHasDailyCheckIn] = useState(false);
  const [manualReadiness, setManualReadiness] = useState<Readiness | null>(null);
  const [activeWorkout, setActiveWorkout] = useState<InProgressWorkoutOverview | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [completedWorkouts, setCompletedWorkouts] = useState(0);
  const effectiveReadiness = manualReadiness ?? readinessSignal?.readiness ?? 'green';

  useFocusEffect(
    useCallback(() => {
      let live = true;
      (async () => {
        const [signal, weightSummary, dailyCheckIn, firstActive, completed] = await Promise.all([
          getReadinessSignal(db, userId),
          getBodyWeightSummary(db, userId),
          getDailyCheckIn(db, userId),
          getInProgressWorkoutOverview(db, userId),
          db.getFirstAsync<{ n: number }>(
            `select count(*) as n
               from workouts w
              where w.user_id = ? and w.ended_at is not null and w.deleted_at is null
                and exists (
                  select 1 from sets s
                   where s.workout_id = w.id and s.deleted_at is null and s.is_warmup = 0
                )`,
            userId,
          ),
        ]);
        let keepActiveId = firstActive?.workoutId ?? null;
        if (firstActive && firstActive.completedSets === 0) {
          keepActiveId = (await getWorkoutDraft(db, firstActive.workoutId)) ? firstActive.workoutId : null;
        }
        await discardEmptyInProgressWorkouts(db, userId, newId, keepActiveId);
        const active = await getInProgressWorkoutOverview(db, userId);
        const program = await getActiveProgram(db, userId);
        if (!program) {
          if (live) {
            setDay(null);
            setPlan(null);
            setArchetypeName('');
            setReadinessSignal(signal);
            setBodyWeight(weightSummary);
            setHasDailyCheckIn(!!dailyCheckIn);
            setActiveWorkout(active);
            setCompletedWorkouts(completed?.n ?? 0);
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
        setBodyWeight(weightSummary);
        setHasDailyCheckIn(!!dailyCheckIn);
        setActiveWorkout(active);
        setCompletedWorkouts(completed?.n ?? 0);
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
  const resumeWorkout = () => {
    if (!activeWorkout) return;
    router.push({ pathname: '/workout', params: { workoutId: activeWorkout.workoutId } });
  };

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

      {activeWorkout && !needsSetup && (
        <Card>
          <Eyebrow>Active workout</Eyebrow>
          <Text style={t.text('displayS')}>Resume {displayWorkoutName(activeWorkout.customName, activeWorkout.dayName)}</Text>
          <Text style={[t.text('bodyS', 'textMuted'), { marginTop: space[1], marginBottom: space[4] }]}>
            {activeWorkout.completedSets} set{activeWorkout.completedSets === 1 ? '' : 's'} logged · Started {startedLabel(activeWorkout.startedAt)}
          </Text>
          <Button title="Resume workout" onPress={resumeWorkout} />
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
                  accessibilityRole="radio"
                  accessibilityLabel={`${r.label} readiness override`}
                  accessibilityState={{ selected: active }}
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={hasDailyCheckIn ? 'Update daily check-in' : 'Open daily check-in'}
            onPress={() => router.push('/check-in')}
            style={({ pressed }) => ({
              minHeight: 44,
              borderTopWidth: 1,
              borderTopColor: t.colors.borderHairline,
              paddingTop: space[3],
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: space[3],
              opacity: pressed ? 0.62 : 1,
            })}
          >
            <View style={{ flex: 1 }}>
              <Text style={t.text('bodyM')}>{hasDailyCheckIn ? 'Today’s check-in is logged' : 'Add a daily check-in'}</Text>
              <Text style={t.text('bodyS', 'textMuted')}>Energy, mood, sleep, and soreness</Text>
            </View>
            <Text style={t.text('bodyM', 'textMuted')}>›</Text>
          </Pressable>
        </Card>
      )}

      {day && plan && (
        <Card>
          <Eyebrow>{`Week ${day.week} · Day ${day.dayIndex + 1} of ${day.daysPerWeek}`}</Eyebrow>
          <Text style={t.text('displayM')}>{formatWorkoutDayName(day.name)}</Text>
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
          <View style={{ flexDirection: 'row', gap: space[3], marginTop: space[4] }}>
            <Button
              title={activeWorkout ? 'Resume workout' : 'Start workout'}
              onPress={() => {
                if (activeWorkout) {
                  resumeWorkout();
                  return;
                }
                router.push({ pathname: '/workout', params: { readiness: effectiveReadiness } });
              }}
              style={{ flex: 1 }}
            />
            <Button title="Program" ghost onPress={() => router.push('/program')} style={{ width: 104 }} />
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={bodyWeight?.latestWeight == null
              ? 'Log body weight. No body weight logged.'
              : `Body weight ${Math.round(bodyWeight.latestWeight * 10) / 10} ${bodyWeight.units}. ${bodyWeightDetail(bodyWeight)}`}
            onPress={() => router.push('/check-in')}
            style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.7 : 1 })}
          >
            <Card style={{ flex: 1 }}>
              <Eyebrow>Body weight</Eyebrow>
              <Text style={t.text('heroNumXL')}>
                {bodyWeight?.latestWeight == null ? '—' : Math.round(bodyWeight.latestWeight * 10) / 10}
                {bodyWeight?.latestWeight != null && (
                  <Text style={t.text('bodyS', 'textMuted')}> {bodyWeight.units}</Text>
                )}
              </Text>
              <Text style={[t.text('bodyS', bodyWeight?.latestWeight == null ? 'textMuted' : 'dataBlue'), { fontWeight: '600' }]}>
                {bodyWeightDetail(bodyWeight)}
              </Text>
            </Card>
          </Pressable>
        </View>
      )}

      {!needsSetup && subscription.hasPremiumAccess && (
        <Pressable onPress={() => router.push('/review')} style={({ pressed }) => ({ opacity: pressed ? 0.68 : 1 })}>
          <Teaser
            marker="+"
            title="Your weekly review is ready."
            detail="A few wins, one thing to watch, and a cleaner plan for next week."
          />
        </Pressable>
      )}

      {!needsSetup && shouldShowConversionTeaser(completedWorkouts, subscription.hasPremiumAccess) && (
        <Pressable onPress={() => router.push('/paywall')} style={({ pressed }) => ({ opacity: pressed ? 0.68 : 1 })}>
          <Teaser
            marker="+"
            title="Your coach has enough context."
            detail={`${completedWorkouts} workouts logged. See the trends and weekly review Atrium can build from them.`}
          />
        </Pressable>
      )}
    </ScreenScroll>
  );
}
