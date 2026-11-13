import { useState, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Switch } from '../../../src/components/Switch';

import { ApiError } from '../../../src/api/client';
import { ErrorText } from '../../../src/components/ErrorText';
import { Screen } from '../../../src/components/Screen';
import { Text } from '../../../src/components/Text';
import { PushPrompt } from '../../../src/notifications/PushPrompt';
import { toApiTime, toInputTime } from '../../../src/features/settings/format';
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from '../../../src/features/settings/queries';
import type { NotificationPreferencesPatch } from '../../../src/features/settings/types';
import { fontFamily, useTheme } from '../../../src/theme';

/**
 * The reminder rules the web app exposes, minus the browser-only ones (device
 * pings and background push). Each change saves at once and rolls back if the
 * server refuses it.
 */
export default function NotificationsScreen() {
  const { colors, spacing, fontSize } = useTheme();
  const prefs = useNotificationPreferences();
  const save = useUpdateNotificationPreferences();

  const saveError = save.isError
    ? save.error instanceof ApiError
      ? save.error.message
      : 'Could not save notification settings. Check your connection and try again.'
    : null;

  if (prefs.isPending) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <ActivityIndicator color={colors.primary} />
      </Screen>
    );
  }

  if (prefs.isError || !prefs.data) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <ErrorText message="Could not load notification settings. Check your connection and reopen this screen." />
      </Screen>
    );
  }

  const p = prefs.data;
  const update = (patch: NotificationPreferencesPatch) => save.mutate(patch);

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.xxl }}>
        <PushPrompt />

        <Group>
          <ToggleRow
            title="Escalating reminders"
            description="Nudge straight away, again after an hour, then once more a day later. Stops as soon as you respond."
            value={p.hitl_escalation_enabled}
            disabled={save.isPending}
            onChange={(v) => update({ hitl_escalation_enabled: v })}
          />
          <ToggleRow
            title="Hourly reminders"
            description="One extra reminder every hour while anything is still waiting on you."
            value={p.hourly_reminders_enabled}
            disabled={save.isPending}
            onChange={(v) => update({ hourly_reminders_enabled: v })}
          />
        </Group>

        <Group>
          <ToggleRow
            title="Daily email digest"
            description="One roll-up of everything still open, at a time you pick. The only email we send, and never more than one a day."
            value={p.daily_digest_enabled}
            disabled={save.isPending}
            onChange={(v) => update({ daily_digest_enabled: v })}
          />
          {p.daily_digest_enabled ? (
            <TimeRow label="Send at" serverValue={p.daily_digest_time} disabled={save.isPending} onSave={(t) => update({ daily_digest_time: t })} />
          ) : null}
          {p.daily_digest_enabled ? (
            <Text style={{ color: colors.mutedText, fontSize: fontSize.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
              Times are in {p.effective_timezone}
              {p.timezone ? '' : ' (from your profile)'}
              {p.last_digest_sent_on ? ` · last sent ${p.last_digest_sent_on}` : ''}
            </Text>
          ) : null}
        </Group>

        <Group>
          <ToggleRow
            title="Quiet hours"
            description="Hold device reminders overnight. Requests still wait in your Inbox, and the daily digest keeps its chosen time."
            value={p.quiet_hours_enabled}
            disabled={save.isPending}
            onChange={(v) => update({ quiet_hours_enabled: v })}
          />
          {p.quiet_hours_enabled ? (
            <TimeRow label="From" serverValue={p.quiet_hours_start} disabled={save.isPending} onSave={(t) => update({ quiet_hours_start: t })} />
          ) : null}
          {p.quiet_hours_enabled ? (
            <TimeRow label="Until" serverValue={p.quiet_hours_end} disabled={save.isPending} onSave={(t) => update({ quiet_hours_end: t })} />
          ) : null}
        </Group>

        <ErrorText message={saveError} />
      </ScrollView>
    </Screen>
  );
}

function Group({ children }: { children: ReactNode }) {
  const { colors, radius } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: radius.md,
        overflow: 'hidden',
      }}
    >
      {children}
    </View>
  );
}

function ToggleRow({
  title,
  description,
  value,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  value: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  const { colors, spacing, fontSize } = useTheme();
  return (
    <View style={[styles.row, { padding: spacing.lg, gap: spacing.md, borderTopColor: colors.border }]}>
      <View style={{ flex: 1, gap: spacing.xs }}>
        <Text style={{ color: colors.text, fontSize: fontSize.md, fontWeight: '600' }}>{title}</Text>
        <Text style={{ color: colors.mutedText, fontSize: fontSize.sm, lineHeight: 19 }}>{description}</Text>
      </View>
      <Switch
        accessibilityLabel={title}
        accessibilityRole="switch"
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor={colors.primaryText}
      />
    </View>
  );
}

/**
 * A 24-hour time typed as HH:MM. There is no native time picker in the app's
 * dependencies, so this is a text field. It saves on blur when the value is
 * valid and changed, and reverts when it is not.
 */
function TimeRow({
  label,
  serverValue,
  disabled,
  onSave,
}: {
  label: string;
  serverValue: string;
  disabled: boolean;
  onSave: (apiTime: string) => void;
}) {
  const { colors, spacing, fontSize, radius } = useTheme();
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const shown = draft ?? toInputTime(serverValue);

  function commit() {
    const parsed = toApiTime(shown);
    if (parsed === null) {
      setInvalid(true);
      setDraft(null);
      return;
    }
    setInvalid(false);
    setDraft(null);
    if (parsed !== serverValue) onSave(parsed);
  }

  return (
    <View style={[styles.row, { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md, borderTopColor: colors.border }]}>
      <Text style={{ color: colors.text, fontSize: fontSize.md, flex: 1 }}>{label}</Text>
      <View style={{ alignItems: 'flex-end', gap: spacing.xs }}>
        <TextInput
          accessibilityLabel={`${label} time, 24-hour HH:MM`}
          value={shown}
          onChangeText={(text) => {
            setInvalid(false);
            setDraft(text);
          }}
          onEndEditing={commit}
          editable={!disabled}
          keyboardType="numbers-and-punctuation"
          maxLength={5}
          placeholder="HH:MM"
          placeholderTextColor={colors.mutedText}
          style={{
            color: colors.text,
            backgroundColor: colors.inputBackground,
            borderColor: invalid ? colors.danger : colors.border,
            borderWidth: StyleSheet.hairlineWidth,
            borderRadius: radius.sm,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            fontSize: fontSize.md,
            fontFamily: fontFamily.regular,
            minWidth: 90,
            textAlign: 'center',
          }}
        />
        {invalid ? (
          <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: fontSize.sm }}>
            Use 24-hour time, like 09:00
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth },
});
