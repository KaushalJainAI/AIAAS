import { useMemo } from 'react';
import { useColorScheme, type TextStyle } from 'react-native';

import { fontFamily } from './fonts';

/**
 * Colours are the web app's own tokens (`better-n8n-frontend/src/index.css`),
 * converted from HSL to hex, so the app and the website are the same product.
 * Change a value there first, then copy it here.
 */
export interface ThemeColors {
  /** `--background`: the page. */
  background: string;
  /** `--card`: cards, rows, sheets. */
  surface: string;
  /** `--secondary`: quiet fills (chips, segmented control track, code). */
  surfaceMuted: string;
  inputBackground: string;
  /** `--foreground`. */
  text: string;
  /** `--muted-foreground`. */
  mutedText: string;
  /** `--border`. */
  border: string;
  /** `--border-strong`: input outlines. */
  borderStrong: string;
  primary: string;
  primaryText: string;
  /** `--primary-subtle`: selected rows, primary tints. */
  primaryBg: string;
  /** `--agent`: what the agent did (runs, workers). */
  agent: string;
  agentBg: string;
  danger: string;
  dangerBg: string;
  success: string;
  successBg: string;
  warning: string;
  warningBg: string;
  /** The web has no separate info colour; it uses primary. */
  info: string;
  infoBg: string;
  /** Dims the screen behind a sheet. */
  scrim: string;
  /** Background of inline code and code blocks. */
  codeBackground: string;
  /** The chart series ramp: a fixed, validated order of 8 hues (web ChartArtifact). */
  chart: readonly string[];
  /** Chart grid lines. */
  chartGrid: string;
}

const light: ThemeColors = {
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceMuted: '#F5F5F7',
  inputBackground: '#FFFFFF',
  text: '#0B0B0F',
  mutedText: '#52525C',
  border: '#E8E8EC',
  borderStrong: '#D9D9DF',
  primary: '#0E6170',
  primaryText: '#FFFFFF',
  primaryBg: '#E7F2F3',
  agent: '#7C3BED',
  agentBg: '#F3EEFF',
  danger: '#AF0E1C',
  dangerBg: '#FDF1F2',
  success: '#0E710E',
  successBg: '#E9F6E9',
  warning: '#A15C07',
  warningBg: '#FFFAEB',
  info: '#0E6170',
  infoBg: '#E7F2F3',
  scrim: 'rgba(11, 11, 15, 0.4)',
  codeBackground: '#F5F5F7',
  chart: ['#2A78D6', '#EB6834', '#1BAF7A', '#EDA100', '#E87BA4', '#008300', '#4A3AA7', '#E34948'],
  chartGrid: 'rgba(0, 0, 0, 0.09)',
};

const dark: ThemeColors = {
  background: '#0C0C0E',
  surface: '#111114',
  surfaceMuted: '#1A1A1E',
  inputBackground: '#111114',
  text: '#EDEDF0',
  mutedText: '#A6A6B0',
  border: '#232328',
  borderStrong: '#35353B',
  primary: '#3BAFC1',
  primaryText: '#071A1D',
  primaryBg: '#0F2629',
  agent: '#C3B5FD',
  agentBg: '#21183A',
  danger: '#E96772',
  dangerBg: '#371B1D',
  success: '#72CA72',
  successBg: '#192E19',
  warning: '#FBBE25',
  warningBg: '#211A0B',
  info: '#3BAFC1',
  infoBg: '#0F2629',
  scrim: 'rgba(0, 0, 0, 0.6)',
  codeBackground: '#1A1A1E',
  chart: ['#3987E5', '#D95926', '#199E70', '#C98500', '#D55181', '#008300', '#9085E9', '#E66767'],
  chartGrid: 'rgba(255, 255, 255, 0.10)',
};

/** Tailwind's 4px scale, which the web uses. */
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
/** Tailwind sizes: xs 12, sm 14 (the web's body text), base 16, lg 18, 2xl 24. */
export const fontSize = { sm: 12, md: 14, lg: 16, xl: 18, title: 24 } as const;
/** The web's `--radius` is 6px: sm = rounded-sm, md = rounded-md/lg, lg = rounded-lg in prose. */
export const radius = { sm: 4, md: 6, lg: 8 } as const;

/** Every pressable uses this so a pressed state looks the same everywhere. */
export const pressedOpacity = 0.7;

/** The web's motion: enter 150-220 ms decelerating, exit ~100 ms. */
export const motion = { fast: 100, normal: 150, slow: 220 } as const;

/**
 * Text presets, matching the web's Tailwind classes. Each names a font family
 * (never a `fontWeight`), because Android ignores weight on a custom font.
 * Feature code should spread a preset rather than set a font by hand.
 */
export const typography = {
  title: { fontSize: fontSize.title, lineHeight: 32, fontFamily: fontFamily.semibold } satisfies TextStyle,
  heading: { fontSize: fontSize.xl, lineHeight: 28, fontFamily: fontFamily.semibold } satisfies TextStyle,
  body: { fontSize: fontSize.md, lineHeight: 20, fontFamily: fontFamily.regular } satisfies TextStyle,
  bodyStrong: { fontSize: fontSize.md, lineHeight: 20, fontFamily: fontFamily.medium } satisfies TextStyle,
  label: { fontSize: fontSize.md, lineHeight: 20, fontFamily: fontFamily.medium } satisfies TextStyle,
  caption: { fontSize: fontSize.sm, lineHeight: 16, fontFamily: fontFamily.regular } satisfies TextStyle,
  mono: { fontSize: 13, lineHeight: 18, fontFamily: fontFamily.mono } satisfies TextStyle,
} as const;

export type TypographyPreset = keyof typeof typography;

export { fontFamily };

export interface Theme {
  dark: boolean;
  colors: ThemeColors;
  spacing: typeof spacing;
  fontSize: typeof fontSize;
  radius: typeof radius;
  typography: typeof typography;
}

export function useTheme(): Theme {
  const dark_ = useColorScheme() === 'dark';
  return useMemo(
    () => ({ dark: dark_, colors: dark_ ? dark : light, spacing, fontSize, radius, typography }),
    [dark_],
  );
}
