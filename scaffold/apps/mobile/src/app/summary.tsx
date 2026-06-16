import { detectPRs, exerciseCatalog, type PR } from '@atrium/engine';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { canUpgradeWithApple, isAnonymous, upgradeWithApple } from '@/auth';
import { useApp } from '@/AppContext';
import { Button, Card, Eyebrow, ScreenCenter, ScreenScroll, SummaryStatTile } from '@/components/ui';
import {
  getHistory,
  getWorkoutSummary,
  savePersonalRecord,
  saveSubjectiveTag,
  type WorkoutSummaryData,
} from '@/db/queries';
import { layout, radius, space, useTheme } from '@/theme';

const MOODS = ['😫', '😕', '🙂', '💪', '🔥'];

const PR_LABEL: Record<PR['type'], string> = {
  weight: 'Heaviest set',
  reps_at_weight: 'Most reps at weight',
  e1rm: 'Estimated 1RM',
  session_volume: 'Session volume',
};

const fmtDuration = (s: number) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export default function SummaryScreen() {
  const t = useTheme();
  const { db, userId, newId, sync } = useApp();
  const { workoutId } = useLocalSearchParams<{ workoutId: string }>();

  const [summary, setSummary] = useState<WorkoutSummaryData | null>(null);
  const [prs, setPrs] = useState<PR[]>([]);
  const [mood, setMood] = useState<number | null>(null);
  const [showApple, setShowApple] = useState(false);
  const [appleResult, setAppleResult] = useState<string | null>(null);

  useEffect(() => {
    if (!workoutId) return;
    let live = true;
    (async () => {
      const s = await getWorkoutSummary(db, workoutId);
      if (!s || !live) return;

      // real PRs via the engine, persisted once (skip if already stamped)
      const history = await getHistory(db, userId);
      const date = s.startedAt.slice(0, 10);
      const found = detectPRs(
        { workoutId, date, sets: history.filter((x) => x.sessionDate === date) },
        history,
      );
      const existing = await db.getFirstAsync<{ n: number }>(
        'select count(*) as n from personal_records where workout_id = ? and deleted_at is null',
        workoutId,
      );
      if ((existing?.n ?? 0) === 0) {
        for (const pr of found) {
          await savePersonalRecord(db, { userId, exerciseId: pr.exerciseId, type: pr.type, value: pr.value, workoutId }, newId);
        }
      }
      if (!live) return;
      setSummary(s);
      setPrs(found);
      // deferred-account CTA appears after the first COMPLETED workout (Part G)
      setShowApple((await isAnonymous()) && (await canUpgradeWithApple()));
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workoutId]);

  const pickMood = async (i: number) => {
    setMood(i);
    if (!workoutId) return;
    // 1-indexed: energy + mood share the single picker for now
    await saveSubjectiveTag(db, { userId, workoutId, energy: i + 1, mood: i + 1 }, newId);
  };

  const done = () => {
    sync?.sync().catch(() => {});
    router.dismissAll();
    router.replace('/(tabs)/today');
  };

  if (!summary) {
    return (
      <ScreenCenter>
        <Text style={t.text('bodyM', 'textMuted')}>Crunching numbers…</Text>
      </ScreenCenter>
    );
  }

  return (
    <ScreenScroll>
      <View style={{ alignItems: 'center', paddingTop: space[7], paddingBottom: space[5] }}>
        <Eyebrow>Workout complete</Eyebrow>
        <Text style={t.text('screenTitle')}>
          {prs.length > 0 ? 'Strong session.' : 'Logged. Onward.'}
        </Text>
        {summary.dayName && (
          <Text style={[t.text('bodyS', 'textMuted'), { marginTop: space[1] }]}>{summary.dayName}</Text>
        )}
      </View>

      {prs.map((pr) => (
        <Card key={`${pr.exerciseId}:${pr.type}`} stamp>
          <Eyebrow coral>★ New personal record</Eyebrow>
          <Text style={t.text('displayS')}>
            {exerciseCatalog[pr.exerciseId]?.name ?? pr.exerciseId} · {PR_LABEL[pr.type]}
          </Text>
          <Text style={[t.text('bodyM', 'textMuted'), { marginTop: space[1] }]}>
            {pr.previous !== undefined ? `${pr.previous} → ` : ''}
            <Text style={t.text('dataM')}>{pr.value}</Text>
            {pr.type === 'session_volume' || pr.type === 'weight' || pr.type === 'e1rm' ? ' lb' : ' reps'}
          </Text>
        </Card>
      ))}

      <View style={{ flexDirection: 'row', gap: layout.statTileGutter }}>
        <SummaryStatTile value={fmtDuration(summary.durationS)} label="Duration" />
        <SummaryStatTile value={summary.totalVolume.toLocaleString()} label="Volume (lb)" />
        <SummaryStatTile value={String(summary.totalSets)} label="Sets" />
      </View>

      <Card>
        <Eyebrow>How did that feel?</Eyebrow>
        <View style={{ flexDirection: 'row', gap: space[2] }}>
          {MOODS.map((m, i) => (
            <Pressable
              key={m}
              onPress={() => pickMood(i)}
              style={{
                flex: 1,
                height: 44,
                borderRadius: radius.control,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: mood === i ? t.colors.bgSurface2 : 'transparent',
                borderWidth: 1,
                borderColor: mood === i ? t.colors.borderStrong : t.colors.borderHairline,
              }}
            >
              <Text style={{ fontSize: 20 }}>{m}</Text>
            </Pressable>
          ))}
        </View>
      </Card>

      {showApple && (
        <Card>
          <Eyebrow>Keep this forever</Eyebrow>
          <Text style={[t.text('bodyM'), { marginBottom: space[3] }]}>
            Your training lives on this phone and syncs anonymously. Sign in with Apple to keep it
            if you ever switch devices — same data, nothing moves.
          </Text>
          <Button
            title=" Sign in with Apple"
            onPress={async () => {
              const r = await upgradeWithApple();
              setAppleResult(r.ok ? 'Signed in — your account is permanent now.' : r.reason ?? 'Could not sign in.');
              if (r.ok) setShowApple(false);
            }}
          />
          {appleResult && (
            <Text style={[t.text('bodyS', 'textMuted'), { marginTop: space[2] }]}>{appleResult}</Text>
          )}
        </Card>
      )}

      <Button title="Done" onPress={done} />
    </ScreenScroll>
  );
}
