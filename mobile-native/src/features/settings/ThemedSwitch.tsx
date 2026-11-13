import { Switch } from '../../components/Switch';

import { useTheme } from '../../theme';

interface Props {
  /** Accessible name, e.g. "Escalating reminders". */
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}

/** The app's switch: the same track and thumb on both platforms, drawn from theme tokens. */
export function ThemedSwitch({ label, value, onChange, disabled = false }: Props) {
  const { colors } = useTheme();
  return (
    <Switch
      accessibilityLabel={label}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      value={value}
      disabled={disabled}
      onValueChange={onChange}
      trackColor={{ false: colors.border, true: colors.primary }}
      thumbColor={colors.primaryText}
    />
  );
}
