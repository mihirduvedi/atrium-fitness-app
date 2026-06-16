import { Platform, useColorScheme, type TextStyle } from 'react-native';
import {
  borderWidth,
  colors,
  layout,
  radius,
  space,
  type,
  type ColorMode,
  type ColorTokens,
  type FontRole,
  type TextStyleName,
} from '@atrium/tokens';

export { borderWidth, layout, radius, space };

/**
 * The only place font roles are mapped to concrete families. Display is
 * Source Serif 4 (loaded in the root layout; New York / Georgia fallback),
 * body is the platform system font, data rows are IBM Plex Mono.
 */
const families: Record<FontRole, Record<number, string | undefined>> = {
  display: {
    500: 'SourceSerif4_500Medium',
    600: 'SourceSerif4_600SemiBold',
  },
  body: { 300: undefined, 400: undefined, 600: undefined }, // system font
  mono: {
    400: 'IBMPlexMono_400Regular',
    500: 'IBMPlexMono_500Medium',
  },
};

const monoFallback = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });
const serifFallback = Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' });

/** Build a React Native TextStyle from a spec text style token. */
export function textStyle(name: TextStyleName, color: string): TextStyle {
  const t = type[name];
  const role = t.role as FontRole;
  const family = families[role][t.weight];
  return {
    fontFamily: family ?? (role === 'mono' ? monoFallback : role === 'display' ? serifFallback : undefined),
    fontWeight: family ? undefined : (`${t.weight}` as TextStyle['fontWeight']),
    fontSize: t.size,
    lineHeight: Math.round(t.size * t.line),
    letterSpacing: Math.max(0, (t.track / 100) * t.size),
    color,
    ...('caps' in t && t.caps ? { textTransform: 'uppercase' as const } : null),
    ...(role === 'mono' ? { fontVariant: ['tabular-nums' as const] } : null),
  };
}

export interface Theme {
  mode: ColorMode;
  colors: ColorTokens;
  text: (name: TextStyleName, colorKey?: keyof ColorTokens) => TextStyle;
}

export function useTheme(): Theme {
  const scheme = useColorScheme();
  const mode: ColorMode = scheme === 'dark' ? 'night' : 'day';
  const c = colors[mode];
  return {
    mode,
    colors: c,
    text: (name, colorKey = 'textPrimary') => textStyle(name, c[colorKey]),
  };
}
