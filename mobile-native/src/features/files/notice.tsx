import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { Text } from '../../components/Text';
import { fontSize, radius, spacing, useTheme } from '../../theme';

export type NoticeTone = 'success' | 'danger';
export interface Notice {
  text: string;
  tone: NoticeTone;
}

const SHOW_MS = 4000;

/** A one-line message at the top of a screen. The web's toasts, without the stack. */
export function useNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setNotice(null);
  }, []);

  const show = useCallback((text: string, tone: NoticeTone = 'success') => {
    if (timer.current) clearTimeout(timer.current);
    setNotice({ text, tone });
    timer.current = setTimeout(() => {
      timer.current = null;
      setNotice(null);
    }, SHOW_MS);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return { notice, show, dismiss };
}

export function NoticeBar({ notice, onDismiss }: { notice: Notice | null; onDismiss: () => void }) {
  const { colors } = useTheme();
  if (!notice) return null;
  const danger = notice.tone === 'danger';
  return (
    <Pressable
      accessibilityRole={danger ? 'alert' : 'text'}
      accessibilityLabel={`${notice.text}. Tap to dismiss`}
      onPress={onDismiss}
      style={[
        styles.bar,
        { backgroundColor: danger ? colors.dangerBg : colors.successBg, borderRadius: radius.md },
      ]}
    >
      <Text style={{ color: danger ? colors.danger : colors.success, fontSize: fontSize.md }}>{notice.text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
});
