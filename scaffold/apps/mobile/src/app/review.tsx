import { useFocusEffect, router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useApp } from '@/AppContext';
import { buildCoachContextPack, formatCompactNumber, formatDelta, type CoachContextPack } from '@/coach/context';
import { Button, Card, Eyebrow, ScreenScroll } from '@/components/ui';
import { PremiumFeatureScreen } from '@/subscriptions/PremiumFeatureScreen';
import { canAccessSubscriptionFeature } from '@/subscriptions/subscription';
import { borderWidth, radius, space, useTheme } from '@/theme';
import { displayWorkoutName } from '@/workoutNames';

function headlineFor(pack: CoachContextPack) {
  if (pack.week.workouts === 0) return 'Your review is waiting on logged sessions.';
  const volume = pack.week.previousWorkouts > 0
    ? `volume ${formatDelta(pack.week.volumeDeltaPct)}`
    : 'new weekly baseline';
  const recovery = pack.readiness.score >= 72
    ? 'recovery holding'
    : pack.readiness.score >= 58
      ? 'recovery mixed'
      : 'recovery needs space';
  return `${pack.week.workouts} sessions, ${volume}, ${recovery}.`;
}

function dayLabel(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function consistencyText(pack: CoachContextPack) {
  const planned = pack.week.plannedWorkouts;
  if (!planned) return `${pack.week.workouts} sessions completed this week.`;
  return `${pack.week.workouts} of ${planned} planned sessions completed.`;
}

function watchOut(pack: CoachContextPack) {
  if (pack.week.workouts === 0) {
    return {
      title: 'Watch-out: no logged signal yet.',
      body: 'The coach can scaffold next week, but real adjustments need completed working sets.',
    };
  }
  if (pack.readiness.readiness !== 'green') {
    return {
      title: 'Watch-out: recovery is the limiter.',
      body: pack.readiness.body,
    };
  }
  if (pack.week.volumeDeltaPct != null && pack.week.volumeDeltaPct < -15) {
    return {
      title: 'Watch-out: volume dipped.',
      body: 'Treat the next session as a clean rebuild before chasing a bigger jump.',
    };
  }
  return {
    title: 'Watch-out: keep jumps earned.',
    body: 'The log supports steady progress, but load changes should still come from completed reps, not optimism.',
  };
}

function planRows(pack: CoachContextPack) {
  const next = pack.program?.nextDayName ?? 'Next lift';
  const volume = pack.readiness.readiness === 'green' ? 'Keep planned sets' : 'Trim only if warmups drag';
  return [
    { label: next, detail: pack.program?.nextWeek ? `Program week ${pack.program.nextWeek}` : 'Active target' },
    { label: 'Back-off volume', detail: volume },
    { label: 'Load changes', detail: 'Earned by logged reps' },
  ];
}

function Metric({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View
      style={{
        flex: 1,
        minHeight: 76,
        borderRadius: radius.card,
        borderWidth: borderWidth.hairline,
        borderColor: t.colors.borderHairline,
        backgroundColor: t.colors.bgSurface,
        padding: space[3],
        justifyContent: 'space-between',
      }}
    >
      <Text style={t.text('labelCaps', 'textMuted')}>{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit style={t.text('heroNumL')}>
        {value}
      </Text>
    </View>
  );
}

function Highlight({ mark, title, body }: { mark: string; title: string; body: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: space[3], paddingVertical: 10 }}>
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          backgroundColor: t.colors.bgSurface2,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={t.text('bodyM', 'textMuted')}>{mark}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={t.text('bodyM')}>{title}</Text>
        <Text style={t.text('bodyS', 'textMuted')}>{body}</Text>
      </View>
    </View>
  );
}

function WeeklyReviewContent() {
  const t = useTheme();
  const { db, userId } = useApp();
  const [pack, setPack] = useState<CoachContextPack | null>(null);
  const [applied, setApplied] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      buildCoachContextPack(db, userId).then((nextPack) => {
        if (live) setPack(nextPack);
      });
      return () => {
        live = false;
      };
    }, [db, userId]),
  );

  const watch = useMemo(() => (pack ? watchOut(pack) : null), [pack]);
  const rows = useMemo(() => (pack ? planRows(pack) : []), [pack]);

  if (!pack || !watch) {
    return (
      <ScreenScroll>
        <Text style={t.text('bodyM', 'textMuted')}>Building review...</Text>
      </ScreenScroll>
    );
  }

  const latestPr = pack.prSignals[0];
  const lastWorkout = pack.recentWorkouts[0];

  return (
    <ScreenScroll>
      <Pressable
        onPress={() => router.replace('/(tabs)/coach')}
        style={({ pressed }) => ({ opacity: pressed ? 0.62 : 1, alignSelf: 'flex-start' })}
      >
        <Text style={t.text('bodyM', 'textMuted')}>‹ Coach</Text>
      </Pressable>

      <View style={{ paddingTop: space[1], paddingBottom: space[2] }}>
        <Eyebrow>{`Weekly review · ${pack.week.label}`}</Eyebrow>
        <Text style={t.text('screenTitle')}>{headlineFor(pack)}</Text>
        <Text style={[t.text('bodyM', 'textMuted'), { marginTop: space[2] }]}>
          Grounded in {pack.recentWorkouts.length} recent sessions, {pack.prSignals.length} PR signals, and today's recovery read.
        </Text>
      </View>

      <View style={{ flexDirection: 'row', gap: space[3] }}>
        <Metric label="Sessions" value={String(pack.week.workouts)} />
        <Metric label="Volume" value={`${formatCompactNumber(pack.week.volume)} ${pack.profile?.units ?? 'lb'}`} />
        <Metric label="Recovery" value={String(pack.week.averageReadiness ?? pack.readiness.score)} />
      </View>

      <Card>
        <Eyebrow>Highlights</Eyebrow>
        <Highlight mark="+" title={consistencyText(pack)} body={`${pack.week.sets} working sets logged.`} />
        <Highlight
          mark="PR"
          title={latestPr ? `${latestPr.exerciseName}: ${latestPr.displayValue}` : 'No new PR signal yet.'}
          body={latestPr ? latestPr.label : 'Finish summaries to seed stronger review notes.'}
        />
        <Highlight
          mark="R"
          title={`${pack.readiness.title} · ${pack.readiness.score}`}
          body={pack.readiness.body}
        />
      </Card>

      <Card stamp>
        <Highlight mark="!" title={watch.title} body={watch.body} />
      </Card>

      <Card>
        <Eyebrow>Next week</Eyebrow>
        {rows.map((row, index) => (
          <View
            key={row.label}
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              gap: space[3],
              paddingVertical: 11,
              borderTopWidth: index === 0 ? 0 : borderWidth.hairline,
              borderTopColor: t.colors.borderHairline,
            }}
          >
            <Text style={[t.text('bodyM'), { flex: 1 }]}>{row.label}</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit style={t.text('dataS', 'textMuted')}>
              {row.detail}
            </Text>
          </View>
        ))}
      </Card>

      <Card>
        <Eyebrow>Review signals</Eyebrow>
        <View style={{ gap: 9 }}>
          {pack.facts.map((fact) => (
            <Text key={fact} style={t.text('bodyM', 'textMuted')}>
              {fact}
            </Text>
          ))}
          {lastWorkout && (
            <Text style={t.text('bodyM')}>
              Last logged: {displayWorkoutName(null, lastWorkout.dayName)} on {dayLabel(lastWorkout.startedAt)}.
            </Text>
          )}
        </View>
      </Card>

      <Button
        title={applied ? 'Reviewed' : 'Mark reviewed'}
        onPress={() => setApplied(true)}
        disabled={applied}
      />
    </ScreenScroll>
  );
}

export default function WeeklyReviewScreen() {
  const { subscription } = useApp();
  if (!canAccessSubscriptionFeature('weekly_review', subscription.hasPremiumAccess)) {
    return (
      <PremiumFeatureScreen
        eyebrow="Atrium Premium"
        title="Your week, read clearly."
        detail="Unlock a weekly review of consistency, progress, recovery, and the next useful adjustment."
        onBack={() => router.replace('/(tabs)/coach')}
      />
    );
  }
  return <WeeklyReviewContent />;
}
