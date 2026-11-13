import { useState } from 'react';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '../../components/Button';
import { ErrorText } from '../../components/ErrorText';
import { Section } from '../../components/Section';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { confirm } from '../../components/confirm';
import { success, warning } from '../../lib/haptics';
import { spacing, typography, useTheme } from '../../theme';
import { messageOf, valuesFromSolution } from './form';
import { SolutionForm } from './SolutionForm';
import { Badges, SolutionText } from './presentation';
import { useApproveSolution, usePublishSolution, useDiscardSolution, useSendBackSolution, useUpdateSolution } from './queries';
import type { OrgScope, Solution } from './types';

/**
 * The two views a solution has before it is in the library: a draft its author
 * decides about, and a row waiting for a curator. The rules are the server's
 * (`solutions/api.py`); these views only offer the choices that apply.
 */
export function DraftDetail({ s, org, orgName }: { s: Solution; org: OrgScope; orgName?: string | null }) {
  const router = useRouter();
  const { colors } = useTheme();
  const save = useUpdateSolution();
  const publish = usePublishSolution();
  const discard = useDiscardSolution();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busy = save.isPending || publish.isPending || discard.isPending;

  const choose = (share: boolean) => {
    setError(null);
    publish.mutate(
      { org, id: s.id, share },
      {
        onSuccess: (saved) => {
          success();
          const message = !share
            ? 'Kept private.'
            : (saved as Solution | undefined)?.status === 'pending_review'
              ? 'Sent to the curators for review.'
              : `Shared with ${orgName ?? 'your team'}.`;
          setNotice(message);
          router.back();
        },
        onError: (e) => setError(messageOf(e, 'Could not save that choice.')),
      },
    );
  };

  const drop = () => {
    void confirm({
      title: 'Discard this draft?',
      message: 'It is removed from your drafts.',
      destructiveLabel: 'Yes, discard it',
    }).then((ok) => {
      if (!ok) return;
      setError(null);
      discard.mutate(
        { org, id: s.id },
        {
          onSuccess: () => {
            warning();
            router.back();
          },
          onError: (e) => setError(messageOf(e, 'Could not discard it.')),
        },
      );
    });
  };

  return (
    <ScrollView contentContainerStyle={styles.stack} keyboardShouldPersistTaps="handled">
      <View style={styles.stack}>
        <Badges s={s} />
        <Text style={[typography.heading, { color: colors.text }]}>Review this draft</Text>
        <Text style={[typography.caption, { color: colors.mutedText }]}>
          {s.share_requested ? 'Sharing was on in the chat where this was found.' : 'Sharing was off in the chat where this was found.'}{' '}
          Only you can see a draft until you choose.
        </Text>
      </View>

      <SolutionForm
        initial={valuesFromSolution(s)}
        submitLabel="Save changes"
        busy={save.isPending}
        serverError={null}
        onSubmit={(draft) =>
          save.mutate(
            { org, id: s.id, fields: draft, verified: false },
            {
              onSuccess: () => {
                success();
                setNotice('Draft saved.');
              },
              onError: (e) => setError(messageOf(e, 'Could not save those changes.')),
            },
          )
        }
      />

      <Section title="Keep it?" footer="Sharing makes it visible to your team. In an organisation where a curator approves each share, it waits for one first. Keeping it private leaves it in your own library.">
        <View style={styles.buttons}>
          {orgName ? (
            <View style={styles.button}>
              <Button title={`Share with ${orgName}`} disabled={busy} loading={publish.isPending && publish.variables?.share === true} onPress={() => choose(true)} />
            </View>
          ) : null}
          <View style={styles.button}>
            <Button title="Keep private" variant="secondary" disabled={busy} loading={publish.isPending && publish.variables?.share === false} onPress={() => choose(false)} />
          </View>
          <View style={styles.button}>
            <Button title="Discard" variant="secondary" disabled={busy} onPress={drop} />
          </View>
        </View>
      </Section>

      <ErrorText message={error} />
      {notice ? <Text style={[typography.caption, { color: colors.success }]}>{notice}</Text> : null}
    </ScrollView>
  );
}

export function QueueDetail({ s, org, canCurate }: { s: Solution; org: OrgScope; canCurate: boolean }) {
  const router = useRouter();
  const { colors } = useTheme();
  const save = useUpdateSolution();
  const approve = useApproveSolution();
  const sendBack = useSendBackSolution();
  const [editing, setEditing] = useState(false);
  const [sendingBack, setSendingBack] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const busy = approve.isPending || sendBack.isPending;

  if (editing) {
    return (
      <ScrollView contentContainerStyle={styles.stack} keyboardShouldPersistTaps="handled">
        <Text style={[typography.heading, { color: colors.text }]}>Edit before deciding</Text>
        <SolutionForm
          initial={valuesFromSolution(s)}
          submitLabel="Save changes"
          busy={save.isPending}
          serverError={error}
          onCancel={() => setEditing(false)}
          onSubmit={(draft) =>
            save.mutate(
              { org, id: s.id, fields: draft, verified: false },
              {
                onSuccess: () => {
                  success();
                  setEditing(false);
                },
                onError: (e) => setError(messageOf(e, 'Could not save those changes.')),
              },
            )
          }
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.stack}>
      <View style={[styles.callout, { backgroundColor: colors.warningBg, borderColor: colors.warning }]}>
        <Text style={[typography.body, { color: colors.text }]}>
          {canCurate
            ? 'Waiting for a curator. Approve it for the team, or send it back to its author with a reason.'
            : 'Waiting for a curator. Until one approves it, only you and the curators can see it.'}
        </Text>
      </View>

      <SolutionText s={s} />

      {canCurate ? (
        <Section>
          <View style={styles.buttons}>
            <View style={styles.button}>
              <Button
                title="Approve for the team"
                loading={approve.isPending}
                disabled={sendBack.isPending}
                onPress={() =>
                  approve.mutate(
                    { org, id: s.id },
                    {
                      onSuccess: () => {
                        success();
                        router.back();
                      },
                      onError: (e) => setError(messageOf(e, 'Could not approve it.')),
                    },
                  )
                }
              />
            </View>
            <View style={styles.button}>
              <Button title="Send back" variant="secondary" disabled={approve.isPending} onPress={() => setSendingBack((v) => !v)} />
            </View>
            <View style={styles.button}>
              <Button title="Edit" variant="secondary" disabled={busy} onPress={() => setEditing(true)} />
            </View>
          </View>

          {sendingBack ? (
            <View style={styles.stack}>
              <TextField
                label="Why is it being sent back? *"
                value={reason}
                onChangeText={(v) => setReason(v.slice(0, 500))}
                multiline
                style={styles.reason}
              />
              <Text style={[typography.caption, { color: colors.mutedText }]}>
                The author gets this reason. It goes back to being their private fix until they share it again.
              </Text>
              <Button
                title="Send back to the author"
                variant="secondary"
                disabled={!reason.trim()}
                loading={sendBack.isPending}
                onPress={() =>
                  sendBack.mutate(
                    { org, id: s.id, reason: reason.trim() },
                    {
                      onSuccess: () => {
                        warning();
                        router.back();
                      },
                      onError: (e) => setError(messageOf(e, 'Could not send it back.')),
                    },
                  )
                }
              />
            </View>
          ) : null}
        </Section>
      ) : s.can_manage ? (
        <Button title="Edit" variant="secondary" onPress={() => setEditing(true)} />
      ) : null}

      <ErrorText message={error} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.lg, paddingBottom: spacing.xl },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  button: { flexGrow: 1, flexBasis: '45%' },
  callout: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 6, padding: spacing.md },
  reason: { minHeight: 88, textAlignVertical: 'top' },
});
