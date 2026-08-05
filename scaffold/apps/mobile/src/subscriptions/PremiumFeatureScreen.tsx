import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useApp } from '@/AppContext';
import { Button, Card, Eyebrow, ScreenScroll } from '@/components/ui';
import { space, useTheme } from '@/theme';

export function PremiumFeatureScreen({
  eyebrow,
  title,
  detail,
  onBack,
}: {
  eyebrow: string;
  title: string;
  detail: string;
  onBack?: () => void;
}) {
  const t = useTheme();
  const { subscription } = useApp();
  return (
    <ScreenScroll>
      {onBack && (
        <Pressable onPress={onBack} style={({ pressed }) => ({ opacity: pressed ? 0.62 : 1, alignSelf: 'flex-start' })}>
          <Text style={t.text('bodyM', 'textMuted')}>‹ Back</Text>
        </Pressable>
      )}
      <View style={{ paddingTop: space[2], paddingBottom: space[2] }}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <Text style={t.text('screenTitle')}>{title}</Text>
      </View>
      <Card>
        <Text style={t.text('displayS')}>Premium is the coaching layer.</Text>
        <Text style={[t.text('bodyM', 'textMuted'), { marginTop: space[2], marginBottom: space[4] }]}>{detail}</Text>
        <Button title="See Atrium Premium" onPress={() => router.push('/paywall')} />
      </Card>
      <Card>
        <Text style={t.text('bodyM')}>Logging stays free, forever.</Text>
        <Text style={[t.text('bodyS', 'textMuted'), { marginTop: space[1] }]}>
          Workouts, history, PRs, rest timers, check-ins, and body data remain available without a subscription.
        </Text>
      </Card>
      {(subscription.status === 'unconfigured' || subscription.status === 'error') && (
        <Text style={t.text('bodyS', 'textMuted')}>
          Subscription setup is unavailable in this build. Free features are unaffected.
        </Text>
      )}
    </ScreenScroll>
  );
}
