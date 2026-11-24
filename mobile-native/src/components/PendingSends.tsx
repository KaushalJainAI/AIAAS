/**
 * The messages the agent is holding before they go out, one row each, with
 * Cancel and Send now while they can still be stopped. Shown above the chat
 * composer. Mirrors the web's `components/content/PendingSends.tsx`.
 *
 * Props only: the list, the failure line and the callbacks come from
 * `usePendingSends`. A finished row (sent, cancelled, not sent) stays for two
 * minutes, then is hidden, so the outcome is seen and then gets out of the way.
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { TrackedHold } from '../hooks/usePendingSends';
import { Icon } from './Icon';
import { Text } from './Text';
import { pressedOpacity, radius, spacing, typography, useTheme } from '../theme';
import type { HoldStatus } from '../features/messaging/api';

/** How long a finished row stays on screen. */
export const SETTLED_VISIBLE_MS = 120_000;

interface PendingSendsProps {
  holds: TrackedHold[];
  /** A short line for a failed cancel or send-now, shown under the rows. */
  failure?: string | null;
  onCancel: (id: number) => void;
  onSendNow: (id: number) => void;
}

const clock = (total: number): string => {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

/** Seconds left, counted down from the server's figure at the time it was read. */
const left = (hold: TrackedHold, now: number): number =>
  Math.max(0, hold.seconds_left - Math.floor((now - hold.fetchedAt) / 1000));

type Tone = 'muted' | 'success' | 'danger' | 'warning';

/** The line under the label, and its tone. */
function describe(hold: TrackedHold, now: number): { text: string; tone: Tone } {
  switch (hold.status) {
    case 'held': {
      const seconds = left(hold, now);
      return { text: seconds > 0 ? `Sends in ${clock(seconds)}` : 'Sending now…', tone: 'muted' };
    }
    case 'sending':
      return { text: 'Sending…', tone: 'muted' };
    case 'sent':
      return { text: 'Sent ✓', tone: 'success' };
    case 'cancelled':
      return { text: 'Cancelled', tone: 'muted' };
    case 'failed':
      return { text: hold.error ? `Not sent: ${hold.error}` : 'Not sent', tone: 'danger' };
    case 'unknown':
      return { text: 'Might not have been sent', tone: 'warning' };
  }
}

/** Whether a row is still going out (its buttons and its countdown matter). */
const isLive = (status: HoldStatus): boolean => status === 'held' || status === 'sending';

export function PendingSends({ holds, failure = null, onCancel, onSendNow }: PendingSendsProps) {
  const { colors, fontSize: f } = useTheme();

  // A clock for the countdowns. It only runs while there is a row to count.
  const [now, setNow] = useState(() => Date.now());
  const counting = holds.length > 0;
  useEffect(() => {
    if (!counting) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [counting]);

  const visible = holds.filter((hold) => {
    if (isLive(hold.status) || hold.settledAt === undefined) return true;
    return now - hold.settledAt < SETTLED_VISIBLE_MS;
  });

  if (visible.length === 0 && !failure) return null;

  const toneColor: Record<Tone, string> = {
    muted: colors.mutedText,
    success: colors.success,
    danger: colors.danger,
    warning: colors.warning,
  };

  return (
    <View
      accessibilityLabel="Messages waiting to send"
      accessibilityLiveRegion="polite"
      style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm }}
    >
      {visible.map((hold) => {
        const { text, tone } = describe(hold, now);
        const iconName = hold.tool === 'gmail_send_message' ? 'mail-outline' : 'chatbubble-outline';
        return (
          <View
            key={hold.id}
            style={[
              styles.row,
              {
                gap: spacing.md,
                padding: spacing.md,
                borderRadius: radius.md,
                borderColor: colors.border,
                backgroundColor: colors.surface,
              },
            ]}
          >
            <Icon name={iconName} size={f.lg + 2} color={colors.mutedText} />
            <View style={styles.text}>
              <Text numberOfLines={1} style={[typography.label, { color: colors.text }]}>
                {hold.label}
              </Text>
              <Text style={[typography.caption, { color: toneColor[tone] }]}>{text}</Text>
            </View>
            {hold.status === 'held' && (
              <View style={[styles.actions, { gap: spacing.sm }]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Cancel: ${hold.label}`}
                  onPress={() => onCancel(hold.id)}
                  style={({ pressed }) => [
                    styles.button,
                    {
                      borderRadius: radius.md,
                      borderColor: colors.border,
                      backgroundColor: colors.surface,
                    },
                    pressed && { opacity: pressedOpacity },
                  ]}
                >
                  <Text style={[typography.label, { color: colors.text }]}>Cancel</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Send now: ${hold.label}`}
                  onPress={() => onSendNow(hold.id)}
                  style={({ pressed }) => [
                    styles.button,
                    { borderRadius: radius.md, backgroundColor: colors.primary },
                    pressed && { opacity: pressedOpacity },
                  ]}
                >
                  <Text style={[typography.label, { color: colors.primaryText }]}>Send now</Text>
                </Pressable>
              </View>
            )}
          </View>
        );
      })}
      {failure ? (
        <Text accessibilityRole="alert" style={[typography.caption, { color: colors.danger }]}>
          {failure}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  text: { flex: 1, minWidth: 0 },
  actions: { flexDirection: 'row', alignItems: 'center' },
  // The web's 44px touch target on phones.
  button: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
});

export default PendingSends;
