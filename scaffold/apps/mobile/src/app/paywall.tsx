import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useApp } from '@/AppContext';
import { Button, Card, Eyebrow, ScreenScroll } from '@/components/ui';
import { borderWidth, radius, space, useTheme } from '@/theme';
import type { SubscriptionActionResult, SubscriptionPackage } from '@/subscriptions/subscription';

function dismissPaywall() {
  if (router.canGoBack()) router.back();
  else router.replace('/(tabs)/today');
}

function PlanOption({
  plan,
  selected,
  onPress,
}: {
  plan: SubscriptionPackage;
  selected: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${plan.title}, ${plan.priceString}, ${plan.detail}`}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 76,
        borderRadius: radius.card,
        borderWidth: selected ? borderWidth.emphasis : borderWidth.hairline,
        borderColor: selected ? t.colors.textPrimary : t.colors.borderHairline,
        backgroundColor: selected ? t.colors.bgSurface2 : t.colors.bgSurface,
        paddingHorizontal: space[4],
        paddingVertical: space[3],
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space[3],
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
          <Text style={t.text('bodyM')}>{plan.title}</Text>
          {plan.cadence === 'annual' && (
            <View style={{ borderRadius: radius.control, backgroundColor: t.colors.actionInk, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text style={[t.text('labelCaps', 'actionOnInk'), { fontSize: 8.5 }]}>Best value</Text>
            </View>
          )}
        </View>
        <Text style={[t.text('bodyS', 'textMuted'), { marginTop: 2 }]}>{plan.detail}</Text>
        {plan.trialLabel && <Text style={[t.text('bodyS', 'dataBlue'), { marginTop: 2 }]}>{plan.trialLabel}</Text>}
      </View>
      <Text style={t.text('dataM')}>{plan.priceString}</Text>
    </Pressable>
  );
}

function actionMessage(result: SubscriptionActionResult, action: 'purchase' | 'restore') {
  if (result.outcome === 'cancelled') return null;
  if (result.outcome === 'success') return action === 'restore' ? 'Atrium Premium has been restored.' : 'Atrium Premium is active.';
  if (result.outcome === 'no_entitlement') return result.message ?? 'No active Atrium Premium purchase was found.';
  return result.message ?? (action === 'restore' ? 'Purchases could not be restored.' : 'The purchase could not be completed.');
}

export default function PaywallScreen() {
  const t = useTheme();
  const {
    subscription,
    refreshSubscription,
    purchaseSubscription,
    restoreSubscription,
    manageSubscription,
  } = useApp();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'purchase' | 'restore' | 'refresh' | 'manage' | null>(null);

  useEffect(() => {
    if (selectedId && subscription.packages.some((pkg) => pkg.id === selectedId)) return;
    setSelectedId(subscription.packages.find((pkg) => pkg.cadence === 'annual')?.id ?? subscription.packages[0]?.id ?? null);
  }, [selectedId, subscription.packages]);

  const selected = useMemo(
    () => subscription.packages.find((pkg) => pkg.id === selectedId) ?? null,
    [selectedId, subscription.packages],
  );
  const active = subscription.hasPremiumAccess;

  const purchase = async () => {
    if (!selected || busy) return;
    setBusy('purchase');
    const result = await purchaseSubscription(selected.id);
    setBusy(null);
    const message = actionMessage(result, 'purchase');
    if (result.outcome === 'success') {
      Alert.alert('Atrium Premium', message ?? 'Atrium Premium is active.', [{ text: 'Done', onPress: dismissPaywall }]);
    } else if (message) {
      Alert.alert('Purchase', message);
    }
  };

  const restore = async () => {
    if (busy) return;
    setBusy('restore');
    const result = await restoreSubscription();
    setBusy(null);
    const message = actionMessage(result, 'restore');
    if (message) Alert.alert('Restore purchases', message);
  };

  const manage = async () => {
    if (busy) return;
    setBusy('manage');
    const result = await manageSubscription();
    setBusy(null);
    if (result.outcome !== 'success') Alert.alert('Manage subscription', result.message ?? 'The subscription page could not be opened.');
  };

  const refresh = async () => {
    if (busy) return;
    setBusy('refresh');
    await refreshSubscription();
    setBusy(null);
  };

  return (
    <ScreenScroll contentContainerStyle={{ paddingTop: space[3] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close premium screen"
        onPress={dismissPaywall}
        style={({ pressed }) => ({ alignSelf: 'flex-end', paddingHorizontal: 2, paddingVertical: 4, opacity: pressed ? 0.55 : 1 })}
      >
        <Text style={t.text('bodyM', 'textMuted')}>Close</Text>
      </Pressable>

      <View style={{ paddingTop: space[3], paddingBottom: space[2] }}>
        <Eyebrow>{active ? 'Atrium Premium' : 'The coaching layer'}</Eyebrow>
        <Text style={t.text('screenTitle')}>{active ? 'Premium is active.' : 'Your coach is ready.'}</Text>
        <Text style={[t.text('bodyM', 'textMuted'), { marginTop: space[3] }]}>
          Logging is free, forever. Premium adds a plan that adapts to your recovery, a weekly review, and a coach grounded in your own numbers.
        </Text>
      </View>

      <Card>
        <View style={{ gap: space[3] }}>
          <Text style={t.text('bodyM')}>Adaptive program recommendations</Text>
          <Text style={t.text('bodyM')}>Weekly training and recovery review</Text>
          <Text style={t.text('bodyM')}>Long-term trends and a log-grounded coach</Text>
        </View>
      </Card>

      {active ? (
        <Card>
          <Text style={t.text('displayS')}>{subscription.status === 'trial' ? 'Your trial is active.' : 'Your subscription is active.'}</Text>
          <Text style={[t.text('bodyS', 'textMuted'), { marginTop: space[2], marginBottom: space[4] }]}>
            Manage renewal or cancellation through the store account used to subscribe.
          </Text>
          <Button title={busy === 'manage' ? 'Opening store…' : 'Manage subscription'} disabled={!!busy} onPress={() => void manage()} />
        </Card>
      ) : (
        <>
          {subscription.packages.length > 0 && (
            <View accessibilityRole="radiogroup" style={{ gap: space[3] }}>
              {subscription.packages.map((plan) => (
                <PlanOption key={plan.id} plan={plan} selected={plan.id === selectedId} onPress={() => setSelectedId(plan.id)} />
              ))}
            </View>
          )}

          {subscription.packages.length === 0 && (
            <Card>
              <Text style={t.text('bodyM')}>
                {subscription.status === 'loading' ? 'Loading available plans…' : 'Plans are unavailable in this build.'}
              </Text>
              <Text style={[t.text('bodyS', 'textMuted'), { marginTop: space[1] }]}>
                {subscription.errorMessage ?? 'Add the public RevenueCat keys and offering configuration to enable purchases.'}
              </Text>
              {subscription.configured && subscription.status !== 'loading' && (
                <Button
                  title={busy === 'refresh' ? 'Retrying…' : 'Retry'}
                  ghost
                  disabled={!!busy}
                  onPress={() => void refresh()}
                  style={{ marginTop: space[4] }}
                />
              )}
            </Card>
          )}

          <Button
            title={busy === 'purchase'
              ? 'Opening store…'
              : selected?.trialLabel
                ? `Start ${selected.trialLabel}`
                : selected
                  ? `Continue with ${selected.title.toLowerCase()}`
                  : 'Plans unavailable'}
            disabled={!selected || !!busy}
            onPress={() => void purchase()}
          />
        </>
      )}

      <Text style={[t.text('bodyS', 'textMuted'), { textAlign: 'center' }]}>
        Free tier keeps full logging, history, PRs, check-ins, and body data.
      </Text>
      {!active && (
        <Button title={busy === 'restore' ? 'Restoring…' : 'Restore purchases'} ghost disabled={!!busy} onPress={() => void restore()} />
      )}
      <Pressable
        accessibilityRole="button"
        onPress={dismissPaywall}
        style={({ pressed }) => ({ minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.55 : 1 })}
      >
        <Text style={t.text('bodyM', 'textMuted')}>Maybe later</Text>
      </Pressable>
    </ScreenScroll>
  );
}
