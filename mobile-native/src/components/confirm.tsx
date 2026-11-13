import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, View } from 'react-native';

import { pressedOpacity, useTheme } from '../theme';
import { Text } from './Text';

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** When set, the confirm button is styled destructive and reads this, e.g. "Delete". */
  destructiveLabel?: string;
  /** The confirm button's text when the action is not destructive. Defaults to "OK". */
  confirmLabel?: string;
  cancelLabel?: string;
}

interface Pending extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

/**
 * The confirmation dialog is drawn by the app, not the OS, so it looks the same
 * on Android, iOS and the web (the web uses its own styled dialog too).
 * `ConfirmHost` is mounted once at the root; `confirm()` hands it a question.
 */
let show: ((pending: Pending) => void) | null = null;

/** Resolves true when the user confirms, false on cancel or on dismissal. */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (show) {
      show({ ...options, resolve });
      return;
    }
    // No host mounted (should not happen): fall back to the OS alert.
    const { title, message, destructiveLabel, confirmLabel, cancelLabel = 'Cancel' } = options;
    let settled = false;
    const finish = (value: boolean) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    Alert.alert(
      title,
      message,
      [
        { text: cancelLabel, style: 'cancel', onPress: () => finish(false) },
        {
          text: destructiveLabel ?? confirmLabel ?? 'OK',
          style: destructiveLabel ? 'destructive' : 'default',
          onPress: () => finish(true),
        },
      ],
      { cancelable: true, onDismiss: () => finish(false) },
    );
  });
}

export function ConfirmHost() {
  const { colors, spacing, radius, typography } = useTheme();
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    show = (next) =>
      setPending((current) => {
        // A second question while one is open answers the first "no".
        current?.resolve(false);
        return next;
      });
    return () => {
      show = null;
    };
  }, []);

  const answer = (value: boolean) => {
    pending?.resolve(value);
    setPending(null);
  };

  const destructive = Boolean(pending?.destructiveLabel);
  const confirmText = pending?.destructiveLabel ?? pending?.confirmLabel ?? 'OK';

  return (
    <Modal visible={pending != null} transparent animationType="fade" onRequestClose={() => answer(false)} statusBarTranslucent>
      <Pressable
        style={[styles.scrim, { backgroundColor: colors.scrim, padding: spacing.xl }]}
        onPress={() => answer(false)}
        accessibilityLabel="Dismiss"
      >
        <Pressable
          onPress={() => undefined}
          accessibilityRole="alert"
          style={[
            styles.dialog,
            { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.xl },
          ]}
        >
          <Text style={[typography.heading, { color: colors.text }]} accessibilityRole="header">
            {pending?.title}
          </Text>
          {pending?.message ? (
            <Text style={[typography.body, { color: colors.mutedText, marginTop: spacing.sm }]}>{pending.message}</Text>
          ) : null}
          <View style={[styles.actions, { marginTop: spacing.xl, gap: spacing.sm }]}>
            <DialogButton label={pending?.cancelLabel ?? 'Cancel'} onPress={() => answer(false)} />
            <DialogButton label={confirmText} onPress={() => answer(true)} filled tone={destructive ? 'danger' : 'primary'} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function DialogButton({
  label,
  onPress,
  filled = false,
  tone = 'primary',
}: {
  label: string;
  onPress: () => void;
  filled?: boolean;
  tone?: 'primary' | 'danger';
}) {
  const { colors, spacing, radius, typography } = useTheme();
  const fill = tone === 'danger' ? colors.danger : colors.primary;
  const text = filled ? (tone === 'danger' ? '#FFFFFF' : colors.primaryText) : colors.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        {
          minHeight: 44,
          paddingHorizontal: spacing.lg,
          borderRadius: radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: filled ? fill : colors.surface,
          borderWidth: filled ? 0 : StyleSheet.hairlineWidth,
          borderColor: colors.borderStrong,
        },
        pressed && { opacity: pressedOpacity },
      ]}
    >
      <Text style={[typography.label, { color: text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dialog: { width: '100%', maxWidth: 400, borderWidth: StyleSheet.hairlineWidth },
  actions: { flexDirection: 'row', justifyContent: 'flex-end' },
});
