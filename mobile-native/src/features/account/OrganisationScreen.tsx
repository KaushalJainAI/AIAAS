import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, Stack } from 'expo-router';

import { Button } from '../../components/Button';
import { confirm } from '../../components/confirm';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { ErrorText } from '../../components/ErrorText';
import { ListRow } from '../../components/ListRow';
import { LoadingState } from '../../components/LoadingState';
import { Screen } from '../../components/Screen';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Section } from '../../components/Section';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { success, warning } from '../../lib/haptics';
import { spacing, typography, useTheme } from '../../theme';
import { errorMessage } from '../settings/errors';
import { Notice, type NoticeTone } from '../settings/Notice';
import { PickerSheet, type PickerOption } from '../settings/Picker';
import { PickerRow } from '../settings/PickerRow';
import { ThemedSwitch } from '../settings/ThemedSwitch';
import { CURATOR_HELP, ROLE_LABEL } from './format';
import {
  useAccountProfile,
  useDeleteOrg,
  useInviteOrgMember,
  useOrgInvites,
  useOrgMembers,
  useOrgs,
  useRemoveOrgMember,
  useRevokeOrgInvite,
  useSetOrgMemberRole,
  useUpdateOrg,
} from './queries';
import { MANAGER_ROLES, type CaptureMode, type OrgMember, type OrgRole, type ReviewPolicy } from './types';

/** The web's two organisation-wide choices, with the web's words. */
const CAPTURE_OPTIONS: PickerOption<CaptureMode>[] = [
  { value: 'suggest', label: 'Suggest it to the author (recommended)', detail: 'It is kept as a draft that only its author can see, and they choose whether to share it.' },
  { value: 'auto', label: 'Save automatically', detail: 'It is saved at once. It is shared only if its author asked for that in the chat.' },
];
const REVIEW_OPTIONS: PickerOption<ReviewPolicy>[] = [
  { value: 'open', label: 'Anyone, at once', detail: 'A shared solution reaches the team straight away.' },
  { value: 'curated', label: 'A curator approves each one', detail: 'A shared solution waits in the review queue until a curator approves it.' },
];
const INVITE_ROLES = [
  { key: 'member' as const, label: 'Member', count: 0 },
  { key: 'curator' as const, label: 'Curator', count: 0 },
  { key: 'admin' as const, label: 'Admin', count: 0 },
];
const MEMBER_ROLES: PickerOption<Exclude<OrgRole, 'owner'>>[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'curator', label: 'Curator', detail: CURATOR_HELP },
  { value: 'member', label: 'Member' },
];

type InviteRole = (typeof INVITE_ROLES)[number]['key'];

/**
 * One organisation: its sharing settings, its people, and the invitations
 * still open. Managers change settings and people; an owner can also delete it;
 * everyone else can leave. The same rules as the web's Organisation tab.
 */
export function OrganisationScreen({ id }: { id: number }) {
  const { colors } = useTheme();
  const orgs = useOrgs();
  const me = useAccountProfile();
  const org = (orgs.data?.orgs ?? []).find((o) => o.id === id);
  const manager = org ? MANAGER_ROLES.includes(org.role) : false;
  const members = useOrgMembers(id, org !== undefined);
  const invites = useOrgInvites(id, manager);
  const updateOrg = useUpdateOrg();
  const deleteOrg = useDeleteOrg();
  const invite = useInviteOrgMember(id);
  const revoke = useRevokeOrgInvite(id);
  const setRole = useSetOrgMemberRole(id);
  const removeMember = useRemoveOrgMember(id);

  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<InviteRole>('member');
  const [memberSheet, setMemberSheet] = useState<OrgMember | null>(null);
  const [roleFor, setRoleFor] = useState<OrgMember | null>(null);
  const [capturePick, setCapturePick] = useState(false);
  const [reviewPick, setReviewPick] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: NoticeTone } | null>(null);

  if (orgs.isPending) return <LoadingState text="Loading organisation" />;
  if (orgs.isError) {
    return <ErrorState message="Could not load this organisation. Check your connection and try again." onRetry={() => void orgs.refetch()} />;
  }
  if (!org) return <EmptyState title="Not available" message="You are no longer a member of this organisation." />;

  const myId = me.data?.id ?? null;
  const memberList = members.data ?? [];
  const pendingInvites = invites.data?.invites ?? [];

  function report(text: string) {
    setNotice({ text, tone: 'success' });
    setError(null);
  }
  function fail(err: unknown, fallback: string) {
    setNotice(null);
    setError(errorMessage(err, fallback));
  }

  function sendInvite() {
    setError(null);
    const address = email.trim();
    if (!address) return;
    invite.mutate(
      { email: address, role: inviteRole },
      {
        onSuccess: () => {
          success();
          setEmail('');
          report('Invitation sent');
        },
        onError: (err) => fail(err, 'Could not send the invitation.'),
      },
    );
  }

  async function revokeInvite(inviteId: number, address: string) {
    const ok = await confirm({ title: `Withdraw the invitation to ${address}?`, destructiveLabel: 'Withdraw' });
    if (!ok) return;
    revoke.mutate(inviteId, {
      onSuccess: () => report('Invitation withdrawn.'),
      onError: (err) => fail(err, 'Could not withdraw it.'),
    });
  }

  async function removeFrom(member: OrgMember) {
    setMemberSheet(null);
    const self = member.user_id === myId;
    const ok = await confirm({
      title: self ? `Leave ${org!.name}?` : `Remove ${member.email}?`,
      message: self ? 'You will lose access to its solutions. New chats stop using it.' : undefined,
      destructiveLabel: self ? 'Leave' : 'Remove',
    });
    if (!ok) return;
    removeMember.mutate(member.user_id, {
      onSuccess: () => {
        warning();
        if (self) router.back();
        else report(`${member.email} removed.`);
      },
      onError: (err) => fail(err, self ? 'Could not leave.' : 'Could not remove them.'),
    });
  }

  async function deleteThisOrg() {
    const ok = await confirm({
      title: `Delete ${org!.name}?`,
      message: 'Its shared solutions and memberships are removed for everyone. This cannot be undone.',
      destructiveLabel: 'Delete',
    });
    if (!ok) return;
    deleteOrg.mutate(id, {
      onSuccess: () => {
        warning();
        router.back();
      },
      onError: (err) => fail(err, 'Could not delete the organisation.'),
    });
  }

  return (
    <Screen edges={['left', 'right']}>
      <Stack.Screen options={{ title: org.name }} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.xl, paddingBottom: spacing.xxl }}>
        <View style={{ gap: spacing.xs }}>
          <Text style={typography.heading} accessibilityRole="header">{org.name}</Text>
          <Text style={[typography.caption, { color: colors.mutedText }]}>Your role: {ROLE_LABEL[org.role]}</Text>
        </View>

        <Notice message={notice?.text} tone={notice?.tone} />
        <ErrorText message={error} />

        <Section title="Sharing" footer={org.role === 'member' ? 'Only an owner or admin can change these.' : undefined}>
          <ListRow
            title="Share new chats by default"
            subtitle="New chats share their solutions with the organisation"
            chevron={false}
            detail={
              <ThemedSwitch
                label="Share new chats by default"
                value={org.share_by_default}
                disabled={org.role === 'member' || updateOrg.isPending}
                onChange={(value) =>
                  updateOrg.mutate(
                    { id, patch: { share_by_default: value } },
                    { onSuccess: () => report('Saved'), onError: (err) => fail(err, 'Only an owner or admin can change this.') },
                  )
                }
              />
            }
          />
          {manager ? (
            <>
              <PickerRow
                label="When a fix is found in chat"
                value={CAPTURE_OPTIONS.find((o) => o.value === org.capture_mode)?.label ?? ''}
                placeholder="Suggest it to the author"
                onPress={() => setCapturePick(true)}
              />
              <PickerRow
                label="Who can share with the whole team"
                value={REVIEW_OPTIONS.find((o) => o.value === org.review_policy)?.label ?? ''}
                placeholder="Anyone, at once"
                onPress={() => setReviewPick(true)}
              />
            </>
          ) : null}
        </Section>

        <Section title="People" footer={`Curator: ${CURATOR_HELP}`}>
          {members.isPending ? <ListRow title="Loading people…" chevron={false} /> : null}
          {memberList.map((member) => {
            const canManage = manager && member.role !== 'owner';
            return (
              <ListRow
                key={member.user_id}
                title={member.name}
                subtitle={member.email}
                detail={member.role === 'owner' || !canManage ? ROLE_LABEL[member.role] : `${ROLE_LABEL[member.role]} ›`}
                chevron={false}
                onPress={canManage || member.user_id === myId ? () => setMemberSheet(member) : undefined}
              />
            );
          })}
        </Section>

        {manager ? (
          <>
            <Section title="Invite someone" footer="Nobody joins by being added. They accept the invitation themselves.">
              <View style={{ padding: spacing.lg, gap: spacing.md }}>
                <TextField label="Email" value={email} onChangeText={setEmail} placeholder="colleague@company.com" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
                <SegmentedControl<InviteRole> value={inviteRole} onChange={setInviteRole} items={INVITE_ROLES} />
                <Button title="Invite" loading={invite.isPending} disabled={!email.trim() || invite.isPending} onPress={sendInvite} />
              </View>
            </Section>

            {pendingInvites.length > 0 ? (
              <Section title="Pending invitations" footer={invites.data?.truncated ? 'Showing the first 200.' : undefined}>
                {pendingInvites.map((pending) => (
                  <ListRow
                    key={pending.id}
                    title={pending.email}
                    subtitle={`${ROLE_LABEL[pending.role]} · expires ${new Date(pending.expires_at).toLocaleDateString()}`}
                    chevron={false}
                    detail={<Button title="Revoke" variant="secondary" disabled={revoke.isPending} onPress={() => void revokeInvite(pending.id, pending.email)} />}
                  />
                ))}
              </Section>
            ) : null}
          </>
        ) : null}

        {org.role === 'owner' ? (
          <Section footer="Deleting removes the organisation for everyone.">
            <ListRow icon="trash-outline" title="Delete organisation" destructive chevron={false} onPress={() => void deleteThisOrg()} />
          </Section>
        ) : (
          <Section>
            <ListRow
              icon="log-out-outline"
              title={`Leave ${org.name}`}
              destructive
              chevron={false}
              onPress={() => {
                const self = memberList.find((m) => m.user_id === myId);
                if (self) void removeFrom(self);
              }}
            />
          </Section>
        )}
      </ScrollView>

      <Sheet visible={memberSheet !== null} title={memberSheet?.email} onClose={() => setMemberSheet(null)}>
        {memberSheet ? (
          <View style={{ paddingBottom: spacing.md }}>
            <Section>
              {memberSheet.user_id !== myId && manager && memberSheet.role !== 'owner' ? (
                <ListRow
                  icon="ribbon-outline"
                  title="Change role"
                  chevron={false}
                  onPress={() => {
                    const target = memberSheet;
                    setMemberSheet(null);
                    setRoleFor(target);
                  }}
                />
              ) : null}
              {memberSheet.user_id === myId || (manager && memberSheet.role !== 'owner') ? (
                <ListRow
                  icon={memberSheet.user_id === myId ? 'log-out-outline' : 'person-remove-outline'}
                  title={memberSheet.user_id === myId ? `Leave ${org.name}` : 'Remove from organisation'}
                  destructive
                  chevron={false}
                  onPress={() => void removeFrom(memberSheet)}
                />
              ) : null}
            </Section>
          </View>
        ) : null}
      </Sheet>

      <PickerSheet
        visible={roleFor !== null}
        title={`Role for ${roleFor?.email ?? ''}`}
        options={MEMBER_ROLES}
        value={roleFor && roleFor.role !== 'owner' ? roleFor.role : null}
        onPick={(role) => {
          if (!roleFor) return;
          setRole.mutate(
            { userId: roleFor.user_id, role },
            { onSuccess: () => report('Role changed'), onError: (err) => fail(err, 'Could not change their role.') },
          );
        }}
        onClose={() => setRoleFor(null)}
      />

      <PickerSheet
        visible={capturePick}
        title="When a fix is found in chat"
        options={CAPTURE_OPTIONS}
        value={org.capture_mode}
        onPick={(value) => updateOrg.mutate({ id, patch: { capture_mode: value } }, { onError: (err) => fail(err, 'Only an owner or admin can change this.') })}
        onClose={() => setCapturePick(false)}
      />
      <PickerSheet
        visible={reviewPick}
        title="Who can share with the whole team"
        options={REVIEW_OPTIONS}
        value={org.review_policy}
        onPick={(value) => updateOrg.mutate({ id, patch: { review_policy: value } }, { onError: (err) => fail(err, 'Only an owner or admin can change this.') })}
        onClose={() => setReviewPick(false)}
      />
    </Screen>
  );
}
