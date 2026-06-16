import { BlurView } from 'expo-blur';
import { router, usePathname } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { borderWidth, useTheme } from '@/theme';

const TABS = [
  { name: 'today', label: 'Today', href: '/(tabs)/today' },
  { name: 'progress', label: 'Progress', href: '/(tabs)/progress' },
  { name: 'coach', label: 'Coach', href: '/(tabs)/coach' },
  { name: 'profile', label: 'Profile', href: '/(tabs)/profile' },
] as const;

function Glyph({ name, color }: { name: string; color: string }) {
  const stroke = { stroke: color, strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (name === 'today') {
    return (
      <Svg width={22} height={22} viewBox="0 0 22 22">
        <Path d="M3.5 10.2 11 4.2l7.5 6" fill="none" {...stroke} />
        <Path d="M6.5 9.6v8h9v-8" fill="none" {...stroke} />
      </Svg>
    );
  }
  if (name === 'progress') {
    return (
      <Svg width={22} height={22} viewBox="0 0 22 22">
        <Path d="M4 14.5 8.8 11l3.7 2.2L18 8.7" fill="none" {...stroke} />
      </Svg>
    );
  }
  if (name === 'coach') {
    return (
      <Svg width={22} height={22} viewBox="0 0 22 22">
        <Path
          d="M7 4.8h8.2c2.7 0 4.8 2 4.8 4.5v2.3c0 2.5-2.1 4.5-4.8 4.5h-1.3l3.8 3.1-6-3.1H7c-2.8 0-5-2-5-4.5V9.3c0-2.5 2.2-4.5 5-4.5Z"
          fill="none"
          {...stroke}
        />
        <Circle cx={7.6} cy={10.8} r={1.15} fill={color} />
        <Circle cx={11} cy={10.8} r={1.15} fill={color} />
        <Circle cx={14.4} cy={10.8} r={1.15} fill={color} />
      </Svg>
    );
  }
  return (
    <Svg width={22} height={22} viewBox="0 0 22 22">
      <Circle cx={11} cy={6.5} r={3.2} fill="none" {...stroke} />
      <Path d="M5.2 18.2c1.1-3 3-4.2 5.8-4.2s4.7 1.2 5.8 4.2" fill="none" {...stroke} />
    </Svg>
  );
}

function isActive(pathname: string, name: string) {
  return pathname === `/${name}` || pathname.endsWith(`/${name}`);
}

export function AtriumFloatingNav() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const glass = t.mode === 'night' ? 'rgba(34, 33, 31, 0.58)' : 'rgba(255, 255, 255, 0.58)';
  const pressedGlass = t.mode === 'night' ? 'rgba(44, 43, 40, 0.92)' : 'rgba(242, 241, 237, 0.92)';

  if (pathname.includes('onboarding')) return null;

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        paddingHorizontal: 18,
        paddingBottom: Math.max(insets.bottom, 12),
      }}
    >
      <View
        style={{
          width: '100%',
          maxWidth: 382,
          height: 70,
          borderRadius: 35,
          shadowColor: t.colors.textPrimary,
          shadowOpacity: t.mode === 'night' ? 0.32 : 0.14,
          shadowRadius: 28,
          shadowOffset: { width: 0, height: 14 },
          elevation: 10,
        }}
      >
        <View
          style={{
            flex: 1,
            borderRadius: 35,
            overflow: 'hidden',
            borderWidth: borderWidth.hairline,
            borderColor: t.colors.borderHairline,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 10,
          }}
        >
          <BlurView
            intensity={t.mode === 'night' ? 34 : 46}
            tint={t.mode === 'night' ? 'dark' : 'light'}
            style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
          />
          <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: glass }} />

          {TABS.slice(0, 2).map((tab) => {
            const active = isActive(pathname, tab.name);
            const color = active ? t.colors.textPrimary : t.colors.textFaint;
            return (
              <Pressable
                key={tab.name}
                onPress={() => router.replace(tab.href)}
                style={({ pressed }) => ({
                  width: 58,
                  height: 52,
                  borderRadius: 26,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2,
                  backgroundColor: pressed || active ? pressedGlass : 'transparent',
                })}
              >
                <Glyph name={tab.name} color={color} />
                <Text style={[t.text('labelCaps', active ? 'textPrimary' : 'textFaint'), { fontSize: 8.5 }]}>
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}

          <Pressable
            onPress={() => router.push('/workout')}
            style={({ pressed }) => ({
              width: 58,
              height: 58,
              borderRadius: 29,
              backgroundColor: t.colors.actionInk,
              alignItems: 'center',
              justifyContent: 'center',
              transform: [{ translateY: pressed ? 1 : -2 }],
              shadowColor: t.colors.textPrimary,
              shadowOpacity: t.mode === 'night' ? 0.35 : 0.18,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 5 },
              elevation: 12,
            })}
          >
            <Text style={[t.text('heroNumL', 'actionOnInk'), { marginTop: -2 }]}>+</Text>
          </Pressable>

          {TABS.slice(2).map((tab) => {
            const active = isActive(pathname, tab.name);
            const color = active ? t.colors.textPrimary : t.colors.textFaint;
            return (
              <Pressable
                key={tab.name}
                onPress={() => router.replace(tab.href)}
                style={({ pressed }) => ({
                  width: 58,
                  height: 52,
                  borderRadius: 26,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2,
                  backgroundColor: pressed || active ? pressedGlass : 'transparent',
                })}
              >
                <Glyph name={tab.name} color={color} />
                <Text style={[t.text('labelCaps', active ? 'textPrimary' : 'textFaint'), { fontSize: 8.5 }]}>
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

export function AtriumTabBar() {
  return (
    <View
      style={{
        display: 'none',
      }}
    />
  );
}
