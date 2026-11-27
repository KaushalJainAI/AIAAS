import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '../../components/Button';
import { ErrorText } from '../../components/ErrorText';
import { Icon } from '../../components/Icon';
import { ListRow } from '../../components/ListRow';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Section } from '../../components/Section';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { pressedOpacity, radius, spacing, typography, useTheme } from '../../theme';
import type { CardField } from './types';

/** Up to this many options show as a segmented choice; more open a list in a sheet. */
const SEGMENT_MAX = 3;

/**
 * What a field holds: what was typed or picked, else the first option (a
 * choice always has one). Shared by the form and the submit, so they agree.
 */
export function fieldValue(field: CardField, values: Record<string, string>): string {
  return values[field.name] ?? field.options?.[0] ?? '';
}

/**
 * Checks every field before Connect is sent. A blank field and a value that
 * does not match its `pattern` each get a message. The pattern is anchored, as
 * an HTML `pattern` is. A pattern that is not a valid expression is skipped, and
 * the server still checks it. `payload` holds the trimmed values to send.
 */
export function validateCardFields(
  fields: CardField[],
  values: Record<string, string>,
): { errors: Record<string, string>; payload: Record<string, string> } {
  const errors: Record<string, string> = {};
  const payload: Record<string, string> = {};
  for (const field of fields) {
    const value = fieldValue(field, values).trim();
    payload[field.name] = value;
    if (!value) {
      errors[field.name] = `Enter ${field.label.toLowerCase()}.`;
      continue;
    }
    if (field.pattern) {
      let matches = true;
      try {
        matches = new RegExp(`^(?:${field.pattern})$`).test(value);
      } catch {
        matches = true;
      }
      if (!matches) errors[field.name] = `${field.label} is not in the right format.`;
    }
  }
  return { errors, payload };
}

interface Props {
  fields: CardField[];
  /** What the user has typed or picked so far, by field name. */
  values: Record<string, string>;
  /** Per-field messages from the last Connect press. */
  errors: Record<string, string>;
  onChange: (name: string, value: string) => void;
  onConnect: () => void;
  connecting: boolean;
  /** The server's sentence when Connect failed. */
  error: string | null;
}

/**
 * The Details section of an API card: one input per field the card asks for,
 * then Connect. Presentational only. The parent holds the values, runs
 * `validateCardFields` and makes the call. With no fields it is just Connect.
 */
export function CardFieldsSection({ fields, values, errors, onChange, onConnect, connecting, error }: Props) {
  const { colors } = useTheme();
  const [picking, setPicking] = useState<CardField | null>(null);

  return (
    <>
      <Section title="Details">
        {fields.map((field) => {
          const value = fieldValue(field, values);
          const help = field.help ? (
            <Text style={[typography.caption, { color: colors.mutedText }]}>{field.help}</Text>
          ) : null;

          if (field.options && field.options.length > 0) {
            const options = field.options;
            return (
              <View key={field.name} style={styles.field}>
                <Text style={[typography.label, { color: colors.text }]}>{field.label}</Text>
                {options.length <= SEGMENT_MAX ? (
                  <SegmentedControl
                    items={options.map((option) => ({ key: option, label: option, count: 0 }))}
                    value={value}
                    onChange={(next) => onChange(field.name, next)}
                  />
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${field.label}: ${value || 'not chosen'}`}
                    onPress={() => setPicking(field)}
                    style={({ pressed }) => [
                      styles.picker,
                      {
                        backgroundColor: colors.inputBackground,
                        borderColor: errors[field.name] ? colors.danger : colors.borderStrong,
                        borderRadius: radius.md,
                        opacity: pressed ? pressedOpacity : 1,
                      },
                    ]}
                  >
                    <Text style={[typography.body, styles.pickerText, { color: colors.text }]} numberOfLines={1}>
                      {value || 'Choose'}
                    </Text>
                    <Icon name="chevron-down" size={18} color={colors.mutedText} />
                  </Pressable>
                )}
                <ErrorText message={errors[field.name]} />
                {help}
              </View>
            );
          }

          return (
            <View key={field.name} style={styles.field}>
              <TextField
                label={field.label}
                value={value}
                onChangeText={(text) => onChange(field.name, text)}
                error={errors[field.name]}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
              />
              {help}
            </View>
          );
        })}

        <View style={styles.field}>
          <ErrorText message={error} />
          <Button title="Connect" loading={connecting} disabled={connecting} onPress={onConnect} />
        </View>
      </Section>

      {/* Outside the Section: inside it, the sheet's host would be drawn as a grouped row. */}
      <Sheet visible={picking !== null} title={picking?.label} onClose={() => setPicking(null)}>
        {picking ? (
          <View style={{ paddingBottom: spacing.md }}>
            <Section>
              {(picking.options ?? []).map((option) => {
                const chosen = fieldValue(picking, values) === option;
                return (
                  <ListRow
                    key={option}
                    title={option}
                    chevron={false}
                    detail={chosen ? <Icon name="checkmark" size={20} color={colors.primary} /> : undefined}
                    onPress={() => {
                      onChange(picking.name, option);
                      setPicking(null);
                    }}
                  />
                );
              })}
            </Section>
          </View>
        ) : null}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  field: { padding: spacing.lg, gap: spacing.sm },
  picker: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pickerText: { flex: 1 },
});
