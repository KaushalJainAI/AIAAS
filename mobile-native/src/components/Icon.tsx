import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

import { useTheme } from '../theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

interface Props {
  name: IconName;
  size?: number;
  /** Defaults to the theme text colour. Only a plain colour string is used; anything else falls back to the theme. */
  color?: ColorValue;
}

/** Ionicons, so every platform draws the same glyph. */
export function Icon({ name, size = 22, color }: Props) {
  const { colors } = useTheme();
  const resolved = typeof color === 'string' ? color : colors.text;
  return <Ionicons name={name} size={size} color={resolved} />;
}
