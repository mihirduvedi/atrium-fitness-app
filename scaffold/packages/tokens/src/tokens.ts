/**
 * Atrium v2 design tokens.
 *
 * Source of truth: Atrium_v2_Figma_Spec.md (v2.0, "humanized revision").
 * Every value below is transcribed verbatim from the spec tables — do not
 * tune values here; change the spec first. apps/mobile must consume these
 * tokens and never hand-type a hex.
 */

/** Alpha-composited night hairlines: the spec expresses these as `#EBE8E0 @ N%`. */
const warmOffWhiteAlpha = (alpha: number) => `rgba(235, 232, 224, ${alpha})`;

export interface ColorTokens {
  /** App background. Paper white / Warm graphite. */
  bgCanvas: string;
  /** Cards, sheets, coach chat bubbles, tab bar base. */
  bgSurface: string;
  /** Inset value fields, segmented track, icon dots, ring track. */
  bgSurface2: string;
  /** Card borders, row dividers. Always 1px. */
  borderHairline: string;
  /** Ghost buttons, unchecked set circles, suggestion chips. */
  borderStrong: string;
  /** Warm ink / warm off-white. Never pure black/white. */
  textPrimary: string;
  /** Secondary copy, labels, metadata. */
  textMuted: string;
  /** Ghost values, inactive tabs, table headers. */
  textFaint: string;
  /** Primary buttons, FAB, user chat bubble. Same value as textPrimary, intentionally. */
  actionInk: string;
  /** Text/icons on actionInk. */
  actionOnInk: string;
  /** Readiness ring, set-check fill, primary chart line, completed segments, positive deltas. */
  dataBlue: string;
  /** Sleep series, volume bars, secondary chart series. */
  dataSand: string;
  /** PR stamp cards, watch-out cards, chart endpoint dot. Scarce by law. */
  dataCoral: string;
}

export const day: ColorTokens = {
  bgCanvas: '#FBFBF9',
  bgSurface: '#FFFFFF',
  bgSurface2: '#F2F1ED',
  borderHairline: '#EAE8E3',
  borderStrong: '#D9D6CF',
  textPrimary: '#37352F',
  textMuted: '#787774',
  textFaint: '#B3AFA7',
  actionInk: '#37352F',
  actionOnInk: '#FFFFFF',
  dataBlue: '#6E87A8',
  dataSand: '#B99F6F',
  dataCoral: '#C06E54',
};

export const night: ColorTokens = {
  bgCanvas: '#1A1918',
  bgSurface: '#22211F',
  bgSurface2: '#2C2B28',
  borderHairline: warmOffWhiteAlpha(0.08),
  borderStrong: warmOffWhiteAlpha(0.17),
  textPrimary: '#EBE8E0',
  textMuted: '#A39F97',
  textFaint: '#6E6A63',
  actionInk: '#EBE8E0',
  actionOnInk: '#1A1918',
  dataBlue: '#8FA9CD',
  dataSand: '#D3B788',
  dataCoral: '#D08D72',
};

export const colors = { day, night } as const;
export type ColorMode = keyof typeof colors;

export const radius = {
  /** Cards, sheets, chat bubbles. */
  card: 12,
  /** Buttons, chips, inset fields, segmented controls. */
  control: 8,
} as const;

/** `space/1…8` — the only spacing values allowed. */
export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 32,
  8: 40,
} as const;

export const borderWidth = {
  hairline: 1,
  /** Stamp cards & check circles. */
  emphasis: 1.5,
} as const;

/**
 * Three type roles. Family names are logical: the app maps `display` to
 * Source Serif 4 (iOS fallback New York, generic Georgia), `body` to the
 * platform system font, `mono` to IBM Plex Mono.
 */
export type FontRole = 'display' | 'body' | 'mono';

export interface TextStyleToken {
  role: FontRole;
  /** Numeric weight as the spec lists it. */
  weight: 300 | 400 | 500 | 600;
  /** px */
  size: number;
  /** line-height multiple */
  line: number;
  /** tracking, % of font size (negative = tighter) */
  track: number;
  caps?: true;
}

export const type = {
  /** Top-level screen titles: calmer and rounder than display serif. */
  screenTitle: { role: 'body', weight: 600, size: 28, line: 1.12, track: 0 },
  /** Legacy display slots now use the same rounded system feel as headers. */
  displayXL: { role: 'body', weight: 600, size: 25, line: 1.25, track: 0 },
  /** Weekly review headline. */
  displayL: { role: 'body', weight: 600, size: 23, line: 1.25, track: 0 },
  /** Card titles. */
  displayM: { role: 'body', weight: 600, size: 20, line: 1.3, track: 0 },
  /** Exercise & PR titles. */
  displayS: { role: 'body', weight: 600, size: 18, line: 1.3, track: 0 },
  /** Body copy, chat. */
  bodyM: { role: 'body', weight: 400, size: 13.5, line: 1.55, track: 0 },
  /** Secondary copy. */
  bodyS: { role: 'body', weight: 400, size: 12.5, line: 1.5, track: 0 },
  /** Eyebrows, table headers. ALL CAPS. */
  labelCaps: { role: 'body', weight: 600, size: 10, line: 1.2, track: 8, caps: true },
  /** Readiness score, stat tiles, rest countdown — big numbers set thin. */
  heroNumXL: { role: 'body', weight: 300, size: 26, line: 1.1, track: -2 },
  /** Summary stat tiles. */
  heroNumL: { role: 'body', weight: 300, size: 20, line: 1.1, track: -2 },
  /** Set-row values. */
  dataM: { role: 'mono', weight: 500, size: 14, line: 1.2, track: -1 },
  /** Ghost values, rep ranges, diffs, axes. */
  dataS: { role: 'mono', weight: 400, size: 12, line: 1.2, track: 0 },
  /** Buttons (sentence case, never caps). */
  button: { role: 'body', weight: 600, size: 14.5, line: 1, track: 0 },
} as const satisfies Record<string, TextStyleToken>;

export type TextStyleName = keyof typeof type;

/** Layout grid (§3): 375×812 reference frame. */
export const layout = {
  screenMargin: 20,
  cardPadding: 18,
  cardGap: 14,
  tabBarClearance: 132,
  statTileGutter: 14,
} as const;
