import { useFocusEffect, router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useApp } from '@/AppContext';
import { buildCoachContextPack, formatCompactNumber, type CoachContextPack, type CoachPrSignal } from '@/coach/context';
import { Card, Eyebrow, ScreenScroll } from '@/components/ui';
import { borderWidth, radius, space, useTheme } from '@/theme';

type PromptKey = 'stuck' | 'travel' | 'tired' | 'harder';

const PROMPTS: { key: PromptKey; label: string }[] = [
  { key: 'stuck', label: 'Why am I stuck?' },
  { key: 'travel', label: "I'm traveling next week" },
  { key: 'tired', label: 'Feeling run down' },
  { key: 'harder', label: 'Make next workout harder' },
];

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

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

function latestPrText(pr: CoachPrSignal | undefined) {
  if (!pr) return 'No PRs yet. Finish a few summaries and I will have more to work with.';
  return `${pr.exerciseName} is the latest signal: ${pr.displayValue} ${pr.label.toLowerCase()}.`;
}

function answerFor(key: PromptKey, pack: CoachContextPack | null) {
  const recent = pack?.recentWorkouts[0];
  const previous = pack?.recentWorkouts[1];
  const volumeDelta = recent && previous ? recent.volume - previous.volume : 0;
  const next = pack?.program?.nextDayName ?? 'your next lift';
  if (key === 'stuck') {
    return pack?.prSignals[0]
      ? `It does not look stuck yet. ${latestPrText(pack.prSignals[0])} If the next two sessions flatten, I would deload the top set before changing exercises.`
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
  const [pack, setPack] = useState<CoachContextPack | null>(null);
  const [prompt, setPrompt] = useState<PromptKey>('stuck');

  useFocusEffect(
    useCallback(() => {
      let live = true;
      buildCoachContextPack(db, userId).then((contextPack) => {
        if (live) setPack(contextPack);
      });
      return () => {
        live = false;
      };
    }, [db, userId]),
  );

  const last = pack?.recentWorkouts[0];
  const reply = useMemo(() => answerFor(prompt, pack), [prompt, pack]);
  const selectedPrompt = PROMPTS.find((p) => p.key === prompt) ?? PROMPTS[0]!;
  const pinCaption = pack && pack.week.workouts > 0
    ? `${formatCompactNumber(pack.week.volume)} ${pack.profile?.units ?? 'lb'} this week · ${pack.week.workouts} sessions · ${pack.prSignals.length || 0} PR signals`
    : 'No completed sessions this week yet';

  return (
    <ScreenScroll>
      <View style={{ paddingHorizontal: 2, paddingTop: space[2], paddingBottom: space[2] }}>
        <Eyebrow>Grounded in your log</Eyebrow>
        <Text style={t.text('screenTitle')}>Coach</Text>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
        <Chip>{`${pack?.recentWorkouts.length ?? 0} workouts`}</Chip>
        <Chip>{`${pack?.prSignals.length ?? 0} PR signals`}</Chip>
        <Chip>{pack?.program?.nextWeek ? `Program · W${pack.program.nextWeek}` : 'Program ready'}</Chip>
      </View>

      <Pressable onPress={() => router.push('/review')} style={({ pressed }) => ({ opacity: pressed ? 0.68 : 1 })}>
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space[3] }}>
            <View style={{ flex: 1 }}>
              <Text style={t.text('bodyM')}>Weekly review</Text>
              <Text style={[t.text('bodyS', 'textMuted'), { marginTop: 2 }]}>{pinCaption}</Text>
            </View>
            <Text style={t.text('bodyM', 'textMuted')}>→</Text>
          </View>
        </Card>
      </Pressable>

      <View style={{ gap: space[3] }}>
        <Bubble>
          {last
            ? `Looking at ${last.dayName ?? 'your last workout'} from ${dayLabel(last.startedAt)}: ${formatCompactNumber(last.volume)} ${pack?.profile?.units ?? 'lb'} across ${last.sets} sets. ${latestPrText(pack?.prSignals[0])}`
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
          <Text style={t.text('bodyM')}>{pack?.program?.nextDayName ?? 'Next session'} is the active plan target.</Text>
          <Text style={t.text('bodyM', 'textMuted')}>
            Suggestions stay grounded in your profile, recent log, PRs, recovery, and next plan target.
          </Text>
        </View>
      </Card>
    </ScreenScroll>
  );
}
