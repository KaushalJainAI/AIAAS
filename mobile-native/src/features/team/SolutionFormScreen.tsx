import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

import { ErrorState } from '../../components/ErrorState';
import { LoadingState } from '../../components/LoadingState';
import { Text } from '../../components/Text';
import { useOrgs } from '../account/queries';
import { success } from '../../lib/haptics';
import { spacing, typography, useTheme } from '../../theme';
import { emptyValues, messageOf, valuesFromSolution } from './form';
import { SolutionForm } from './SolutionForm';
import { useCreateSolution, useSolution, useUpdateSolution } from './queries';
import type { OrgScope, Solution } from './types';

/**
 * Write a solution by hand (`id` absent), or edit one. A saved library entry
 * offers "I checked this is still true"; a draft or a queued row does not.
 */
export function SolutionFormScreen({ org, id, problem }: { org: OrgScope; id: number | null; problem?: string }) {
  if (id == null) return <NewSolution org={org} problem={problem} />;
  return <EditSolution org={org} id={id} />;
}

function NewSolution({ org, problem }: { org: OrgScope; problem?: string }) {
  const { colors } = useTheme();
  const router = useRouter();
  const orgs = useOrgs();
  const orgName = orgs.data?.orgs.find((o) => o.id === org)?.name;
  const create = useCreateSolution();
  const [error, setError] = useState<string | null>(null);

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <Text style={[typography.heading, { color: colors.text }]}>New solution</Text>
      <SolutionForm
        initial={emptyValues(problem ?? '')}
        shareOption={org != null}
        orgName={orgName}
        submitLabel="Save solution"
        busy={create.isPending}
        serverError={error}
        onCancel={() => router.back()}
        onSubmit={(draft, options) =>
          create.mutate(
            { org, fields: draft, share: options.share },
            {
              onSuccess: () => {
                success();
                router.back();
              },
              onError: (e) => setError(messageOf(e, 'Could not save the solution.')),
            },
          )
        }
      />
    </ScrollView>
  );
}

function EditSolution({ org, id }: { org: OrgScope; id: number }) {
  const solution = useSolution(org, id);
  if (solution.isPending) return <LoadingState text="Loading solution" />;
  if (solution.isError || !solution.data) {
    return (
      <ErrorState
        message={messageOf(solution.error, 'This solution is not available.')}
        onRetry={() => void solution.refetch()}
      />
    );
  }
  return <EditForm org={org} s={solution.data} />;
}

function EditForm({ org, s }: { org: OrgScope; s: Solution }) {
  const { colors } = useTheme();
  const router = useRouter();
  const save = useUpdateSolution();
  const [error, setError] = useState<string | null>(null);
  // A saved library entry can be ticked "still true"; a draft or a queued row cannot.
  const libraryEntry = s.status !== 'draft' && s.status !== 'pending_review';

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <Text style={[typography.heading, { color: colors.text }]}>Edit solution</Text>
      <SolutionForm
        initial={valuesFromSolution(s)}
        verifiable={libraryEntry}
        submitLabel="Save changes"
        busy={save.isPending}
        serverError={error}
        onCancel={() => router.back()}
        onSubmit={(draft, options) =>
          save.mutate(
            { org, id: s.id, fields: draft, verified: libraryEntry && options.verified },
            {
              onSuccess: () => {
                success();
                router.back();
              },
              onError: (e) => setError(messageOf(e, 'Could not save those changes.')),
            },
          )
        }
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { gap: spacing.lg, paddingBottom: spacing.xl },
});
