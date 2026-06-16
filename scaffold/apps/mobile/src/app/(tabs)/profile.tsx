import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { isAnonymous } from '@/auth';
import { useApp } from '@/AppContext';
import { Card, Eyebrow, ScreenScroll } from '@/components/ui';
import { getActiveProgram, type ProgramInfo } from '@/db/queries';
import { getHealthSampleCount } from '@/health/readiness';
import { borderWidth, radius, space, useTheme } from '@/theme';

interface ProfileRow {
  goal: string;
  experience: string;
  equipment: string;
  days_per_week: number;
  units: string;
  created_at: string;
}

interface ProfileStats {
  workouts: number;
  prs: number;
}

interface ProfileData {
  profile: ProfileRow | null;
  program: ProgramInfo | null;
  stats: ProfileStats;
  anonymous: boolean;
  healthSamples: number;
}

const emptyData: ProfileData = {
  profile: null,
  program: null,
  stats: { workouts: 0, prs: 0 },
  anonymous: true,
  healthSamples: 0,
};

function monthYear(iso?: string | null) {
  if (!iso) return 'since setup';
  return new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function titleCase(value?: string | null) {
  if (!value) return '';
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function parseEquipment(raw?: string | null) {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function programName(program: ProgramInfo | null) {
  if (!program) return 'No active program';
  if (program.archetype_id === 'ul4_strength') return `Upper / Lower · W${program.current_week}`;
  return `${titleCase(program.archetype_id)} · W${program.current_week}`;
}

function unitsLabel(units?: string | null) {
  return units === 'kg' ? 'kg / km' : 'lb / mi';
}

function accountLabel(syncEnabled: boolean, anonymous: boolean) {
  if (!syncEnabled) return 'On-device';
  return anonymous ? 'Anonymous sync' : 'Apple account';
}

function LockIcon() {
  const t = useTheme();
  return (
    <View
      style={{
        width: 38,
        height: 38,
        borderRadius: 19,
        backgroundColor: t.colors.bgSurface2,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Svg width={19} height={19} viewBox="0 0 24 24">
        <Rect x="5.5" y="10.2" width="13" height="9" rx="2.4" fill="none" stroke={t.colors.textMuted} strokeWidth={1.9} />
        <Path d="M8.3 10.2V8a3.7 3.7 0 0 1 7.4 0v2.2" fill="none" stroke={t.colors.textMuted} strokeWidth={1.9} strokeLinecap="round" />
      </Svg>
    </View>
  );
}

function StatPill({ value, label }: { value: string; label: string }) {
  const t = useTheme();
  return (
    <View
      style={{
        flex: 1,
        minHeight: 72,
        borderRadius: radius.card,
        borderWidth: borderWidth.hairline,
        borderColor: t.colors.borderHairline,
        backgroundColor: t.colors.bgSurface,
        paddingHorizontal: space[3],
        paddingVertical: space[3],
        justifyContent: 'space-between',
      }}
    >
      <Text numberOfLines={1} adjustsFontSizeToFit style={t.text('heroNumL')}>
        {value}
      </Text>
      <Text numberOfLines={1} style={t.text('labelCaps', 'textMuted')}>
        {label}
      </Text>
    </View>
  );
}

function ProfileRowItem({ label, detail, last }: { label: string; detail: string; last?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => ({
        minHeight: 54,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space[3],
        borderBottomWidth: last ? 0 : borderWidth.hairline,
        borderBottomColor: t.colors.borderHairline,
        opacity: pressed ? 0.62 : 1,
      })}
    >
      <Text numberOfLines={1} style={[t.text('bodyM'), { flex: 1, minWidth: 0 }]}>
        {label}
      </Text>
      <Text numberOfLines={1} style={t.text('bodyS', 'textMuted')}>
        {detail} ›
      </Text>
    </Pressable>
  );
}

export default function ProfileScreen() {
  const t = useTheme();
  const { db, userId, sync } = useApp();
  const [data, setData] = useState<ProfileData>(emptyData);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      (async () => {
        const profile = await db.getFirstAsync<ProfileRow>(
          `select goal, experience, equipment, days_per_week, units, created_at
             from profiles
            where user_id = ? and deleted_at is null`,
          userId,
        );
        const stats = await db.getFirstAsync<ProfileStats>(
          `select
              (select count(*)
                 from workouts w
                where w.user_id = ? and w.ended_at is not null and w.deleted_at is null
                  and exists (
                    select 1 from sets s
                     where s.workout_id = w.id and s.deleted_at is null and s.is_warmup = 0
                  )) as workouts,
              (select count(distinct exercise_id || ':' || type)
                 from personal_records
                where user_id = ? and deleted_at is null) as prs`,
          userId,
          userId,
        );
        const program = await getActiveProgram(db, userId);
        const anonymous = await isAnonymous();
        const healthSamples = await getHealthSampleCount(db, userId);
        if (live) {
          setData({
            profile,
            program,
            stats: stats ?? emptyData.stats,
            anonymous,
            healthSamples,
          });
        }
      })();
      return () => {
        live = false;
      };
    }, [db, userId]),
  );

  const equipment = useMemo(() => parseEquipment(data.profile?.equipment), [data.profile?.equipment]);
  const coachFacts = [
    data.profile?.goal,
    data.profile?.experience,
    data.profile?.days_per_week ? `${data.profile.days_per_week}` : null,
    data.profile?.units,
    equipment.length ? `${equipment.length}` : null,
    data.program?.archetype_id,
    data.stats.workouts ? `${data.stats.workouts}` : null,
    data.stats.prs ? `${data.stats.prs}` : null,
  ].filter(Boolean).length;
  const profileLine = data.profile
    ? `${titleCase(data.profile.goal)} · ${titleCase(data.profile.experience)} · ${data.profile.days_per_week} days/wk`
    : 'Training profile';
  const healthDetail = data.healthSamples > 0 ? `${data.healthSamples} samples` : 'Not connected';

  return (
    <ScreenScroll>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingTop: space[2], paddingBottom: space[3] }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: t.colors.bgSurface2,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: borderWidth.hairline,
            borderColor: t.colors.borderHairline,
          }}
        >
          <Text style={[t.text('displayM'), { fontSize: 24 }]}>A</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={t.text('screenTitle')}>Athlete</Text>
          <Text numberOfLines={1} style={t.text('bodyS', 'textMuted')}>
            {accountLabel(!!sync, data.anonymous)} · {monthYear(data.profile?.created_at)}
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: space[3] }}>
        <StatPill value={String(data.stats.workouts)} label="Workouts" />
        <StatPill value={String(data.stats.prs)} label="Records" />
        <StatPill value={String(coachFacts)} label="Facts" />
      </View>

      <Card>
        <Eyebrow>Training profile</Eyebrow>
        <Text style={t.text('displayS')}>{profileLine}</Text>
        <Text style={[t.text('bodyS', 'textMuted'), { marginTop: 4 }]}>{programName(data.program)}</Text>
      </Card>

      <Card style={{ paddingVertical: 4, paddingHorizontal: 16 }}>
        <ProfileRowItem label="What your coach knows" detail={`${coachFacts} facts`} />
        <ProfileRowItem label="Connected health data" detail={healthDetail} />
        <ProfileRowItem label="Units" detail={unitsLabel(data.profile?.units)} />
        <ProfileRowItem label="Export my data" detail="CSV" />
        <ProfileRowItem label="Plan status" detail="Work in progress" last />
      </Card>

      <Card>
        <View style={{ flexDirection: 'row', gap: space[3], alignItems: 'center' }}>
          <LockIcon />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={t.text('bodyM')}>Your data is never sold.</Text>
            <Text style={t.text('bodyS', 'textMuted')}>Health data stays yours. Full stop.</Text>
          </View>
        </View>
      </Card>
    </ScreenScroll>
  );
}
