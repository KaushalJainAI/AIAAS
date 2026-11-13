import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';

import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Icon } from '../../components/Icon';
import { ListRow } from '../../components/ListRow';
import { LoadingState } from '../../components/LoadingState';
import { Screen } from '../../components/Screen';
import { SearchBar } from '../../components/SearchBar';
import { Section } from '../../components/Section';
import { Text } from '../../components/Text';
import { spacing, typography, useTheme } from '../../theme';
import { CredentialForm } from './CredentialForm';
import { credentialIcon } from './icons';
import { useCredentials, useCredentialTypes } from './queries';
import type { CredentialType } from './types';

interface Props {
  /** Set to edit this saved credential. */
  id: number | null;
  /** A type slug to start from, e.g. from a connection that needs it. */
  typeSlug: string | null;
}

/**
 * Add or edit a credential. Adding starts with the type picker unless a type is
 * already known; editing opens the saved credential in the same form.
 */
export function CredentialFormScreen({ id, typeSlug }: Props) {
  const { colors } = useTheme();
  const creds = useCredentials();
  const types = useCredentialTypes();
  const [chosen, setChosen] = useState<CredentialType | null>(null);
  const [search, setSearch] = useState('');

  const typeList = useMemo(() => types.data ?? [], [types.data]);

  if (creds.isPending || types.isPending) return <LoadingState text="Loading" />;
  if (creds.isError || types.isError) {
    return (
      <ErrorState
        message="Could not load credential types. Check your connection and try again."
        onRetry={() => {
          void creds.refetch();
          void types.refetch();
        }}
      />
    );
  }

  if (id !== null) {
    const credential = (creds.data ?? []).find((c) => c.id === id);
    const type = credential ? typeList.find((t) => t.id === credential.credential_type) : undefined;
    if (!credential || !type) {
      return <ErrorState title="Not available" message="This credential is no longer saved." />;
    }
    return (
      <>
        <Stack.Screen options={{ title: 'Edit Credential' }} />
        <CredentialForm type={type} credential={credential} />
      </>
    );
  }

  const fromSlug = typeSlug ? typeList.find((t) => t.slug === typeSlug) ?? null : null;
  const selected = chosen ?? fromSlug;

  if (selected) {
    return (
      <>
        <Stack.Screen options={{ title: 'New Credential' }} />
        <CredentialForm type={selected} />
      </>
    );
  }

  // Type picker: the web's "Select credential type", with the same search.
  const needle = search.trim().toLowerCase();
  const shown = typeList.filter(
    (t) => t.name.toLowerCase().includes(needle) || (t.description ?? '').toLowerCase().includes(needle),
  );

  return (
    <Screen edges={['left', 'right']}>
      <Stack.Screen options={{ title: 'New Credential' }} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.xxl }}>
        <Text style={[typography.label, { color: colors.text }]}>Select credential type</Text>
        <SearchBar value={search} onChangeText={setSearch} placeholder="Search for a service or node..." />
        <Section>
          {shown.map((type) => (
            <ListRow
              key={type.id}
              icon={credentialIcon(type.icon)}
              title={type.name}
              subtitle={type.description || undefined}
              onPress={() => setChosen(type)}
            />
          ))}
        </Section>
        {shown.length === 0 ? (
          <EmptyState title="No matching services found." />
        ) : null}
        {typeList.length === 0 ? (
          <View style={{ alignItems: 'center', gap: spacing.sm }}>
            <Icon name="key-outline" size={32} color={colors.mutedText} />
            <Text style={[typography.caption, { color: colors.mutedText }]}>No credential types are set up on this server yet.</Text>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
