import { useFocusEffect, router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useApp } from '@/AppContext';
import { buildCoachContextPack, formatCompactNumber, formatDelta, type CoachContextPack } from '@/coach/context';
import { coachDeviceDateKey } from '@/coach/adaptation';
import { Button, Card, Eyebrow, ScreenScroll } from '@/components/ui';
import { PremiumFeatureScreen } from '@/subscriptions/PremiumFeatureScreen';
import { canAccessSubscriptionFeature } from '@/subscriptions/subscription';
import { borderWidth, radius, space, useTheme } from '@/theme';
import { displayWorkoutName } from '@/workoutNames';

function headlineFor(pack: CoachContextPack) {
  if (pack.adaptation?.deload.deload) return 'A lower-stress session is ready.';
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
  if (pack.adaptation?.deload.deload) {
    return {
      title: 'Watch-out: training strain crossed a deload rule.',
      body: pack.adaptation.reasonLabel ?? 'The engine found a bounded one-session deload signal.',
    };
  }
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
  const prescription = pack.adaptation?.deload.deload
    ? pack.adaptation.deload.prescription
    : null;
  const volume = prescription
    ? `Target ~${Math.abs(prescription.volumePct)}% fewer working sets`
    : pack.readiness.readiness === 'green'
      ? 'Keep planned sets'
      : 'Trim only if warmups drag';
  return [
    { label: next, detail: pack.program?.nextWeek ? `Program week ${pack.program.nextWeek}` : 'Active target' },
    { label: 'Back-off volume', detail: volume },
    {
      label: 'Load changes',
      detail: prescription
        ? `~${Math.abs(prescription.intensityPct)}% lower · plate-rounded`
        : 'Earned by logged reps',
    },
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

  const latestPr = pack.prSignals.find((signal) => {
    const achieved = coachDeviceDateKey(signal.achievedAt);
    return achieved >= pack.week.startDate && achieved <= pack.week.endDate;
  });
  const lastWorkout = pack.recentWorkouts[0];
  const deload = pack.adaptation?.deload.deload ? pack.adaptation : null;
  const deloadPrescription = deload?.deload.prescription ?? null;
  const deloadActionCopy = pack.actionState.activeProposalKind === 'deload_session'
    ? 'This Coach deload is already active. Continue in Coach to resume the workout.'
    : pack.actionState.hasActiveWorkout
      ? 'Finish or discard the active workout first. Coach will recheck this signal before offering another draft.'
      : pack.readiness.readiness === 'red'
        ? 'Recovery is currently red, so Coach will not offer a workout action. Recheck after recovery improves.'
        : 'Ask Coach about today’s workout to review this draft. Apply still rechecks the live plan, readiness, and signal.';

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

      {deload && (
        <Card>
          <Eyebrow>Engine adaptation · one workout</Eyebrow>
          <Text accessibilityRole="header" style={t.text('displayS')}>Deload without rewriting your Program.</Text>
          <Text style={t.text('bodyM', 'textMuted')}>{deload.reasonLabel}</Text>
          <View
            accessible
            accessibilityLabel={`One-session deload. Working-set target about ${Math.abs(deloadPrescription?.volumePct ?? 40)} percent lower. Loads about ${Math.abs(deloadPrescription?.intensityPct ?? 10)} percent lower after plate rounding. Top sets removed. Program unchanged.`}
            style={{
              marginTop: space[2],
              borderTopWidth: borderWidth.hairline,
              borderBottomWidth: borderWidth.hairline,
              borderColor: t.colors.borderHairline,
            }}
          >
            {[
              ['Working sets', `Target ~−${Math.abs(deloadPrescription?.volumePct ?? 40)}%`],
              ['Working loads', `~−${Math.abs(deloadPrescription?.intensityPct ?? 10)}% · rounded`],
              ['Top sets', deloadPrescription?.dropTopSets ? 'Removed' : 'Unchanged'],
            ].map(([label, value], index) => (
              <View
                key={label}
                style={{
                  minHeight: 44,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: space[3],
                  borderTopWidth: index === 0 ? 0 : borderWidth.hairline,
                  borderTopColor: t.colors.borderHairline,
                }}
              >
                <Text style={t.text('bodyM')}>{label}</Text>
                <Text style={[t.text('bodyM'), { color: t.colors.dataCoral }]}>{value}</Text>
              </View>
            ))}
          </View>
          <Text style={t.text('bodyS', 'textMuted')}>
            {deloadActionCopy}
          </Text>
        </Card>
      )}

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
        title="Continue in Coach"
        onPress={() => router.replace('/(tabs)/coach')}
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
