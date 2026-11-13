import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Switch } from '../../components/Switch';
import { useRouter } from 'expo-router';

import { Button } from '../../components/Button';
import { ErrorState } from '../../components/ErrorState';
import { ErrorText } from '../../components/ErrorText';
import { ListRow } from '../../components/ListRow';
import { LoadingState } from '../../components/LoadingState';
import { Section } from '../../components/Section';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { confirm } from '../../components/confirm';
import { useOrgs } from '../account/queries';
import { success, warning } from '../../lib/haptics';
import { spacing, typography, useTheme } from '../../theme';
import { CURATOR_ROLES } from '../account/types';
import { messageOf, valuesFromSolution } from './form';
import { SolutionForm } from './SolutionForm';
import { SolutionText } from './presentation';
import { DraftDetail, QueueDetail } from './SolutionWorkflow';
import { useRetractSolution, useReviewSolution, useSetSolutionShared, useSolution, useUpdateSolution } from './queries';
import type { OrgScope, ReviewKind, Solution } from './types';

/** Historic review kinds, in the words the history shows. */
const REVIEW_WORDS: Record<string, string> = {
  confirmed: 'confirmed',
  failed: 'failed',
  doubt: 'flagged as doubtful',
  cleared: 'cleared the doubt',
  verified: 'marked still true',
  contradicted: 'contradicted',
  edited: 'edited',
};

/**
 * One solution, opened from a list. It picks its view from the status: a draft
 * (its author decides), a row waiting for review (a curator decides), or a library
 * entry (read it, say whether it worked, edit it, share it, remove it).
 */
export function SolutionScreen({ id, org }: { id: number; org: OrgScope }) {
  const orgs = useOrgs();
  const solution = useSolution(org, id);
  const orgRow = orgs.data?.orgs.find((o) => o.id === org);
  const canCurate = !!orgRow && (CURATOR_ROLES as readonly string[]).includes(orgRow.role);

  if (solution.isPending) return <LoadingState text="Loading solution" />;
  if (solution.isError || !solution.data) {
    return (
      <ErrorState
        message={messageOf(solution.error, 'This solution is not available.')}
        onRetry={() => void solution.refetch()}
      />
    );
  }
  const s = solution.data;

  if (s.status === 'draft') return <DraftDetail s={s} org={org} orgName={orgRow?.name} />;
  if (s.status === 'pending_review') return <QueueDetail s={s} org={org} canCurate={canCurate} />;
  return <LibraryDetail s={s} org={org} orgName={orgRow?.name} />;
}

/** A library entry: read it, say whether it worked, flag a doubt, edit it, share it, remove it. */
function LibraryDetail({ s, org, orgName }: { s: Solution; org: OrgScope; orgName?: string }) {
  const router = useRouter();
  const { colors } = useTheme();
  const review = useReviewSolution();
  const share = useSetSolutionShared();
  const save = useUpdateSolution();
  const retract = useRetractSolution();
  const [reason, setReason] = useState('');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const doReview = (kind: ReviewKind) => {
    setError(null);
    review.mutate(
      { org, id: s.id, kind, reason },
      {
        onSuccess: () => {
          success();
          setReason('');
          setNotice('Recorded.');
        },
        onError: (e) => setError(messageOf(e, 'Could not record that.')),
      },
    );
  };

  const toggleShared = (shared: boolean) => {
    setError(null);
    share.mutate(
      { org, id: s.id, shared },
      { onError: (e) => setError(messageOf(e, 'Could not change sharing.')) },
    );
  };

  const removeIt = () => {
    void confirm({
      title: 'Remove this solution?',
      message: 'It leaves the library. The row is kept as removed.',
      destructiveLabel: 'Remove',
    }).then((ok) => {
      if (!ok) return;
      setError(null);
      retract.mutate(
        { org, id: s.id },
        {
          onSuccess: () => {
            warning();
            router.back();
          },
          onError: (e) => setError(messageOf(e, 'Could not remove it.')),
        },
      );
    });
  };

  if (editing) {
    return (
      <ScrollView contentContainerStyle={styles.stack} keyboardShouldPersistTaps="handled">
        <Text style={[typography.heading, { color: colors.text }]}>Edit solution</Text>
        <SolutionForm
          initial={valuesFromSolution(s)}
          verifiable
          submitLabel="Save changes"
          busy={save.isPending}
          serverError={error}
          onCancel={() => setEditing(false)}
          onSubmit={(draft, options) =>
            save.mutate(
              { org, id: s.id, fields: draft, verified: options.verified },
              {
                onSuccess: () => {
                  success();
                  setEditing(false);
                  setError(null);
                },
                onError: (e) => setError(messageOf(e, 'Could not save those changes.')),
              },
            )
          }
        />
      </ScrollView>
    );
  }

  const reviews = s.reviews ?? [];
  const busy = review.isPending || share.isPending || retract.isPending;

  return (
    <ScrollView contentContainerStyle={styles.stack}>
      <SolutionText s={s} />

      <Section title="Did it work?">
        <View style={styles.buttons}>
          <View style={styles.button}>
            <Button title="It worked for me" variant="secondary" disabled={busy} onPress={() => doReview('confirmed')} />
          </View>
          <View style={styles.button}>
            <Button title="It did not work" variant="secondary" disabled={busy} onPress={() => doReview('failed')} />
          </View>
        </View>
        <View style={styles.reasonBlock}>
          <TextField
            label="Why? (needed to flag or clear a doubt)"
            value={reason}
            onChangeText={setReason}
            placeholder="Say why"
            placeholderTextColor={colors.mutedText}
          />
          <View style={styles.buttons}>
            {s.doubtful ? (
              <View style={styles.button}>
                <Button title="Clear doubt" variant="secondary" disabled={!reason.trim() || busy} onPress={() => doReview('cleared')} />
              </View>
            ) : (
              <View style={styles.button}>
                <Button title="Flag as doubtful" variant="secondary" disabled={!reason.trim() || busy} onPress={() => doReview('doubt')} />
              </View>
            )}
          </View>
        </View>
      </Section>

      {s.can_manage ? (
        <Section>
          <View style={styles.buttons}>
            <View style={styles.button}>
              <Button title="Edit" variant="secondary" disabled={busy} onPress={() => setEditing(true)} />
            </View>
          </View>
          {org != null ? (
            <ListRow
              title="Shared with the organisation"
              subtitle={orgName}
              chevron={false}
              detail={
                <Switch
                  accessibilityLabel="Shared with the organisation"
                  value={s.shared_with_org}
                  disabled={busy}
                  onValueChange={toggleShared}
                />
              }
            />
          ) : null}
          <ListRow icon="trash-outline" title="Remove" destructive chevron={false} disabled={busy} onPress={removeIt} />
        </Section>
      ) : null}

      <ErrorText message={error} />
      {notice ? <Text style={[typography.caption, { color: colors.success }]}>{notice}</Text> : null}

      {reviews.length > 0 ? (
        <Section title="History">
          {reviews.map((r, i) => (
            <ListRow
              key={i}
              title={`${REVIEW_WORDS[r.kind] ?? r.kind} by ${r.by}${r.model ? ` (${r.model})` : ''}`}
              subtitle={`${new Date(r.at).toLocaleDateString()}${r.reason ? ` — ${r.reason}` : ''}`}
              chevron={false}
            />
          ))}
        </Section>
      ) : null}
    </ScrollView>
  );
}


const styles = StyleSheet.create({
  stack: { gap: spacing.lg, paddingBottom: spacing.xl },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  button: { flexGrow: 1, flexBasis: '45%' },
  reasonBlock: { gap: spacing.sm, paddingTop: spacing.sm },
});
