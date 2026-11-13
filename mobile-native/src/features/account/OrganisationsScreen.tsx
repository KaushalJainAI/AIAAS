import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { router, Stack } from 'expo-router';

import { Button } from '../../components/Button';
import { ErrorState } from '../../components/ErrorState';
import { ErrorText } from '../../components/ErrorText';
import { ListRow } from '../../components/ListRow';
import { LoadingState } from '../../components/LoadingState';
import { Screen } from '../../components/Screen';
import { Section } from '../../components/Section';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { useRefresh } from '../../hooks/useRefresh';
import { success } from '../../lib/haptics';
import { spacing, typography, useTheme } from '../../theme';
import { errorMessage } from '../settings/errors';
import { Notice } from '../settings/Notice';
import { PickerSheet } from '../settings/Picker';
import { PickerRow } from '../settings/PickerRow';
import { ROLE_LABEL } from './format';
import { useCreateOrg, useMyInvites, useOrgs, useRespondToInvite, useSetActiveOrg } from './queries';
import type { MyInvite } from './types';

/**
 * Organisations you belong to, the invitations waiting for you, and which
 * organisation new chats start in. A chat keeps its organisation for good.
 */
export function OrganisationsScreen() {
  const { colors } = useTheme();
  const orgs = useOrgs();
  const invites = useMyInvites();
  const createOrg = useCreateOrg();
  const setActive = useSetActiveOrg();
  const respond = useRespondToInvite();

  const [name, setName] = useState('');
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'success' | 'danger' } | null>(null);
  const { refreshing, onRefresh } = useRefresh(() => Promise.all([orgs.refetch(), invites.refetch()]));

  if (orgs.isPending) return <LoadingState text="Loading organisations" />;
  if (orgs.isError) {
    return <ErrorState message="Could not load your organisations. Check your connection and try again." onRetry={() => void orgs.refetch()} />;
  }

  const list = orgs.data?.orgs ?? [];
  const active = orgs.data?.active_org_id ?? null;
  const pending: MyInvite[] = invites.data?.invites ?? [];

  function answer(invite: MyInvite, accept: boolean) {
    setNotice(null);
    respond.mutate(
      { inviteId: invite.id, accept },
      {
        onSuccess: () => {
          success();
          setNotice({ text: accept ? `You joined ${invite.org_name}.` : 'Invitation declined.', tone: 'success' });
        },
        onError: (err) => setNotice({ text: errorMessage(err, 'Could not answer the invitation.'), tone: 'danger' }),
      },
    );
  }

  function makeOrg() {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) return;
    createOrg.mutate(trimmed, {
      onSuccess: () => {
        success();
        setName('');
        setNotice({ text: 'Organisation created.', tone: 'success' });
      },
      onError: (err) => setError(errorMessage(err, 'Could not create it.')),
    });
  }

  const activeName = list.find((o) => o.id === active)?.name ?? 'Just me (no organisation)';

  return (
    <Screen edges={['left', 'right']}>
      <Stack.Screen options={{ title: 'Organisations' }} />
      <ScrollView
        contentContainerStyle={{ gap: spacing.xl, paddingBottom: spacing.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <View style={{ gap: spacing.xs }}>
          <Text style={typography.body} accessibilityRole="header">Organisation</Text>
          <Text style={[typography.caption, { color: colors.mutedText }]}>
            People in the same organisation can find the problems each other has solved. New chats start in your active organisation. Nothing from one organisation is ever shown in another.
          </Text>
        </View>

        <Notice message={notice?.text} tone={notice?.tone} />

        {pending.length > 0 ? (
          <Section title="Invitations">
            {pending.map((invite) => (
              <View key={invite.id} style={{ padding: spacing.lg, gap: spacing.sm }}>
                <Text style={typography.body}>
                  {invite.invited_by_name ?? 'Someone'} invited you to {invite.org_name} as {ROLE_LABEL[invite.role].toLowerCase()}.
                </Text>
                {!invite.can_accept ? (
                  <Text style={[typography.caption, { color: colors.mutedText }]}>
                    Verify your email address to accept. Forgot password, or signing in with Google, proves it.
                  </Text>
                ) : null}
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Button title="Accept" disabled={respond.isPending || !invite.can_accept} onPress={() => answer(invite, true)} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button title="Decline" variant="secondary" disabled={respond.isPending} onPress={() => answer(invite, false)} />
                  </View>
                </View>
              </View>
            ))}
          </Section>
        ) : null}

        <Section title="New chats start in">
          <PickerRow label="Active organisation" value={activeName} placeholder="Just me (no organisation)" onPress={() => setPicking(true)} />
        </Section>

        <Section title="Your organisations">
          {list.length === 0 ? <ListRow title="You are not in an organisation yet." chevron={false} /> : null}
          {list.map((org) => (
            <ListRow
              key={org.id}
              title={org.name}
              subtitle={`${ROLE_LABEL[org.role]}${org.id === active ? ' · active' : ''}`}
              onPress={() => router.push({ pathname: '/settings/organisation', params: { id: String(org.id) } })}
            />
          ))}
        </Section>

        <Section title="Create an organisation">
          <View style={{ padding: spacing.lg, gap: spacing.md }}>
            <TextField label="Name" value={name} onChangeText={setName} placeholder="New organisation name" maxLength={120} />
            <ErrorText message={error} />
            <Button title="Create" loading={createOrg.isPending} disabled={!name.trim() || createOrg.isPending} onPress={makeOrg} />
          </View>
        </Section>
      </ScrollView>

      <PickerSheet
        visible={picking}
        title="New chats start in"
        options={[
          { value: '', label: 'Just me (no organisation)' },
          ...list.map((o) => ({ value: String(o.id), label: o.name, detail: ROLE_LABEL[o.role] })),
        ]}
        value={active === null ? '' : String(active)}
        onPick={(value) => setActive.mutate(value ? Number(value) : null)}
        onClose={() => setPicking(false)}
      />
    </Screen>
  );
}
