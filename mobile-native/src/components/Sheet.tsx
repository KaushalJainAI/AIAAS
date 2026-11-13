import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from './Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, spacing, typography, useTheme } from '../theme';

const OPEN_MS = 240;
const CLOSE_MS = 200;

interface Props {
  visible: boolean;
  /** Called after the sheet has animated away: backdrop tap, Android back, or a close you trigger. */
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

/**
 * A bottom sheet on a RN Modal. It slides up on open and slides down on any
 * user dismissal, so the sheet leaves the same way on both platforms.
 */
export function Sheet({ visible, onClose, title, children }: Props) {
  // Set by the mounted body, so the hardware back button also animates out.
  const dismissRef = useRef<(() => void) | null>(null);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={() => (dismissRef.current ? dismissRef.current() : onClose())}
    >
      <SheetBody title={title} onClose={onClose} dismissRef={dismissRef}>
        {children}
      </SheetBody>
    </Modal>
  );
}

interface BodyProps {
  title?: string;
  onClose: () => void;
  dismissRef: RefObject<(() => void) | null>;
  children: ReactNode;
}

function SheetBody({ title, onClose, dismissRef, children }: BodyProps) {
  const { colors, radius: r } = useTheme();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  // The body mounts each time the Modal opens, so it starts off-screen.
  const [progress] = useState(() => new Animated.Value(0));
  const closing = useRef(false);

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: OPEN_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress]);

  const dismiss = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(progress, {
      toValue: 0,
      duration: CLOSE_MS,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => onClose());
  }, [progress, onClose]);

  useEffect(() => {
    dismissRef.current = dismiss;
    return () => {
      dismissRef.current = null;
    };
  }, [dismiss, dismissRef]);

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [height, 0] });
  const backdropOpacity = progress;

  return (
    <View style={styles.root}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim, opacity: backdropOpacity }]} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={dismiss}
        style={StyleSheet.absoluteFill}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        pointerEvents="box-none"
        style={styles.anchor}
      >
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              borderTopLeftRadius: r.lg,
              borderTopRightRadius: r.lg,
              paddingBottom: Math.max(insets.bottom, spacing.lg),
              transform: [{ translateY }],
            },
          ]}
        >
          <View style={styles.handleWrap}>
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
          </View>
          {title ? (
            <Text
              accessibilityRole="header"
              style={[typography.heading, styles.title, { color: colors.text, paddingHorizontal: spacing.lg }]}
            >
              {title}
            </Text>
          ) : null}
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>{children}</View>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  anchor: { justifyContent: 'flex-end' },
  sheet: { maxHeight: '90%', overflow: 'hidden' },
  handleWrap: { alignItems: 'center', paddingVertical: spacing.sm },
  handle: { width: 36, height: 5, borderRadius: radius.sm },
  title: { paddingBottom: spacing.sm },
});
