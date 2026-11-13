/**
 * Haptic feedback for the moments that matter: approve, reject, send, delete.
 * Every call is fire-and-forget and never throws, so a device without a motor
 * (or a web build) simply does nothing.
 */
import * as Haptics from 'expo-haptics';

function quietly(run: () => Promise<void>): void {
  try {
    run().catch(() => {
      // Unsupported device: no feedback, and nothing to report.
    });
  } catch {
    // The native module is missing in this build: no feedback.
  }
}

/** A light tap: a button press, a selection. */
export function tap(): void {
  quietly(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** The action went through: approved, sent, saved. */
export function success(): void {
  quietly(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** Needs attention: a destructive action is about to run, or a request was refused. */
export function warning(): void {
  quietly(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
}
