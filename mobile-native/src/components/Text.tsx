import { createContext, useContext } from 'react';
import { Text as RNText, StyleSheet, type TextProps, type TextStyle } from 'react-native';

import { fontFamily } from '../fonts';

/**
 * Every piece of text in the app goes through this, so it is drawn in the web
 * app's font (IBM Plex Sans) on Android and iOS alike.
 *
 * Android does not choose a weight from `fontWeight` for a custom font, so the
 * weight is turned into the matching family here and `fontWeight` is dropped.
 * Text nested inside other text inherits its parent's family unless it asks
 * for a weight of its own, the way nested text behaves on the web.
 */
const BY_WEIGHT: Record<string, string> = {
  normal: fontFamily.regular,
  '100': fontFamily.regular,
  '200': fontFamily.regular,
  '300': fontFamily.regular,
  '400': fontFamily.regular,
  '500': fontFamily.medium,
  '600': fontFamily.semibold,
  bold: fontFamily.bold,
  '700': fontFamily.bold,
  '800': fontFamily.bold,
  '900': fontFamily.bold,
};

const MONO = new Set<string>([fontFamily.mono, fontFamily.monoMedium]);
const PLEX = new Set<string>(Object.values(fontFamily));

const InsideText = createContext(false);

function familyFor(style: TextStyle, nested: boolean): string | undefined {
  const { fontFamily: family, fontWeight } = style;
  if (family && MONO.has(family)) {
    return fontWeight && String(fontWeight) >= '500' ? fontFamily.monoMedium : family;
  }
  // A family that is not ours (e.g. a system monospace) is left alone.
  if (family && !PLEX.has(family)) return family;
  if (fontWeight != null) return BY_WEIGHT[String(fontWeight)] ?? fontFamily.regular;
  if (family) return family;
  return nested ? undefined : fontFamily.regular;
}

export function Text({ style, ...rest }: TextProps) {
  const nested = useContext(InsideText);
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  const family = familyFor(flat, nested);
  const fixed: TextStyle = family ? { fontFamily: family, fontWeight: undefined } : {};
  return (
    <InsideText.Provider value>
      <RNText {...rest} style={[style, fixed]} />
    </InsideText.Provider>
  );
}
