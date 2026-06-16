import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { borderWidth, layout, radius, space, useTheme } from '@/theme';

export function ScreenScroll({
  children,
  bottomInset = layout.tabBarClearance,
  contentContainerStyle,
}: {
  children: ReactNode;
  bottomInset?: number;
  contentContainerStyle?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.colors.bgCanvas }}>
      <ScrollView
        style={{ flex: 1 }}
        alwaysBounceVertical
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[
          {
            paddingHorizontal: layout.screenMargin,
            paddingTop: space[2],
            paddingBottom: bottomInset,
            gap: layout.cardGap,
          },
          contentContainerStyle,
        ]}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function ScreenCenter({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <SafeAreaView
      edges={['top']}
      style={{ flex: 1, backgroundColor: t.colors.bgCanvas, justifyContent: 'center', padding: layout.screenMargin }}
    >
      {children}
    </SafeAreaView>
  );
}

export function Card({
  children,
  stamp,
  style,
}: {
  children: ReactNode;
  /** PR/watch-out variant: 1.5px coral border (spec §5). */
  stamp?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: t.colors.bgSurface,
          borderColor: stamp ? t.colors.dataCoral : t.colors.borderHairline,
          borderWidth: stamp ? borderWidth.emphasis : borderWidth.hairline,
          borderRadius: radius.card,
          padding: layout.cardPadding,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Eyebrow({ children, coral }: { children: string; coral?: boolean }) {
  const t = useTheme();
  return (
    <Text style={[t.text('labelCaps', coral ? 'dataCoral' : 'textMuted'), { marginBottom: 6 }]}>
      {children}
    </Text>
  );
}

export function Button({
  title,
  onPress,
  ghost,
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  ghost?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        {
          height: 48,
          borderRadius: radius.control,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: ghost ? 'transparent' : t.colors.actionInk,
          borderWidth: ghost ? borderWidth.hairline : 0,
          borderColor: t.colors.borderStrong,
          opacity: disabled ? 0.4 : 1,
          transform: [{ translateY: pressed ? 1 : 0 }],
        },
        style,
      ]}
    >
      <Text style={t.text('button', ghost ? 'textPrimary' : 'actionOnInk')}>{title}</Text>
    </Pressable>
  );
}

export function StatTile({ value, label }: { value: string; label: string }) {
  const t = useTheme();
  return (
    <Card style={{ flex: 1, alignItems: 'center', paddingVertical: space[4] }}>
      <Text style={t.text('heroNumL')}>{value}</Text>
      <Text style={[t.text('labelCaps', 'textMuted'), { marginTop: space[1] }]}>{label}</Text>
    </Card>
  );
}

export function SummaryStatTile({ value, label }: { value: string; label: string }) {
  const t = useTheme();
  return (
    <Card style={{ flex: 1, alignItems: 'center', paddingVertical: 14, paddingHorizontal: 6 }}>
      <Text style={t.text('heroNumL')}>{value}</Text>
      <Text
        numberOfLines={2}
        adjustsFontSizeToFit
        style={[t.text('labelCaps', 'textMuted'), { marginTop: space[1], textAlign: 'center', fontSize: 9.5 }]}
      >
        {label}
      </Text>
    </Card>
  );
}

export function ConsistencyMeter({ total, done }: { total: number; done: number }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 6, marginTop: space[2] }}>
      {Array.from({ length: Math.max(1, total) }, (_, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height: 5,
            borderRadius: 3,
            backgroundColor: i < done ? t.colors.dataBlue : t.colors.bgSurface2,
          }}
        />
      ))}
    </View>
  );
}

export function ReadinessRing({ score = 82, label = 'Ready' }: { score?: number; label?: string }) {
  const t = useTheme();
  return (
    <View
      style={{
        width: 88,
        height: 88,
        borderRadius: 44,
        borderWidth: 6,
        borderColor: t.colors.dataBlue,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: t.colors.bgSurface,
      }}
    >
      <Text style={t.text('heroNumXL')}>{score}</Text>
      <Text style={[t.text('labelCaps', 'textMuted'), { fontSize: 8.5, marginTop: -2 }]}>{label}</Text>
    </View>
  );
}

export function Teaser({
  marker = '+',
  title,
  detail,
}: {
  marker?: string;
  title: string;
  detail: string;
}) {
  const t = useTheme();
  return (
    <Card style={{ flexDirection: 'row', gap: 13, alignItems: 'center' }}>
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
        <Text style={t.text('bodyM', 'textMuted')}>{marker}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={t.text('bodyM')}>{title}</Text>
        <Text style={t.text('bodyS', 'textMuted')}>{detail}</Text>
      </View>
    </Card>
  );
}
