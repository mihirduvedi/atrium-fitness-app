import { exerciseCatalog } from '@atrium/engine';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useApp } from '@/AppContext';
import { Card, Eyebrow, ScreenCenter, ScreenScroll } from '@/components/ui';
import { getWorkoutSummary, type WorkoutSummaryData } from '@/db/queries';
import { borderWidth, layout, radius, space, useTheme } from '@/theme';
import { displayWorkoutName } from '@/workoutNames';

type SessionSet = WorkoutSummaryData['sets'][number];

interface ExerciseGroup {
  exerciseId: string;
  sets: SessionSet[];
}

const MOODS = ['😫', '😕', '🙂', '💪', '🔥'];

const PR_LABEL: Record<string, string> = {
  weight: 'Heaviest set',
  reps_at_weight: 'Most reps',
  e1rm: 'Estimated 1RM',
  session_volume: 'Session volume',
};

function fullDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function durationLabel(seconds: number) {
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours} hr` : `${hours}h ${remainder}m`;
}

function readinessLabel(score: number | null) {
  if (score === null) return 'Not logged';
  if (score >= 80) return 'Ready';
  if (score >= 60) return 'Worn';
  return 'Rough';
}

function recordValue(type: string, value: number) {
  const rounded = Math.round(value * 10) / 10;
  return type === 'reps_at_weight' ? `${rounded} reps` : `${rounded} lb`;
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
      <Text numberOfLines={1} adjustsFontSizeToFit style={t.text('heroNumL')}>{value}</Text>
      <Text style={t.text('labelCaps', 'textMuted')}>{label}</Text>
    </View>
  );
}

function ExerciseCard({ group }: { group: ExerciseGroup }) {
  const t = useTheme();
  const workingSets = group.sets.filter((set) => !set.is_warmup);
  const volume = workingSets.reduce((sum, set) => sum + (set.weight ?? 0) * (set.reps ?? 0), 0);
  let warmupNumber = 0;
  let workingNumber = 0;

  return (
    <Card style={{ paddingVertical: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${exerciseCatalog[group.exerciseId]?.name ?? group.exerciseId}`}
        onPress={() => router.push(`/exercise/${group.exerciseId}`)}
        style={({ pressed }) => ({
          minHeight: 56,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space[3],
          opacity: pressed ? 0.62 : 1,
        })}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={t.text('displayS')}>
            {exerciseCatalog[group.exerciseId]?.name ?? group.exerciseId}
          </Text>
          <Text style={t.text('bodyS', 'textMuted')}>
            {workingSets.length} working set{workingSets.length === 1 ? '' : 's'} · {Math.round(volume).toLocaleString()} lb
          </Text>
        </View>
        <Text style={t.text('bodyM', 'textFaint')}>›</Text>
      </Pressable>

      <View
        style={{
          flexDirection: 'row',
          paddingVertical: 7,
          borderTopWidth: borderWidth.hairline,
          borderBottomWidth: borderWidth.hairline,
          borderColor: t.colors.borderHairline,
        }}
      >
        <Text style={[t.text('labelCaps', 'textMuted'), { width: 48 }]}>Set</Text>
        <Text style={[t.text('labelCaps', 'textMuted'), { flex: 1, textAlign: 'right' }]}>Weight</Text>
        <Text style={[t.text('labelCaps', 'textMuted'), { flex: 1, textAlign: 'right' }]}>Reps</Text>
      </View>

      {group.sets.map((set, index) => {
        const label = set.is_warmup ? `W${++warmupNumber}` : String(++workingNumber);
        return (
          <View
            key={`${set.exercise_id}:${set.is_warmup}:${set.set_index}:${set.completed_at}`}
            style={{
              minHeight: 42,
              flexDirection: 'row',
              alignItems: 'center',
              borderTopWidth: index === 0 ? 0 : borderWidth.hairline,
              borderTopColor: t.colors.borderHairline,
              opacity: set.is_warmup ? 0.62 : 1,
            }}
          >
            <Text style={[t.text('dataS', set.is_warmup ? 'textMuted' : 'textPrimary'), { width: 48 }]}>{label}</Text>
            <Text style={[t.text('dataM'), { flex: 1, textAlign: 'right' }]}>
              {set.weight === null ? '—' : Math.round(set.weight * 10) / 10}
            </Text>
            <Text style={[t.text('dataM'), { flex: 1, textAlign: 'right' }]}>{set.reps ?? '—'}</Text>
          </View>
        );
      })}
    </Card>
  );
}

export default function WorkoutHistoryDetailScreen() {
  const t = useTheme();
  const { db } = useApp();
  const params = useLocalSearchParams<{ workoutId: string }>();
  const workoutId = Array.isArray(params.workoutId) ? params.workoutId[0] : params.workoutId;
  const [summary, setSummary] = useState<WorkoutSummaryData | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    if (!workoutId) {
      setSummary(null);
      return () => {
        live = false;
      };
    }
    getWorkoutSummary(db, workoutId)
      .then((next) => {
        if (live) setSummary(next);
      })
      .catch(() => {
        if (live) setSummary(null);
      });
    return () => {
      live = false;
    };
  }, [db, workoutId]);

  const exerciseGroups = useMemo(() => {
    const groups = new Map<string, ExerciseGroup>();
    for (const set of summary?.sets ?? []) {
      const group = groups.get(set.exercise_id) ?? { exerciseId: set.exercise_id, sets: [] };
      group.sets.push(set);
      groups.set(set.exercise_id, group);
    }
    return Array.from(groups.values());
  }, [summary]);

  if (summary === undefined) {
    return (
      <ScreenCenter>
        <Text style={t.text('bodyM', 'textMuted')}>Loading session…</Text>
      </ScreenCenter>
    );
  }

  if (!summary) {
    return (
      <ScreenCenter>
        <Text style={t.text('displayS')}>Session not found.</Text>
        <Pressable onPress={() => router.replace('/(tabs)/progress')} style={{ marginTop: space[3] }}>
          <Text style={t.text('bodyM', 'textMuted')}>‹ Back to Progress</Text>
        </Pressable>
      </ScreenCenter>
    );
  }

  const mood = summary.subjective?.mood;
  const energy = summary.subjective?.energy;
  const sleepQuality = summary.subjective?.sleepQuality;
  const soreness = summary.subjective?.soreness;
  const checkInItems = [
    mood != null ? `Mood ${MOODS[mood - 1] ?? `${mood}/5`}` : null,
    energy != null ? `Energy ${energy}/5` : null,
    sleepQuality != null ? `Sleep quality ${sleepQuality}/5` : null,
    soreness != null ? `Soreness ${soreness}/5` : null,
  ].filter((item): item is string => item !== null);

  return (
    <ScreenScroll>
      <View style={{ paddingTop: space[2], paddingRight: 48, paddingBottom: space[3] }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Progress"
          onPress={() => router.replace('/(tabs)/progress')}
          hitSlop={8}
          style={({ pressed }) => ({ alignSelf: 'flex-start', opacity: pressed ? 0.58 : 1 })}
        >
          <Text style={t.text('bodyS', 'textMuted')}>‹ Progress</Text>
        </Pressable>
        <View style={{ marginTop: space[5] }}>
          <Eyebrow>Training log</Eyebrow>
          <Text style={t.text('screenTitle')}>
            {displayWorkoutName(summary.customName, summary.dayName)}
          </Text>
          <Text style={[t.text('bodyM', 'textMuted'), { marginTop: space[1] }]}>{fullDate(summary.startedAt)}</Text>
          <Text style={t.text('bodyS', 'textFaint')}>{timeLabel(summary.startedAt)}</Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: layout.statTileGutter }}>
        <Metric label="Duration" value={durationLabel(summary.durationS)} />
        <Metric label="Volume" value={`${Math.round(summary.totalVolume).toLocaleString()} lb`} />
        <Metric label="Sets" value={String(summary.totalSets)} />
      </View>

      <Card>
        <Eyebrow>Session readiness</Eyebrow>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space[2] }}>
          <Text style={t.text('heroNumXL')}>{summary.readinessAtStart ?? '—'}</Text>
          <Text style={t.text('bodyM', 'textMuted')}>{readinessLabel(summary.readinessAtStart)}</Text>
        </View>
        {checkInItems.length > 0 && (
          <Text style={[t.text('bodyM', 'textMuted'), { marginTop: space[2] }]}>
            Felt afterward: {checkInItems.join(' · ')}
          </Text>
        )}
        {checkInItems.length === 0 && (
          <Text style={[t.text('bodyS', 'textMuted'), { marginTop: space[1] }]}>No post-workout check-in was saved.</Text>
        )}
      </Card>

      {summary.records.length > 0 && (
        <Card stamp>
          <Eyebrow coral>Personal records</Eyebrow>
          {summary.records.map((record, index) => (
            <View
              key={`${record.exerciseId}:${record.type}:${record.achievedAt}`}
              style={{
                minHeight: 52,
                flexDirection: 'row',
                alignItems: 'center',
                gap: space[3],
                borderTopWidth: index === 0 ? 0 : borderWidth.hairline,
                borderTopColor: t.colors.borderHairline,
              }}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={t.text('bodyM')}>
                  {exerciseCatalog[record.exerciseId]?.name ?? record.exerciseId}
                </Text>
                <Text style={t.text('bodyS', 'textMuted')}>{PR_LABEL[record.type] ?? record.type}</Text>
              </View>
              <Text style={t.text('dataM')}>{recordValue(record.type, record.value)}</Text>
            </View>
          ))}
        </Card>
      )}

      <View style={{ paddingHorizontal: 2 }}>
        <Eyebrow>Exercises</Eyebrow>
        <Text style={t.text('displayS')}>
          {exerciseGroups.length} movement{exerciseGroups.length === 1 ? '' : 's'}
        </Text>
      </View>

      {exerciseGroups.map((group) => <ExerciseCard key={group.exerciseId} group={group} />)}

      {exerciseGroups.length === 0 && (
        <Card>
          <Text style={t.text('bodyM', 'textMuted')}>No completed sets were saved for this session.</Text>
        </Card>
      )}
    </ScreenScroll>
  );
}
