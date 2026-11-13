import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';

import { ErrorState } from '../../components/ErrorState';
import { LoadingState } from '../../components/LoadingState';
import { Screen } from '../../components/Screen';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Section } from '../../components/Section';
import { Text } from '../../components/Text';
import { success } from '../../lib/haptics';
import { spacing, typography, useTheme } from '../../theme';
import { errorMessage } from '../settings/errors';
import { Notice } from '../settings/Notice';
import { THEME_OPTIONS } from './format';
import { useAccountProfile, useUpdateAccountProfile } from './queries';
import type { ThemePreference } from './types';

/**
 * The theme preference the account keeps for every device. The phone draws in
 * the system's light or dark mode for now; the choice is saved so the web app
 * and the next device agree with it.
 */
export function AppearanceScreen() {
  const { colors } = useTheme();
  const profile = useAccountProfile();
  const update = useUpdateAccountProfile();
  const [pending, setPending] = useState<ThemePreference | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'success' | 'danger' } | null>(null);

  if (profile.isPending) return <LoadingState text="Loading" />;
  if (profile.isError || !profile.data) {
    return <ErrorState message="Could not load your appearance settings. Check your connection and try again." onRetry={() => void profile.refetch()} />;
  }

  const current: ThemePreference = pending ?? profile.data.theme_preference ?? 'system';

  function choose(next: ThemePreference) {
    setPending(next);
    setNotice(null);
    update.mutate(
      { theme_preference: next },
      {
        onSuccess: () => {
          success();
          setPending(null);
          setNotice({ text: 'Theme saved', tone: 'success' });
        },
        onError: (err) => {
          setPending(null);
          setNotice({ text: errorMessage(err, 'Could not save your theme. Check your connection and try again.'), tone: 'danger' });
        },
      },
    );
  }

  return (
    <Screen edges={['left', 'right']}>
      <Stack.Screen options={{ title: 'Appearance' }} />
      <ScrollView contentContainerStyle={{ gap: spacing.xl, paddingBottom: spacing.xxl }}>
        <Section title="Theme" footer="The app follows your phone's light or dark mode. Your choice is saved to your account.">
          <View style={{ padding: spacing.lg, gap: spacing.md }}>
            <SegmentedControl<ThemePreference>
              value={current}
              onChange={choose}
              items={THEME_OPTIONS.map((o) => ({ key: o.value, label: o.label, count: 0 }))}
            />
          </View>
        </Section>
        <Notice message={notice?.text} tone={notice?.tone} />
        <Text style={[typography.caption, { color: colors.mutedText }]}>
          The phone uses the default teal accent. Other accent colours are chosen on the web app.
        </Text>
      </ScrollView>
    </Screen>
  );
}
