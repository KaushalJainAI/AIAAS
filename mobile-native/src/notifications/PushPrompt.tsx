import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Button } from '../components/Button';
import { ErrorText } from '../components/ErrorText';
import { Text } from '../components/Text';
import { success, tap } from '../lib/haptics';
import { useTheme } from '../theme';
import { disablePush, enablePush, isPushEnabled } from './push';

/**
 * The control for "notifications on this phone". Place it in Settings. It asks
 * for permission only when the person presses the button.
 */
export function PushPrompt() {
  const { colors, spacing, typography } = useTheme();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void isPushEnabled().then((value) => {
      if (alive) setEnabled(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function toggle() {
    setBusy(true);
    setMessage(null);
    try {
      if (enabled) {
        await disablePush();
        setEnabled(false);
        tap();
        return;
      }
      const result = await enablePush();
      if (result === 'enabled') {
        setEnabled(true);
        success();
      } else if (result === 'denied') {
        setMessage('Notifications are off for AIAAS in your phone settings. Turn them on there, then try again.');
      } else {
        setMessage('Notifications are not available on this device yet.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not change notifications. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[typography.bodyStrong, { color: colors.text }]} accessibilityRole="header">
        Notifications
      </Text>
      <Text style={[typography.caption, { color: colors.mutedText }]}>
        Get a message on this phone when something needs your attention.
      </Text>
      <Button
        title={enabled ? 'Turn off notifications' : 'Turn on notifications'}
        variant={enabled ? 'secondary' : 'primary'}
        onPress={toggle}
        loading={busy}
        disabled={enabled === null || busy}
      />
      <ErrorText message={message} />
    </View>
  );
}
