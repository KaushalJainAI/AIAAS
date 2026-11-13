import { useState } from 'react';
import Constants from 'expo-constants';
import { router, Stack } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { Button } from '../../components/Button';
import { confirm } from '../../components/confirm';
import { ErrorText } from '../../components/ErrorText';
import { ListRow } from '../../components/ListRow';
import { Screen } from '../../components/Screen';
import { Section } from '../../components/Section';
import { Text } from '../../components/Text';
import { useAuth } from '../../auth/AuthContext';
import { API_ORIGIN } from '../../config';
import { Avatar } from '../account/Avatar';
import { initialsOf, resolveAvatarUrl } from '../account/format';
import { useAccountProfile } from '../account/queries';
import { tierLabel } from './format';
import { spacing, typography, useTheme } from '../../theme';

/** Everything the account can change, grouped the way the web's Settings tabs are. */
export function SettingsHomeScreen() {
  const { colors } = useTheme();
  const { signOut } = useAuth();
  const profile = useAccountProfile();
  const [signingOut, setSigningOut] = useState(false);
  const version = Constants.expoConfig?.version ?? 'unknown';

  const p = profile.data;

  async function onSignOut() {
    const ok = await confirm({
      title: 'Sign out?',
      message: 'You will need to sign in again to use your account on this phone.',
      destructiveLabel: 'Sign out',
    });
    if (!ok) return;
    setSigningOut(true);
    try {
      await signOut(); // the gate in app/_layout.tsx sends the user to /login
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <Screen edges={['left', 'right']}>
      <Stack.Screen options={{ title: 'Settings' }} />
      <ScrollView contentContainerStyle={{ gap: spacing.xl, paddingBottom: spacing.xxl }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open your profile"
          onPress={() => router.push('/settings/profile')}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.lg, opacity: pressed ? 0.7 : 1 })}
        >
          {p ? (
            <Avatar uri={resolveAvatarUrl(p.avatar)} initials={initialsOf(p.name, p.email)} size={56} />
          ) : (
            <View style={{ width: 56, height: 56, alignItems: 'center', justifyContent: 'center' }}>
              {profile.isPending ? <ActivityIndicator color={colors.primary} /> : null}
            </View>
          )}
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={typography.heading} numberOfLines={1}>{p?.name || 'Your name'}</Text>
            <Text style={[typography.caption, { color: colors.mutedText }]} numberOfLines={1}>
              {p ? `${p.email} · ${tierLabel(p.tier)}, ${p.credits} credits left` : ''}
            </Text>
          </View>
        </Pressable>
        {profile.isError ? <ErrorText message="Could not load your account. Check your connection and reopen this tab." /> : null}

        <Section title="Account">
          <ListRow icon="person-circle-outline" title="Profile" subtitle="Your name, what the assistant calls you, and your photo" onPress={() => router.push('/settings/profile')} />
          <ListRow icon="lock-closed-outline" title="Password & email" subtitle="Change your password or sign-in email" onPress={() => router.push('/settings/security')} />
          <ListRow icon="business-outline" title="Organisations" subtitle="Share solved problems with your team" onPress={() => router.push('/settings/organisations')} />
          <ListRow icon="key-outline" title="API keys" subtitle="For scripts and integrations" onPress={() => router.push('/settings/api-keys')} />
        </Section>

        <Section title="Assistant">
          <ListRow icon="options-outline" title="Default model & mode" subtitle="The model, effort and mode new chats start with" onPress={() => router.push('/settings/defaults')} />
          <ListRow icon="sparkles-outline" title="What I remember about you" subtitle="Review and remove the facts the assistant keeps" onPress={() => router.push('/settings/memory')} />
        </Section>

        <Section title="Usage">
          <ListRow icon="card-outline" title="Credits & spend" subtitle="Your allowance, plan and this month's spend" onPress={() => router.push('/settings/usage')} />
          <ListRow icon="bar-chart-outline" title="Insights" subtitle="Runs, cost and quality" onPress={() => router.push('/more/runs')} />
        </Section>

        <Section title="Notifications">
          <ListRow icon="notifications-outline" title="When an agent needs you" subtitle="Reminders, the daily email digest and quiet hours" onPress={() => router.push('/settings/notifications')} />
        </Section>

        <Section title="Display">
          <ListRow icon="color-palette-outline" title="Appearance" subtitle="Theme" onPress={() => router.push('/settings/appearance')} />
        </Section>

        <Section title="About">
          <ListRow
            icon="document-text-outline"
            title="Terms of Service"
            onPress={() => router.push({ pathname: '/web', params: { path: '/terms', title: 'Terms of Service' } })}
          />
          <ListRow
            icon="shield-checkmark-outline"
            title="Privacy Policy"
            onPress={() => router.push({ pathname: '/web', params: { path: '/privacy', title: 'Privacy Policy' } })}
          />
          <ListRow icon="information-circle-outline" title="App version" detail={version} chevron={false} />
          <ListRow icon="server-outline" title="API server" subtitle={API_ORIGIN} chevron={false} />
        </Section>

        <View style={{ paddingHorizontal: spacing.xs }}>
          <Button title="Sign out" variant="secondary" onPress={() => void onSignOut()} loading={signingOut} />
        </View>
      </ScrollView>
    </Screen>
  );
}
