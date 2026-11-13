/**
 * Form controls for the agent builder: the rows, switches, steppers, chips and
 * pickers every builder screen is made of. Shared with Imagine's form, so the two
 * screens read the same way.
 *
 * Text comes from `components/Text` (the web's font), and every TextInput sets
 * the regular family itself, as DESIGN.md asks.
 */
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { Switch } from '../../components/Switch';

import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { tap } from '../../lib/haptics';
import { fontFamily, fontSize, pressedOpacity, radius, spacing, typography, useTheme } from '../../theme';

/* ---------- layout ---------- */

/** A labelled field: label on the left, an optional hint on the right, the control, then any error. */
export function Field({ label, hint, error, children }: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <View style={styles.fieldHead}>
        <Text style={[typography.label, { color: error ? colors.danger : colors.text }]}>{label}</Text>
        {hint ? (
          <Text style={[typography.caption, styles.hint, { color: colors.mutedText }]}>{hint}</Text>
        ) : null}
      </View>
      {children}
      {error ? (
        <Text accessibilityRole="alert" style={[typography.caption, { color: colors.danger }]}>{error}</Text>
      ) : null}
    </View>
  );
}

/** A panel that groups fields. The same surface every builder screen puts its fields on. */
export function Panel({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.panel,
        { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg },
      ]}
    >
      {children}
    </View>
  );
}

/** Helper text under a control. */
export function Note({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'danger' | 'warning' }) {
  const { colors } = useTheme();
  const color = tone === 'danger' ? colors.danger : tone === 'warning' ? colors.warning : colors.mutedText;
  return <Text style={[typography.caption, { color }]}>{children}</Text>;
}

/** A boxed message, for a refusal or a warning the person must read. */
export function Notice({ text, tone = 'danger' }: { text: string; tone?: 'danger' | 'warning' | 'info' }) {
  const { colors } = useTheme();
  const fg = tone === 'danger' ? colors.danger : tone === 'warning' ? colors.warning : colors.info;
  const bg = tone === 'danger' ? colors.dangerBg : tone === 'warning' ? colors.warningBg : colors.infoBg;
  return (
    <View accessibilityRole="alert" style={[styles.notice, { backgroundColor: bg, borderColor: fg, borderRadius: radius.md }]}>
      <Text style={[typography.body, { color: fg }]}>{text}</Text>
    </View>
  );
}

/* ---------- text ---------- */

/** A text input in the app's look. Multiline takes a taller box. */
export function TextBox({ multiline, style, ...props }: TextInputProps) {
  const { colors } = useTheme();
  return (
    <TextInput
      placeholderTextColor={colors.mutedText}
      multiline={multiline}
      {...props}
      style={[
        styles.input,
        {
          fontFamily: fontFamily.regular,
          fontSize: fontSize.md,
          color: colors.text,
          backgroundColor: colors.inputBackground,
          borderColor: colors.border,
          borderRadius: radius.md,
          minHeight: multiline ? 96 : 44,
          textAlignVertical: multiline ? 'top' : 'center',
        },
        style,
      ]}
    />
  );
}

/* ---------- switches and steppers ---------- */

/** A whole row that flips a boolean. The switch is decorative; the row is the target. */
export function SwitchRow({ label, hint, value, onChange }: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ checked: value }}
      onPress={() => {
        tap();
        onChange(!value);
      }}
      style={({ pressed }) => [styles.switchRow, { opacity: pressed ? pressedOpacity : 1 }]}
    >
      <View style={styles.grow}>
        <Text style={[typography.label, { color: colors.text }]}>{label}</Text>
        {hint ? <Text style={[typography.caption, { color: colors.mutedText }]}>{hint}</Text> : null}
      </View>
      <View pointerEvents="none">
        <Switch
          value={value}
          onValueChange={onChange}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor={colors.surface}
        />
      </View>
    </Pressable>
  );
}

/** A number with − and + buttons, clamped to a range. Buttons are 44pt. */
export function Stepper({ label, value, min, max, step, format, onChange, hint }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (value: number) => string;
  onChange: (next: number) => void;
  hint?: string;
}) {
  const { colors } = useTheme();
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n * 1000) / 1000));
  const button = (symbol: string, next: number, disabled: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${symbol === '+' ? 'Increase' : 'Decrease'} ${label}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        tap();
        onChange(clamp(next));
      }}
      style={({ pressed }) => [
        styles.stepButton,
        { borderColor: colors.border, borderRadius: radius.md, opacity: disabled ? 0.4 : pressed ? pressedOpacity : 1 },
      ]}
    >
      <Text style={[typography.label, { color: colors.text }]}>{symbol}</Text>
    </Pressable>
  );
  return (
    <Field label={label} hint={hint}>
      <View style={styles.stepper}>
        {button('−', value - step, value <= min)}
        <Text accessibilityLabel={`${label} is ${format ? format(value) : value}`} style={[typography.label, styles.stepValue, { color: colors.text }]}>
          {format ? format(value) : String(value)}
        </Text>
        {button('+', value + step, value >= max)}
      </View>
    </Field>
  );
}

/* ---------- choices ---------- */

export interface Option<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

/** A horizontal row of pills. For a few short choices. */
export function Chips<T extends string>({ options, value, onChange, allowNone }: {
  options: Option<T>[];
  value: T | '' | null | undefined;
  onChange: (next: T | '') => void;
  /** Adds a leading "Default" pill that clears the value. */
  allowNone?: boolean;
}) {
  const { colors } = useTheme();
  const all: Option<T | ''>[] = allowNone ? [{ value: '', label: 'Default' }, ...options] : options;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {all.map((option) => {
        const on = (value ?? '') === option.value;
        return (
          <Pressable
            key={option.value || 'none'}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            accessibilityState={{ selected: on }}
            onPress={() => {
              tap();
              onChange(option.value);
            }}
            style={({ pressed }) => [
              styles.chip,
              {
                borderColor: on ? colors.primary : colors.border,
                backgroundColor: on ? colors.primary : colors.surface,
                borderRadius: radius.md,
                opacity: pressed ? pressedOpacity : 1,
              },
            ]}
          >
            <Text style={[typography.caption, { color: on ? colors.primaryText : colors.text }]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** One radio row per choice, with its hint. For a closed set the person should read. */
export function ChoiceList<T extends string>({ options, value, onChange }: {
  options: Option<T>[];
  value: T;
  onChange: (next: T) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected: on, checked: on }}
            onPress={() => {
              tap();
              onChange(option.value);
            }}
            style={({ pressed }) => [
              styles.choice,
              {
                borderColor: on ? colors.primary : colors.border,
                backgroundColor: on ? colors.infoBg : colors.surface,
                borderRadius: radius.md,
                opacity: pressed ? pressedOpacity : 1,
              },
            ]}
          >
            <View style={[styles.radio, { borderColor: on ? colors.primary : colors.mutedText }]}>
              {on ? <View style={[styles.radioDot, { backgroundColor: colors.primary }]} /> : null}
            </View>
            <View style={styles.grow}>
              <Text style={[typography.label, { color: colors.text }]}>{option.label}</Text>
              {option.hint ? <Text style={[typography.caption, { color: colors.mutedText }]}>{option.hint}</Text> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ---------- pickers (in a sheet) ---------- */

/** A row that shows the current choice and opens a picker sheet. */
export function PickerRow({ label, value, placeholder, onPress, error, hint }: {
  label: string;
  value: string;
  placeholder?: string;
  onPress: () => void;
  error?: string | null;
  hint?: string;
}) {
  const { colors } = useTheme();
  const empty = !value;
  return (
    <Field label={label} hint={hint} error={error}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value || placeholder || 'none'}`}
        onPress={() => {
          tap();
          onPress();
        }}
        style={({ pressed }) => [
          styles.picker,
          {
            backgroundColor: colors.inputBackground,
            borderColor: error ? colors.danger : colors.border,
            borderRadius: radius.md,
            opacity: pressed ? pressedOpacity : 1,
          },
        ]}
      >
        <Text numberOfLines={1} style={[typography.body, styles.grow, { color: empty ? colors.mutedText : colors.text }]}>
          {value || placeholder || 'Choose'}
        </Text>
        <Icon name="chevron-expand-outline" size={16} color={colors.mutedText} />
      </Pressable>
    </Field>
  );
}

function OptionRow({ label, hint, selected, onPress, multi }: {
  label: string;
  hint?: string;
  selected: boolean;
  onPress: () => void;
  multi?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityLabel={label}
      accessibilityState={{ selected, checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.option, { opacity: pressed ? pressedOpacity : 1 }]}
    >
      <View style={styles.grow}>
        <Text style={[typography.label, { color: colors.text }]}>{label}</Text>
        {hint ? <Text numberOfLines={2} style={[typography.caption, { color: colors.mutedText }]}>{hint}</Text> : null}
      </View>
      {selected ? <Icon name="checkmark" size={20} color={colors.primary} /> : null}
    </Pressable>
  );
}

/** Pick one value from a list, in a bottom sheet. Searchable for long lists. */
export function PickerSheet<T extends string>({ visible, title, options, value, onSelect, onClose, searchable = false, emptyText }: {
  visible: boolean;
  title: string;
  options: Option<T>[];
  value: T | '' | null | undefined;
  onSelect: (next: T) => void;
  onClose: () => void;
  searchable?: boolean;
  emptyText?: string;
}) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = options.filter((o) => !needle || `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(needle));
  const { spacing: s } = useTheme();
  return (
    <Sheet visible={visible} title={title} onClose={() => { setQuery(''); onClose(); }}>
      {searchable ? (
        <TextBox
          accessibilityLabel="Search"
          placeholder="Search"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          style={{ marginBottom: s.sm }}
        />
      ) : null}
      <ScrollView style={styles.sheetList} keyboardShouldPersistTaps="handled">
        {shown.map((o) => (
          <OptionRow
            key={o.value}
            label={o.label}
            hint={o.hint}
            selected={o.value === value}
            onPress={() => {
              tap();
              onSelect(o.value);
              setQuery('');
              onClose();
            }}
          />
        ))}
        {shown.length === 0 ? <Note>{emptyText ?? 'Nothing matches.'}</Note> : null}
      </ScrollView>
    </Sheet>
  );
}

/** Pick any number of values, in a bottom sheet. Done closes it. */
export function MultiPickerSheet({ visible, title, options, value, onChange, onClose, searchable = false, emptyText }: {
  visible: boolean;
  title: string;
  options: Option<string>[];
  value: string[];
  onChange: (next: string[]) => void;
  onClose: () => void;
  searchable?: boolean;
  emptyText?: string;
}) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = options.filter((o) => !needle || `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(needle));
  const { spacing: s, colors } = useTheme();
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <Sheet visible={visible} title={title} onClose={() => { setQuery(''); onClose(); }}>
      {searchable ? (
        <TextBox
          accessibilityLabel="Search"
          placeholder="Search"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          style={{ marginBottom: s.sm }}
        />
      ) : null}
      <ScrollView style={styles.sheetList} keyboardShouldPersistTaps="handled">
        {shown.map((o) => (
          <OptionRow
            key={o.value}
            multi
            label={o.label}
            hint={o.hint}
            selected={value.includes(o.value)}
            onPress={() => {
              tap();
              toggle(o.value);
            }}
          />
        ))}
        {shown.length === 0 ? <Note>{emptyText ?? 'Nothing to choose from yet.'}</Note> : null}
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: s.md, marginTop: s.md }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear selection"
          disabled={value.length === 0}
          onPress={() => onChange([])}
          style={({ pressed }) => [
            styles.sheetButton,
            { borderColor: colors.border, opacity: value.length === 0 ? 0.4 : pressed ? pressedOpacity : 1 },
          ]}
        >
          <Text style={[typography.label, { color: colors.text }]}>Clear</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Done"
          onPress={() => {
            setQuery('');
            onClose();
          }}
          style={({ pressed }) => [
            styles.sheetButton,
            { backgroundColor: colors.primary, borderWidth: 0, opacity: pressed ? pressedOpacity : 1 },
          ]}
        >
          <Text style={[typography.label, { color: colors.primaryText }]}>Done</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs, paddingVertical: spacing.sm },
  fieldHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  hint: { flexShrink: 1, marginLeft: 'auto', textAlign: 'right' },
  panel: { borderWidth: StyleSheet.hairlineWidth, gap: spacing.md },
  notice: { borderWidth: StyleSheet.hairlineWidth, padding: spacing.md },
  input: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  switchRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  grow: { flex: 1, gap: 2 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepButton: { width: 44, height: 44, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  stepValue: { minWidth: 64, textAlign: 'center' },
  chips: { gap: spacing.sm, paddingVertical: spacing.xs },
  chip: { minHeight: 44, paddingHorizontal: spacing.md, justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  choice: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderWidth: StyleSheet.hairlineWidth },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  picker: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderWidth: StyleSheet.hairlineWidth },
  option: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  sheetList: { maxHeight: 420 },
  sheetButton: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
});
