import { exerciseCatalog, type Readiness, type SessionPlan } from '@atrium/engine';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useApp } from '@/AppContext';
import { Card, Eyebrow, ScreenCenter, ScreenScroll, Teaser } from '@/components/ui';
import {
  finishWorkout,
  getActiveProgram,
  getNextProgramDay,
  getPreviousSession,
  logSet,
  planSession,
  startWorkout,
  type NextDay,
} from '@/db/queries';
import { borderWidth, radius, space, useTheme } from '@/theme';

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
  const first = p.sets[0];
  if (!first) return '';
  if (first.targetSeconds !== undefined) return `${p.sets.length} × ${first.targetSeconds}s`;
  return first.targetReps[0] === first.targetReps[1]
    ? `${p.sets.length} × ${first.targetReps[0]}`
    : `${p.sets.length} × ${first.targetReps[0]}-${first.targetReps[1]}`;
}

export default function WorkoutScreen() {
  const t = useTheme();
  const { db, userId, newId, sync } = useApp();
  const params = useLocalSearchParams<{ readiness?: Readiness }>();

  const [day, setDay] = useState<NextDay | null>(null);
  const [plan, setPlan] = useState<SessionPlan | null>(null);
  const [workoutId, setWorkoutId] = useState<string | null>(null);
  const [ghosts, setGhosts] = useState<Record<string, Ghost[]>>({});
  const [setUi, setSetUi] = useState<Record<string, SetUiState>>({});
  const [elapsed, setElapsed] = useState(0);
  const [rest, setRest] = useState<number | null>(null);
  const restTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // boot: plan the session against current history, then open the workout row
  useEffect(() => {
    let live = true;
    (async () => {
      const program = await getActiveProgram(db, userId);
      if (!program) return;
      const next = await getNextProgramDay(db, program.id);
      if (!next) return;
      const p = await planSession(db, userId, next, newId, params.readiness ?? 'green');
      const wid = await startWorkout(db, userId, next.dayId, newId);

      const g: Record<string, Ghost[]> = {};
      for (const presc of p.prescriptions) {
        g[presc.slotId] = await getPreviousSession(db, userId, presc.exerciseId, wid);
      }
      const ui: Record<string, SetUiState> = {};
      for (const presc of p.prescriptions)
        for (const s of presc.sets) {
          ui[`${presc.slotId}:${s.setIndex}`] = {
            weight: s.weight !== undefined ? String(s.weight) : '',
            reps: String(s.targetSeconds ?? s.targetReps[1]),
            done: false,
          };
        }
      if (!live) return;
      setDay(next);
      setPlan(p);
      setWorkoutId(wid);
      setGhosts(g);
      setSetUi(ui);
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // session clock
  useEffect(() => {
    const iv = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  const startRest = (seconds: number) => {
    if (restTimer.current) clearInterval(restTimer.current);
    setRest(seconds);
    restTimer.current = setInterval(() => {
      setRest((r) => {
        if (r === null || r <= 1) {
          if (restTimer.current) clearInterval(restTimer.current);
          return null;
        }
        return r - 1;
      });
    }, 1000);
  };

  // durable per-set write: one transaction per check — a crash loses nothing
  const checkSet = async (slotId: string, exerciseId: string, setIndex: number, rest_s: number) => {
    if (!workoutId) return;
    const key = `${slotId}:${setIndex}`;
    const ui = setUi[key];
    if (!ui || ui.done) return;
    await logSet(db, {
      workoutId,
      exerciseId,
      setIndex,
      weight: ui.weight === '' ? null : Number(ui.weight),
      reps: ui.reps === '' ? null : Number(ui.reps),
    }, newId);
    setSetUi((prev) => ({ ...prev, [key]: { ...ui, done: true } }));
    startRest(rest_s);
    sync?.sync().catch(() => {}); // opportunistic; offline just queues
  };

  const finish = async () => {
    if (!workoutId) return;
    await finishWorkout(db, workoutId, newId);
    sync?.sync().catch(() => {});
    router.replace({ pathname: '/summary', params: { workoutId } });
  };

  if (!plan || !day) {
    return (
      <ScreenCenter>
        <Text style={t.text('bodyM', 'textMuted')}>Planning session…</Text>
      </ScreenCenter>
    );
  }

  const active = plan.prescriptions[0];
  const upNext = plan.prescriptions.slice(1);
  const activeExercise = active ? exerciseCatalog[active.exerciseId] : null;
  const activeGhosts = active ? ghosts[active.slotId] ?? [] : [];
  const activeLast =
    activeGhosts.length > 0
      ? `Last session: ${activeGhosts[0]!.weight ?? '—'} lb × ${activeGhosts.map((x) => x.reps ?? '—').join(', ')}`
      : 'First time — engine will learn from today';

  return (
    <View style={{ flex: 1 }}>
      <ScreenScroll>
        <View style={{ paddingHorizontal: 2, paddingTop: space[2], paddingBottom: space[3], flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: space[3] }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} adjustsFontSizeToFit style={t.text('screenTitle')}>{day.name}</Text>
            <Text style={t.text('dataS', 'textFaint')}>{fmtClock(elapsed)}</Text>
          </View>
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

        {active && (
          <Card>
            <Pressable onPress={() => router.push({ pathname: '/exercise/[id]', params: { id: active.exerciseId } })}>
              <Text style={t.text('displayS')}>{activeExercise?.name ?? active.exerciseId}</Text>
            </Pressable>
            <Text style={[t.text('bodyS', 'textMuted'), { marginTop: 3, marginBottom: 13 }]}>
              {activeExercise?.equipment} · {activeLast}
              {active.note ? ` · ${active.note}` : ''}
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
                  <Text style={[t.text('dataS', 'textFaint'), { width: 26 }]}>
                    {s.kind === 'top' ? 'T' : s.setIndex + 1}
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
                    editable={!ui.done}
                    keyboardType="decimal-pad"
                    onChangeText={(v) => setSetUi((prev) => ({ ...prev, [key]: { ...ui, weight: v } }))}
                    style={[
                      t.text('dataM'),
                      { flex: 1, minWidth: 0, height: 36, textAlign: 'center', backgroundColor: t.colors.bgSurface2, borderRadius: radius.control },
                    ]}
                  />
                  <TextInput
                    value={ui.reps}
                    editable={!ui.done}
                    keyboardType="number-pad"
                    onChangeText={(v) => setSetUi((prev) => ({ ...prev, [key]: { ...ui, reps: v } }))}
                    style={[
                      t.text('dataM'),
                      { flex: 1, minWidth: 0, height: 36, textAlign: 'center', backgroundColor: t.colors.bgSurface2, borderRadius: radius.control },
                    ]}
                  />
                  <Pressable
                    onPress={() => checkSet(active.slotId, active.exerciseId, s.setIndex, active.rest_s)}
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

        {upNext.length > 0 && (
          <Card style={{ opacity: 0.82 }}>
            <Eyebrow>Up next</Eyebrow>
            {upNext.map((p, i) => (
              <View
                key={p.slotId}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  gap: space[3],
                  paddingVertical: 11,
                  borderTopWidth: i === 0 ? 0 : borderWidth.hairline,
                  borderTopColor: t.colors.borderHairline,
                }}
              >
                <Text style={[t.text('bodyM'), { flex: 1 }]} numberOfLines={1}>
                  {exerciseCatalog[p.exerciseId]?.name ?? p.exerciseId}
                </Text>
                <Text style={t.text('dataS', 'textMuted')}>{formatSets(p)}</Text>
              </View>
            ))}
          </Card>
        )}

        <Teaser
          marker="+"
          title="No rack free?"
          detail="Tap any exercise later to swap in an equivalent movement."
        />
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
