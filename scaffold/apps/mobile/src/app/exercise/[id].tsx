import { exerciseCatalog, type CatalogExercise, type Pattern } from '@atrium/engine';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { useApp } from '@/AppContext';
import { Card, Eyebrow, ScreenScroll } from '@/components/ui';
import { borderWidth, radius, space, useTheme } from '@/theme';

interface HistoryRow {
  workout_id: string;
  started_at: string;
  volume: number;
  sets: number;
  best_weight: number | null;
  best_reps: number | null;
  best_e1rm: number;
}

interface BestSet {
  weight: number;
  reps: number;
  e1rm: number;
}

interface PrRow {
  type: string;
  workout_id: string | null;
  achieved_at: string;
}

const GROUP_BY_PATTERN: Record<Pattern, string> = {
  squat: 'Legs',
  hinge: 'Posterior chain',
  hpress: 'Chest',
  vpress: 'Shoulders',
  hpull: 'Back',
  vpull: 'Back',
  lunge: 'Legs',
  chest_iso: 'Chest',
  side_delt: 'Shoulders',
  rear_delt: 'Rear delts',
  biceps: 'Arms',
  triceps: 'Arms',
  quad_iso: 'Quads',
  ham_iso: 'Hamstrings',
  glute_iso: 'Glutes',
  calf: 'Calves',
  core: 'Core',
  carry: 'Carry',
  cond: 'Conditioning',
};

const COMPOUND = new Set<Pattern>(['squat', 'hinge', 'hpress', 'vpress', 'hpull', 'vpull', 'lunge', 'carry']);

function titleCase(value: string) {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function dayLabel(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function compact(n: number) {
  if (!Number.isFinite(n)) return '0';
  return n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(Math.round(n));
}

function exerciseType(exercise: CatalogExercise) {
  return COMPOUND.has(exercise.pattern) ? 'Compound' : 'Accessory';
}

function PlayCard() {
  const t = useTheme();
  return (
    <View
      style={{
        height: 176,
        borderRadius: radius.card,
        backgroundColor: t.colors.bgSurface2,
        borderWidth: borderWidth.hairline,
        borderColor: t.colors.borderHairline,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <Svg width="100%" height="100%" viewBox="0 0 320 176" preserveAspectRatio="none" style={{ position: 'absolute' }}>
        <Line x1={0} y1={44} x2={320} y2={44} stroke={t.colors.borderHairline} strokeWidth={1} />
        <Line x1={0} y1={88} x2={320} y2={88} stroke={t.colors.borderHairline} strokeWidth={1} />
        <Line x1={0} y1={132} x2={320} y2={132} stroke={t.colors.borderHairline} strokeWidth={1} />
        <Line x1={80} y1={0} x2={80} y2={176} stroke={t.colors.borderHairline} strokeWidth={1} />
        <Line x1={160} y1={0} x2={160} y2={176} stroke={t.colors.borderHairline} strokeWidth={1} />
        <Line x1={240} y1={0} x2={240} y2={176} stroke={t.colors.borderHairline} strokeWidth={1} />
      </Svg>
      <View
        style={{
          width: 58,
          height: 58,
          borderRadius: 29,
          backgroundColor: t.colors.actionInk,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Svg width={24} height={24} viewBox="0 0 24 24">
          <Path d="M8 5.5 18 12 8 18.5Z" fill={t.colors.actionOnInk} />
        </Svg>
      </View>
      <Text style={[t.text('bodyS', 'textMuted'), { marginTop: space[3] }]}>0:24 · form demo</Text>
    </View>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  const t = useTheme();
  return (
    <View
      style={{
        flex: 1,
        minHeight: 78,
        borderRadius: radius.card,
        borderWidth: borderWidth.hairline,
        borderColor: t.colors.borderHairline,
        backgroundColor: t.colors.bgSurface,
        padding: space[3],
        justifyContent: 'space-between',
      }}
    >
      <Text numberOfLines={1} adjustsFontSizeToFit style={t.text('heroNumL')}>
        {value}
      </Text>
      <Text numberOfLines={1} style={t.text('labelCaps', 'textMuted')}>{label}</Text>
    </View>
  );
}

function Chip({ children }: { children: string }) {
  const t = useTheme();
  return (
    <View
      style={{
        borderRadius: radius.control,
        borderWidth: borderWidth.hairline,
        borderColor: t.colors.borderStrong,
        backgroundColor: t.colors.bgSurface,
        paddingHorizontal: 11,
        paddingVertical: 7,
      }}
    >
      <Text style={t.text('bodyS', 'textMuted')}>{children}</Text>
    </View>
  );
}

function Chart({ rows }: { rows: HistoryRow[] }) {
  const t = useTheme();
  const chart = rows.slice().reverse().filter((row) => row.best_e1rm > 0).slice(-8);
  const values = chart.map((row) => row.best_e1rm);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const range = Math.max(1, max - min);
  const points =
    values.length > 1
      ? values.map((v, i) => {
          const x = 12 + (i / (values.length - 1)) * 296;
          const y = 110 - ((v - min) / range) * 86;
          return { x, y };
        })
      : [];
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const area = points.length > 1 ? `${line} L${points[points.length - 1]!.x},128 L${points[0]!.x},128 Z` : '';
  const delta = values.length > 1 ? values[values.length - 1]! - values[0]! : 0;

  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space[3] }}>
        <Text style={t.text('displayS')}>e1RM trend</Text>
        <Text style={t.text('dataS', delta >= 0 ? 'dataBlue' : 'dataCoral')}>
          {values.length > 1 ? `${delta >= 0 ? '+' : ''}${Math.round(delta)} lb` : 'New'}
        </Text>
      </View>
      <View style={{ height: 132, marginTop: space[3] }}>
        <Svg width="100%" height="100%" viewBox="0 0 320 132" preserveAspectRatio="none">
          {[32, 66, 100].map((y) => (
            <Line key={y} x1={0} y1={y} x2={320} y2={y} stroke={t.colors.borderHairline} strokeWidth={1} />
          ))}
          {points.length > 1 ? (
            <>
              <Path d={area} fill={t.colors.dataBlue} opacity={0.08} />
              <Path d={line} fill="none" stroke={t.colors.dataBlue} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
              <Circle cx={points[points.length - 1]!.x} cy={points[points.length - 1]!.y} r={4} fill={t.colors.dataCoral} />
            </>
          ) : (
            <Path d="M16,88 L304,88" fill="none" stroke={t.colors.borderStrong} strokeWidth={2} strokeLinecap="round" />
          )}
        </Svg>
      </View>
    </Card>
  );
}

export default function ExerciseDetailScreen() {
  const t = useTheme();
  const { db, userId } = useApp();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const exercise = id ? exerciseCatalog[id] : undefined;
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [best, setBest] = useState<BestSet | null>(null);
  const [prs, setPrs] = useState<PrRow[]>([]);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      if (!id) return () => {};
      (async () => {
        const rows = await db.getAllAsync<HistoryRow>(
          `select w.id as workout_id, w.started_at,
                  coalesce(sum(coalesce(s.weight, 0) * coalesce(s.reps, 0)), 0) as volume,
                  count(s.id) as sets,
                  max(s.weight) as best_weight,
                  max(s.reps) as best_reps,
                  max(coalesce(s.weight, 0) * (1 + coalesce(s.reps, 0) / 30.0)) as best_e1rm
             from sets s
             join workouts w on w.id = s.workout_id
            where w.user_id = ? and s.exercise_id = ? and w.deleted_at is null and s.deleted_at is null
              and s.is_warmup = 0 and s.weight is not null and s.reps is not null
            group by w.id
            order by w.started_at desc
            limit 12`,
          userId,
          id,
        );
        const bestSet = await db.getFirstAsync<BestSet>(
          `select weight, reps, coalesce(weight, 0) * (1 + coalesce(reps, 0) / 30.0) as e1rm
             from sets s
             join workouts w on w.id = s.workout_id
            where w.user_id = ? and s.exercise_id = ? and w.deleted_at is null and s.deleted_at is null
              and s.is_warmup = 0 and s.weight is not null and s.reps is not null
            order by e1rm desc
            limit 1`,
          userId,
          id,
        );
        const prRows = await db.getAllAsync<PrRow>(
          `select type, workout_id, achieved_at
             from personal_records
            where user_id = ? and exercise_id = ? and deleted_at is null
            order by achieved_at desc
            limit 8`,
          userId,
          id,
        );
        if (live) {
          setHistory(rows);
          setBest(bestSet);
          setPrs(prRows);
        }
      })();
      return () => {
        live = false;
      };
    }, [db, userId, id]),
  );

  const prWorkoutIds = useMemo(() => new Set(prs.map((pr) => pr.workout_id).filter(Boolean)), [prs]);

  if (!id || !exercise) {
    return (
      <ScreenScroll>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={t.text('bodyS', 'textMuted')}>‹ Library</Text>
        </Pressable>
        <Card>
          <Text style={t.text('bodyM', 'textMuted')}>Exercise not found.</Text>
        </Card>
      </ScreenScroll>
    );
  }

  const sessions = history.length;
  const bestE1rm = Math.round(best?.e1rm ?? 0);
  const bestSet = best ? `${Math.round(best.weight)}×${best.reps}` : '—';

  return (
    <ScreenScroll>
      <View style={{ paddingHorizontal: 2, paddingTop: space[2], paddingBottom: space[2] }}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={t.text('bodyS', 'textMuted')}>‹ Library</Text>
        </Pressable>
        <Text style={[t.text('screenTitle'), { marginTop: space[5] }]}>{exercise.name}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[3] }}>
          <Chip>{titleCase(exercise.equipment)}</Chip>
          <Chip>{GROUP_BY_PATTERN[exercise.pattern]}</Chip>
          <Chip>{exerciseType(exercise)}</Chip>
        </View>
      </View>

      <PlayCard />

      <View style={{ flexDirection: 'row', gap: space[3] }}>
        <Metric value={bestE1rm > 0 ? String(bestE1rm) : '—'} label="e1RM (lb)" />
        <Metric value={bestSet} label="Best set" />
        <Metric value={String(sessions)} label="Sessions" />
      </View>

      <Chart rows={history} />

      <Card style={{ paddingVertical: 8, paddingHorizontal: 18 }}>
        <Eyebrow>Recent</Eyebrow>
        {history.length === 0 ? (
          <Text style={[t.text('bodyM', 'textMuted'), { paddingVertical: space[3] }]}>Log this movement to start its history.</Text>
        ) : (
          history.slice(0, 6).map((row, index) => (
            <View
              key={row.workout_id}
              style={{
                minHeight: 48,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: space[3],
                borderTopWidth: index === 0 ? 0 : borderWidth.hairline,
                borderTopColor: t.colors.borderHairline,
              }}
            >
              <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
                <Text numberOfLines={1} style={t.text('bodyM')}>
                  {row.best_weight ? `${Math.round(row.best_weight)} × ${row.best_reps ?? '—'}` : `${compact(row.volume)} lb`}
                  {` · ${row.sets} sets`}
                </Text>
                {prWorkoutIds.has(row.workout_id) && (
                  <View
                    style={{
                      borderRadius: 5,
                      borderWidth: borderWidth.hairline,
                      borderColor: t.colors.dataCoral,
                      paddingHorizontal: 6,
                      paddingVertical: 2,
                    }}
                  >
                    <Text style={[t.text('labelCaps', 'dataCoral'), { fontSize: 8 }]}>PR</Text>
                  </View>
                )}
              </View>
              <Text style={t.text('bodyS', 'textMuted')}>{dayLabel(row.started_at)}</Text>
            </View>
          ))
        )}
      </Card>
    </ScreenScroll>
  );
}
