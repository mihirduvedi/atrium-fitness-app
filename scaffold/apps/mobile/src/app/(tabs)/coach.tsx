import { exerciseCatalog } from '@atrium/engine';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useApp } from '@/AppContext';
import { Card, Eyebrow, ScreenScroll } from '@/components/ui';
import { getActiveProgram, getNextProgramDay } from '@/db/queries';
import { borderWidth, radius, space, useTheme } from '@/theme';

interface WorkoutRow {
  id: string;
  started_at: string;
  day_name: string | null;
  volume: number;
  sets: number;
}

interface PrRow {
  exercise_id: string;
  type: string;
  value: number;
  achieved_at: string;
}

interface CoachData {
  workouts: WorkoutRow[];
  prs: PrRow[];
  programWeek: number | null;
  nextDayName: string | null;
}

type PromptKey = 'stuck' | 'travel' | 'tired' | 'harder';

const PROMPTS: { key: PromptKey; label: string }[] = [
  { key: 'stuck', label: 'Why am I stuck?' },
  { key: 'travel', label: "I'm traveling next week" },
  { key: 'tired', label: 'Feeling run down' },
  { key: 'harder', label: 'Make next workout harder' },
];

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

const compact = (n: number) =>
  n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(Math.round(n));

function Chip({ children }: { children: string }) {
  const t = useTheme();
  return (
    <View
      style={{
        borderWidth: borderWidth.hairline,
        borderColor: t.colors.borderStrong,
        borderRadius: radius.control,
        paddingHorizontal: 11,
        paddingVertical: 7,
        backgroundColor: t.colors.bgSurface,
      }}
    >
      <Text style={t.text('bodyS', 'textMuted')}>{children}</Text>
    </View>
  );
}

function Bubble({ children, mine }: { children: string; mine?: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{
        maxWidth: '84%',
        alignSelf: mine ? 'flex-end' : 'flex-start',
        backgroundColor: mine ? t.colors.actionInk : t.colors.bgSurface,
        borderWidth: mine ? 0 : borderWidth.hairline,
        borderColor: t.colors.borderHairline,
        borderRadius: radius.card,
        borderBottomRightRadius: mine ? 4 : radius.card,
        borderBottomLeftRadius: mine ? radius.card : 4,
        paddingHorizontal: 15,
        paddingVertical: 13,
      }}
    >
      <Text style={t.text('bodyM', mine ? 'actionOnInk' : 'textPrimary')}>{children}</Text>
    </View>
  );
}

function latestPrText(pr: PrRow | undefined) {
  if (!pr) return 'No PRs yet. Finish a few summaries and I will have more to work with.';
  const exercise = exerciseCatalog[pr.exercise_id]?.name ?? pr.exercise_id;
  const value = `${Math.round(pr.value * 10) / 10}${pr.type === 'reps_at_weight' ? ' reps' : ' lb'}`;
  return `${exercise} is the latest signal: ${value} ${pr.type === 'e1rm' ? 'estimated 1RM' : pr.type.replace('_', ' ')}.`;
}

function answerFor(key: PromptKey, data: CoachData) {
  const recent = data.workouts[0];
  const previous = data.workouts[1];
  const volumeDelta = recent && previous ? recent.volume - previous.volume : 0;
  const next = data.nextDayName ?? 'your next lift';
  if (key === 'stuck') {
    return data.prs[0]
      ? `It does not look stuck yet. ${latestPrText(data.prs[0])} If the next two sessions flatten, I would deload the top set before changing exercises.`
      : `I need a few more completed workouts before I can call a plateau. For now, keep logging actual reps so the trend is real.`;
  }
  if (key === 'travel') {
    return `Keep ${next} intact, then swap unavailable equipment one pattern at a time. Dumbbell press for barbell press, split squat for squat, cable or band rows for rows.`;
  }
  if (key === 'tired') {
    return volumeDelta > 0
      ? `You are coming off a higher-volume session, so I would keep the main lift and trim one back-off set if warmups feel slow.`
      : `Use the rough readiness option today. The goal is to preserve the pattern, not force a PR.`;
  }
  return `I would not auto-increase ${next} yet. If warmups move well, add reps inside the prescribed range first; load jumps should stay with the engine.`;
}

export default function CoachScreen() {
  const t = useTheme();
  const { db, userId } = useApp();
  const [data, setData] = useState<CoachData>({ workouts: [], prs: [], programWeek: null, nextDayName: null });
  const [prompt, setPrompt] = useState<PromptKey>('stuck');

  useFocusEffect(
    useCallback(() => {
      let live = true;
      (async () => {
        const workouts = await db.getAllAsync<WorkoutRow>(
          `select w.id, w.started_at, d.name as day_name,
                  coalesce(sum(coalesce(s.weight, 0) * coalesce(s.reps, 0)), 0) as volume,
                  count(s.id) as sets
             from workouts w
             left join program_days d on d.id = w.program_day_id
             left join sets s on s.workout_id = w.id and s.deleted_at is null and s.is_warmup = 0
            where w.user_id = ? and w.ended_at is not null and w.deleted_at is null
            group by w.id
            having count(s.id) > 0
            order by w.started_at desc
            limit 12`,
          userId,
        );
        const prs = await db.getAllAsync<PrRow>(
          `select exercise_id, type, value, achieved_at
             from personal_records
            where user_id = ? and deleted_at is null
            order by achieved_at desc
            limit 6`,
          userId,
        );
        const program = await getActiveProgram(db, userId);
        const next = program ? await getNextProgramDay(db, program.id) : null;
        const uniquePrs = prs.filter(
          (pr, index, all) => all.findIndex((x) => `${x.exercise_id}:${x.type}` === `${pr.exercise_id}:${pr.type}`) === index,
        );
        if (live) {
          setData({
            workouts,
            prs: uniquePrs,
            programWeek: next?.week ?? program?.current_week ?? null,
            nextDayName: next?.name ?? null,
          });
        }
      })();
      return () => {
        live = false;
      };
    }, [db, userId]),
  );

  const last7Cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const thisWeek = data.workouts.filter((w) => Date.parse(w.started_at) >= last7Cutoff);
  const weekVolume = thisWeek.reduce((sum, w) => sum + w.volume, 0);
  const last = data.workouts[0];
  const reply = useMemo(() => answerFor(prompt, data), [prompt, data]);
  const selectedPrompt = PROMPTS.find((p) => p.key === prompt) ?? PROMPTS[0]!;
  const pinCaption = thisWeek.length > 0
    ? `${compact(weekVolume)} lb this week · ${thisWeek.length} sessions · ${data.prs.length || 0} PR signals`
    : 'No completed sessions this week yet';

  return (
    <ScreenScroll>
      <View style={{ paddingHorizontal: 2, paddingTop: space[2], paddingBottom: space[2] }}>
        <Eyebrow>Grounded in your log</Eyebrow>
        <Text style={t.text('screenTitle')}>Coach</Text>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
        <Chip>{`${data.workouts.length} workouts`}</Chip>
        <Chip>{`${data.prs.length} PR signals`}</Chip>
        <Chip>{data.programWeek ? `Program · W${data.programWeek}` : 'Program ready'}</Chip>
      </View>

      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space[3] }}>
          <View style={{ flex: 1 }}>
            <Text style={t.text('bodyM')}>Weekly review</Text>
            <Text style={[t.text('bodyS', 'textMuted'), { marginTop: 2 }]}>{pinCaption}</Text>
          </View>
          <Text style={t.text('bodyM', 'textMuted')}>→</Text>
        </View>
      </Card>

      <View style={{ gap: space[3] }}>
        <Bubble>
          {last
            ? `Looking at ${last.day_name ?? 'your last workout'} from ${dayLabel(last.started_at)}: ${compact(last.volume)} lb across ${last.sets} sets. ${latestPrText(data.prs[0])}`
            : 'Log a workout and I will start turning your training history into useful guidance.'}
        </Bubble>
        <Bubble mine>{selectedPrompt.label}</Bubble>
        <Bubble>{reply}</Bubble>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: space[2], paddingVertical: space[1] }}
      >
        {PROMPTS.map((p) => {
          const active = p.key === prompt;
          return (
            <Pressable
              key={p.key}
              onPress={() => setPrompt(p.key)}
              style={{
                flexShrink: 0,
                borderRadius: radius.control,
                borderWidth: borderWidth.hairline,
                borderColor: active ? t.colors.borderStrong : t.colors.borderHairline,
                backgroundColor: active ? t.colors.bgSurface2 : t.colors.bgSurface,
                paddingHorizontal: 14,
                paddingVertical: 9,
              }}
            >
              <Text style={t.text('bodyS', active ? 'textPrimary' : 'textMuted')}>{p.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Card>
        <Eyebrow>Coach context</Eyebrow>
        <View style={{ gap: 11 }}>
          <Text style={t.text('bodyM')}>{data.nextDayName ?? 'Next session'} is the active plan target.</Text>
          <Text style={t.text('bodyM', 'textMuted')}>
            Suggestions stay conservative: the coach explains the pattern first, then keeps any load change inside your program rules.
          </Text>
        </View>
      </Card>
    </ScreenScroll>
  );
}
