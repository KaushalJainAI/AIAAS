import { Switch as RNSwitch, type SwitchProps } from 'react-native';

import { useTheme } from '../theme';

/**
 * The one on/off switch. The OS default is green on iOS and the accent colour on
 * Android; this one is the web app's primary on both, with a white thumb.
 */
export function Switch({ trackColor, thumbColor, ios_backgroundColor, ...rest }: SwitchProps) {
  const { colors } = useTheme();
  return (
    <RNSwitch
      trackColor={trackColor ?? { false: colors.borderStrong, true: colors.primary }}
      thumbColor={thumbColor ?? '#FFFFFF'}
      ios_backgroundColor={ios_backgroundColor ?? colors.borderStrong}
      {...rest}
    />
  );
}
