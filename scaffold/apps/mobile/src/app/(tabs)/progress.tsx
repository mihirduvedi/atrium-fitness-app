import { exerciseCatalog } from '@atrium/engine';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useApp } from '@/AppContext';
import { Card, Eyebrow, ScreenScroll, Teaser } from '@/components/ui';
import { borderWidth, radius, space, useTheme } from '@/theme';

interface WorkoutTrendRow {
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

interface BestLiftRow {
  exercise_id: string;
  e1rm: number;
}

interface ProgressData {
  workouts: WorkoutTrendRow[];
  prs: PrRow[];
  bestLift: BestLiftRow | null;
}

const PR_LABEL: Record<string, string> = {
  weight: 'Heaviest set',
  reps_at_weight: 'Most reps',
  e1rm: 'Est. 1RM',
  session_volume: 'Volume',
};

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

const compact = (n: number) =>
  n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(Math.round(n));

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{
        flex: 1,
        minHeight: 82,
        borderRadius: radius.card,
        borderWidth: borderWidth.hairline,
        borderColor: t.colors.borderHairline,
        padding: space[3],
        justifyContent: 'space-between',
        backgroundColor: accent ? t.colors.bgSurface2 : t.colors.bgSurface,
      }}
    >
      <Text style={t.text('labelCaps', 'textMuted')}>{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit style={t.text('heroNumXL')}>
        {value}
      </Text>
    </View>
  );
}

export default function ProgressScreen() {
  const t = useTheme();
  const { db, userId } = useApp();
  const [data, setData] = useState<ProgressData>({ workouts: [], prs: [], bestLift: null });

  useFocusEffect(
    useCallback(() => {
      let live = true;
      (async () => {
        const workouts = await db.getAllAsync<WorkoutTrendRow>(
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
            limit 8`,
          userId,
        );
        const prs = await db.getAllAsync<PrRow>(
          `select exercise_id, type, value, achieved_at
             from personal_records
            where user_id = ? and deleted_at is null
            order by achieved_at desc
            limit 4`,
          userId,
        );
        const bestLift = await db.getFirstAsync<BestLiftRow>(
          `select s.exercise_id,
                  max(coalesce(s.weight, 0) * (1 + coalesce(s.reps, 0) / 30.0)) as e1rm
             from sets s
             join workouts w on w.id = s.workout_id
            where w.user_id = ? and w.deleted_at is null and s.deleted_at is null
              and s.is_warmup = 0 and s.weight is not null and s.reps is not null
            group by s.exercise_id
            order by e1rm desc
            limit 1`,
          userId,
        );
        const uniquePrs = prs.filter(
          (pr, index, all) => all.findIndex((x) => `${x.exercise_id}:${x.type}` === `${pr.exercise_id}:${pr.type}`) === index,
        );
        if (live) setData({ workouts, prs: uniquePrs, bestLift });
      })();
      return () => {
        live = false;
      };
    }, [db, userId]),
  );

  const last7Cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const thisWeek = data.workouts.filter((w) => Date.parse(w.started_at) >= last7Cutoff);
  const weekVolume = thisWeek.reduce((sum, w) => sum + w.volume, 0);
  const chart = data.workouts.slice().reverse();
  const maxVolume = Math.max(1, ...chart.map((w) => w.volume));

  return (
    <ScreenScroll>
      <View style={{ paddingHorizontal: 2, paddingTop: space[2], paddingBottom: space[4] }}>
        <Eyebrow>Training log</Eyebrow>
        <Text style={t.text('screenTitle')}>Progress</Text>
      </View>

      <View style={{ flexDirection: 'row', gap: space[3] }}>
        <Metric label="7-day volume" value={`${compact(weekVolume)} lb`} accent />
        <Metric label="Sessions" value={String(thisWeek.length)} />
      </View>

      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space[3], alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Eyebrow>Volume trend</Eyebrow>
            <Text style={t.text('displayS')}>Last {chart.length || 0} sessions</Text>
          </View>
          {data.bestLift && (
            <View style={{ alignItems: 'flex-end', maxWidth: 130 }}>
              <Text style={t.text('labelCaps', 'textMuted')}>Best est.</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit style={t.text('dataM')}>
                {Math.round(data.bestLift.e1rm)} lb
              </Text>
              <Text numberOfLines={1} style={t.text('bodyS', 'textMuted')}>
                {exerciseCatalog[data.bestLift.exercise_id]?.name ?? data.bestLift.exercise_id}
              </Text>
            </View>
          )}
        </View>

        <View style={{ height: 138, flexDirection: 'row', alignItems: 'flex-end', gap: space[2], marginTop: space[5] }}>
          {chart.length === 0 ? (
            <Text style={t.text('bodyM', 'textMuted')}>Finish a workout to start the trend.</Text>
          ) : (
            chart.map((w) => (
              <View key={w.id} style={{ flex: 1, alignItems: 'center', gap: space[2] }}>
                <View
                  style={{
                    width: '100%',
                    minHeight: 6,
                    height: Math.max(6, (w.volume / maxVolume) * 104),
                    borderRadius: 5,
                    backgroundColor: t.colors.dataBlue,
                    opacity: 0.45 + (w.volume / maxVolume) * 0.55,
                  }}
                />
                <Text numberOfLines={1} adjustsFontSizeToFit style={[t.text('dataS', 'textFaint'), { fontSize: 10 }]}>
                  {dayLabel(w.started_at)}
                </Text>
              </View>
            ))
          )}
        </View>
      </Card>

      <Card>
        <Eyebrow>Recent records</Eyebrow>
        {data.prs.length === 0 ? (
          <Text style={t.text('bodyM', 'textMuted')}>PRs will land here after completed summaries.</Text>
        ) : (
          data.prs.map((pr, i) => (
            <View
              key={`${pr.exercise_id}:${pr.type}:${pr.achieved_at}`}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                gap: space[3],
                paddingVertical: 11,
                borderTopWidth: i === 0 ? 0 : borderWidth.hairline,
                borderTopColor: t.colors.borderHairline,
              }}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={t.text('bodyM')}>
                  {exerciseCatalog[pr.exercise_id]?.name ?? pr.exercise_id}
                </Text>
                <Text style={t.text('bodyS', 'textMuted')}>{PR_LABEL[pr.type] ?? pr.type}</Text>
              </View>
              <Text style={t.text('dataM')}>
                {Math.round(pr.value * 10) / 10}
                {pr.type === 'reps_at_weight' ? ' reps' : ' lb'}
              </Text>
            </View>
          ))
        )}
      </Card>

      <Card>
        <Eyebrow>Recent sessions</Eyebrow>
        {data.workouts.slice(0, 4).map((w, i) => (
          <View
            key={w.id}
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              gap: space[3],
              paddingVertical: 11,
              borderTopWidth: i === 0 ? 0 : borderWidth.hairline,
              borderTopColor: t.colors.borderHairline,
            }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={t.text('bodyM')}>
                {w.day_name ?? 'Workout'}
              </Text>
              <Text style={t.text('bodyS', 'textMuted')}>{dayLabel(w.started_at)}</Text>
            </View>
            <Text style={t.text('dataS', 'textMuted')}>
              {compact(w.volume)} lb · {w.sets} sets
            </Text>
          </View>
        ))}
        {data.workouts.length === 0 && (
          <Text style={t.text('bodyM', 'textMuted')}>Completed sessions will appear here.</Text>
        )}
      </Card>

      <Teaser
        marker="+"
        title="Weekly review next."
        detail="Strength trends, consistency, and recovery notes will build from your log."
      />
    </ScreenScroll>
  );
}
