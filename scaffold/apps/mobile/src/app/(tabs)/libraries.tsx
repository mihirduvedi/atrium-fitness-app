import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Card, Eyebrow, ScreenScroll } from '@/components/ui';
import { borderWidth, radius, space, useTheme } from '@/theme';

function BookIcon() {
  const t = useTheme();
  return (
    <View
      style={{
        width: 42,
        height: 42,
        borderRadius: 21,
        backgroundColor: t.colors.bgSurface2,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Svg width={22} height={22} viewBox="0 0 22 22">
        <Path d="M4.4 5.4h3.9c1.25 0 2.15.45 2.7 1.25v10.45c-.6-.65-1.5-1-2.7-1H4.4Z" fill="none" stroke={t.colors.textMuted} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M17.6 5.4h-3.9c-1.25 0-2.15.45-2.7 1.25v10.45c.6-.65 1.5-1 2.7-1h3.9Z" fill="none" stroke={t.colors.textMuted} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M11 6.7v10.4" fill="none" stroke={t.colors.textMuted} strokeWidth={1.9} strokeLinecap="round" />
      </Svg>
    </View>
  );
}

function LibraryRow({
  title,
  detail,
  onPress,
}: {
  title: string;
  detail: string;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 76,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        opacity: pressed ? 0.62 : 1,
      })}
    >
      <BookIcon />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={t.text('bodyM')}>{title}</Text>
        <Text numberOfLines={2} style={t.text('bodyS', 'textMuted')}>{detail}</Text>
      </View>
      <Text style={t.text('bodyM', 'textFaint')}>›</Text>
    </Pressable>
  );
}

export default function LibrariesScreen() {
  const t = useTheme();
  return (
    <ScreenScroll>
      <View style={{ paddingHorizontal: 2, paddingTop: space[2], paddingBottom: space[2] }}>
        <Eyebrow>Training assets</Eyebrow>
        <Text style={t.text('screenTitle')}>Libraries</Text>
      </View>

      <Card style={{ paddingVertical: 4, paddingHorizontal: 18 }}>
        <LibraryRow
          title="Program Library"
          detail="Saved exercise groups"
          onPress={() => router.push('/program-library')}
        />
        <View style={{ borderTopWidth: borderWidth.hairline, borderTopColor: t.colors.borderHairline }} />
        <LibraryRow
          title="Workout Plan Library"
          detail="Goal-based program collections"
          onPress={() => router.push('/workout-plan-library')}
        />
      </Card>
    </ScreenScroll>
  );
}
