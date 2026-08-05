import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { defaultAccountStatus, getAccountStatus, isAnonymous, upgradeWithApple, type AccountStatus } from '@/auth';
import { useApp } from '@/AppContext';
import { Card, Eyebrow, ScreenScroll } from '@/components/ui';
import { getActiveProgram, type ProgramInfo } from '@/db/queries';
import { canRequestHealthKit, requestHealthKitImport } from '@/health/healthkit';
import { getHealthSampleCount } from '@/health/readiness';
import { subscriptionStatusLabel } from '@/subscriptions/subscription';
import { borderWidth, radius, space, useAppearancePreference, useTheme, type AppearancePreference } from '@/theme';

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
  healthKitAvailable: boolean;
  account: AccountStatus;
}

const emptyData: ProfileData = {
  profile: null,
  program: null,
  stats: { workouts: 0, prs: 0 },
  anonymous: true,
  healthSamples: 0,
  healthKitAvailable: false,
  account: defaultAccountStatus,
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

function AccountRow({
  status,
  busy,
  onPress,
}: {
  status: AccountStatus;
  busy: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  const enabled = status.canUpgradeWithApple && !busy;
  return (
    <Pressable
      accessibilityRole={enabled ? 'button' : undefined}
      disabled={!enabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 68,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        opacity: pressed ? 0.62 : 1,
      })}
    >
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 19,
          backgroundColor: status.signedIn ? t.colors.actionInk : t.colors.bgSurface2,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={t.text('bodyM', status.signedIn ? 'actionOnInk' : 'textMuted')}>A</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={t.text('bodyM')}>
          Account · {status.accountLabel}
        </Text>
        <Text numberOfLines={2} style={t.text('bodyS', 'textMuted')}>
          {status.appleLabel}
        </Text>
      </View>
      <View
        style={{
          minWidth: 68,
          minHeight: 32,
          borderRadius: radius.control,
          borderWidth: borderWidth.hairline,
          borderColor: enabled ? t.colors.borderStrong : t.colors.borderHairline,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 10,
        }}
      >
        <Text numberOfLines={1} adjustsFontSizeToFit style={t.text('labelCaps', enabled ? 'textPrimary' : 'textMuted')}>
          {busy ? 'Working' : status.actionLabel}
        </Text>
      </View>
    </Pressable>
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

function ProfileRowItem({
  label,
  detail,
  last,
  onPress,
}: {
  label: string;
  detail: string;
  last?: boolean;
  onPress?: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
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

function AppearanceSetting() {
  const t = useTheme();
  const { mode, setPreference } = useAppearancePreference();
  const options: { value: AppearancePreference; label: string }[] = [
    { value: 'day', label: 'Light' },
    { value: 'night', label: 'Dark' },
  ];
  return (
    <View
      style={{
        minHeight: 62,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space[3],
        borderBottomWidth: borderWidth.hairline,
        borderBottomColor: t.colors.borderHairline,
      }}
    >
      <Text numberOfLines={1} style={[t.text('bodyM'), { flex: 1, minWidth: 0 }]}>
        Appearance
      </Text>
      <View
        style={{
          width: 138,
          height: 36,
          borderRadius: radius.control,
          borderWidth: borderWidth.hairline,
          borderColor: t.colors.borderHairline,
          backgroundColor: t.colors.bgSurface2,
          flexDirection: 'row',
          padding: 3,
        }}
      >
        {options.map((option) => {
          const active = option.value === mode;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setPreference(option.value)}
              style={({ pressed }) => ({
                flex: 1,
                borderRadius: radius.control - 3,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: active ? t.colors.bgCanvas : 'transparent',
                opacity: pressed ? 0.72 : 1,
              })}
            >
              <Text numberOfLines={1} adjustsFontSizeToFit style={t.text('labelCaps', active ? 'textPrimary' : 'textMuted')}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function ProfileScreen() {
  const t = useTheme();
  const { db, userId, sync, newId, subscription, manageSubscription, restoreSubscription } = useApp();
  const [data, setData] = useState<ProfileData>(emptyData);
  const [authBusy, setAuthBusy] = useState(false);
  const [healthBusy, setHealthBusy] = useState(false);
  const [subscriptionBusy, setSubscriptionBusy] = useState<'manage' | 'restore' | null>(null);

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
        const healthKitAvailable = await canRequestHealthKit();
        const account = await getAccountStatus(!!sync);
        if (live) {
          setData({
            profile,
            program,
            stats: stats ?? emptyData.stats,
            anonymous,
            healthSamples,
            healthKitAvailable,
            account,
          });
        }
      })();
      return () => {
        live = false;
      };
    }, [db, sync, userId]),
  );

  const handleAppleUpgrade = useCallback(async () => {
    if (!data.account.canUpgradeWithApple || authBusy) return;
    setAuthBusy(true);
    const result = await upgradeWithApple();
    const [anonymous, account] = await Promise.all([isAnonymous(), getAccountStatus(!!sync)]);
    setData((current) => ({ ...current, anonymous, account }));
    setAuthBusy(false);
    if (!result.ok) {
      Alert.alert('Sign in with Apple', result.reason ?? 'Could not complete sign-in.');
    }
  }, [authBusy, data.account.canUpgradeWithApple, sync]);

  const handleHealthImport = useCallback(async () => {
    if (healthBusy) return;
    setHealthBusy(true);
    const result = await requestHealthKitImport(db, userId, newId);
    const [healthSamples, healthKitAvailable] = await Promise.all([
      getHealthSampleCount(db, userId),
      canRequestHealthKit(),
    ]);
    setData((current) => ({ ...current, healthSamples, healthKitAvailable }));
    setHealthBusy(false);
    if (!result.ok) {
      Alert.alert('Health import', result.reason ?? 'Could not import Health data.');
      return;
    }
    Alert.alert('Health import', `Imported ${result.imported ?? 0} readiness samples.`);
  }, [db, healthBusy, newId, userId]);

  const handleSubscription = useCallback(async () => {
    if (!subscription.hasPremiumAccess) {
      router.push('/paywall');
      return;
    }
    if (subscriptionBusy) return;
    setSubscriptionBusy('manage');
    const result = await manageSubscription();
    setSubscriptionBusy(null);
    if (result.outcome !== 'success') {
      Alert.alert('Manage subscription', result.message ?? 'The subscription page could not be opened.');
    }
  }, [manageSubscription, subscription.hasPremiumAccess, subscriptionBusy]);

  const handleRestore = useCallback(async () => {
    if (subscriptionBusy) return;
    setSubscriptionBusy('restore');
    const result = await restoreSubscription();
    setSubscriptionBusy(null);
    if (result.outcome === 'success') {
      Alert.alert('Restore purchases', 'Atrium Premium has been restored.');
      return;
    }
    Alert.alert('Restore purchases', result.message ?? 'No active Atrium Premium purchase was found.');
  }, [restoreSubscription, subscriptionBusy]);

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
  const healthDetail = healthBusy
    ? 'Importing'
    : data.healthSamples > 0
      ? `${data.healthSamples} samples`
      : data.healthKitAvailable
        ? 'Import'
        : 'iOS build only';

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
            {data.account.accountLabel} · {monthYear(data.profile?.created_at)}
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
        <AccountRow status={data.account} busy={authBusy} onPress={handleAppleUpgrade} />
      </Card>

      <Card style={{ paddingVertical: 4, paddingHorizontal: 16 }}>
        <ProfileRowItem
          label="Atrium Premium"
          detail={subscriptionBusy === 'manage' ? 'Opening' : subscriptionStatusLabel(subscription)}
          onPress={() => void handleSubscription()}
        />
        <ProfileRowItem
          label="Restore purchases"
          detail={subscriptionBusy === 'restore' ? 'Restoring' : 'Store account'}
          onPress={() => void handleRestore()}
          last
        />
      </Card>

      <Card style={{ paddingVertical: 4, paddingHorizontal: 16 }}>
        <ProfileRowItem label="What your coach knows" detail={`${coachFacts} facts`} />
        <ProfileRowItem label="Connected health data" detail={healthDetail} onPress={handleHealthImport} />
        <AppearanceSetting />
        <ProfileRowItem label="Units" detail={unitsLabel(data.profile?.units)} />
        <ProfileRowItem label="Export my data" detail="CSV" />
        <ProfileRowItem label="Plan status" detail="Program view" onPress={() => router.push('/program')} last />
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
