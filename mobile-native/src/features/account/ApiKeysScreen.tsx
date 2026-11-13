import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Clipboard from 'expo-clipboard';

import { Button } from '../../components/Button';
import { confirm } from '../../components/confirm';
import { ErrorState } from '../../components/ErrorState';
import { ErrorText } from '../../components/ErrorText';
import { ListRow } from '../../components/ListRow';
import { LoadingState } from '../../components/LoadingState';
import { Screen } from '../../components/Screen';
import { Section } from '../../components/Section';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { useRefresh } from '../../hooks/useRefresh';
import { success, tap, warning } from '../../lib/haptics';
import { fontFamily, fontSize, radius, spacing, typography, useTheme } from '../../theme';
import { errorMessage } from '../settings/errors';
import { Notice } from '../settings/Notice';
import { formatDay } from './format';
import { useApiKeys, useCreateApiKey, useDeleteApiKey, useRotateApiKey } from './queries';
import type { ApiKey } from './types';

/**
 * API keys for scripts and integrations. A key's full value is shown once,
 * when it is made or regenerated, with a copy button; afterwards only its
 * prefix is kept.
 */
export function ApiKeysScreen() {
  const { colors } = useTheme();
  const keys = useApiKeys();
  const create = useCreateApiKey();
  const rotate = useRotateApiKey();
  const remove = useDeleteApiKey();

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [acting, setActing] = useState<ApiKey | null>(null);
  const [revealed, setRevealed] = useState<{ title: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { refreshing, onRefresh } = useRefresh(keys.refetch);

  if (keys.isPending) return <LoadingState text="Loading API keys" />;
  if (keys.isError) {
    return <ErrorState message="Could not load your API keys. Check your connection and try again." onRetry={() => void keys.refetch()} />;
  }
  const rows = keys.data ?? [];

  function makeKey() {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give the key a name, such as "Laptop script".');
      return;
    }
    create.mutate(trimmed, {
      onSuccess: (made) => {
        success();
        setCreating(false);
        setName('');
        setCopied(false);
        setRevealed({ title: 'Your new API key', key: made.api_key });
      },
      onError: (err) => setError(errorMessage(err, 'Could not create the key.')),
    });
  }

  async function regenerate(key: ApiKey) {
    setActing(null);
    const ok = await confirm({
      title: 'Regenerate API key?',
      message: 'This invalidates your old key immediately. Update anywhere it is used.',
      destructiveLabel: 'Regenerate',
    });
    if (!ok) return;
    rotate.mutate(key.id, {
      onSuccess: (done) => {
        warning();
        setCopied(false);
        setRevealed({ title: 'Your new API key', key: done.new_key });
      },
      onError: (err) => setNotice(errorMessage(err, 'Could not regenerate the key.')),
    });
  }

  async function deleteKey(key: ApiKey) {
    setActing(null);
    const ok = await confirm({
      title: `Delete "${key.name}"?`,
      message: 'Anything using this key stops working at once.',
      destructiveLabel: 'Delete',
    });
    if (!ok) return;
    remove.mutate(key.id, {
      onSuccess: () => {
        warning();
        setNotice(`"${key.name}" deleted.`);
      },
      onError: (err) => setNotice(errorMessage(err, 'Could not delete this key.')),
    });
  }

  async function copyKey(key: string) {
    await Clipboard.setStringAsync(key);
    tap();
    setCopied(true);
  }

  return (
    <Screen edges={['left', 'right']}>
      <Stack.Screen options={{ title: 'API keys' }} />
      <ScrollView
        contentContainerStyle={{ gap: spacing.xl, paddingBottom: spacing.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Notice message={notice} tone="info" />

        <Section
          title="Your keys"
          footer="Keep these secret. A key allows full access to your account. The full key is shown only once, when it is made or regenerated. Copy it then."
        >
          {rows.length === 0 ? (
            <ListRow title="No API keys yet." chevron={false} />
          ) : null}
          {rows.map((key) => (
            <ListRow
              key={key.id}
              title={key.name}
              subtitle={`${key.key_prefix}…  ·  Created ${formatDay(key.created_at)}${key.last_used_at ? `  ·  Last used ${formatDay(key.last_used_at)}` : ''}`}
              onPress={() => setActing(key)}
            />
          ))}
        </Section>

        {creating ? (
          <Section title="New key">
            <View style={{ padding: spacing.lg, gap: spacing.md }}>
              <TextField label="Name" value={name} onChangeText={setName} placeholder="Laptop script" maxLength={80} autoFocus />
              <ErrorText message={error} />
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Button title="Cancel" variant="secondary" disabled={create.isPending} onPress={() => { setCreating(false); setError(null); }} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title="Create key" loading={create.isPending} disabled={create.isPending} onPress={makeKey} />
                </View>
              </View>
            </View>
          </Section>
        ) : (
          <Button title="Create API key" onPress={() => setCreating(true)} />
        )}
      </ScrollView>

      <Sheet visible={acting !== null} title={acting?.name} onClose={() => setActing(null)}>
        {acting ? (
          <View style={{ paddingBottom: spacing.md }}>
            <Section>
              <ListRow icon="refresh-outline" title="Regenerate" chevron={false} onPress={() => void regenerate(acting)} />
              <ListRow icon="trash-outline" title="Delete" destructive chevron={false} onPress={() => void deleteKey(acting)} />
            </Section>
          </View>
        ) : null}
      </Sheet>

      <Sheet visible={revealed !== null} title={revealed?.title} onClose={() => setRevealed(null)}>
        {revealed ? (
          <View style={{ gap: spacing.md, paddingBottom: spacing.md }}>
            <Text style={[typography.caption, { color: colors.mutedText }]}>
              This is the only time the full key is shown. Store it somewhere safe.
            </Text>
            <View style={{ borderRadius: radius.md, backgroundColor: colors.surfaceMuted, padding: spacing.md }}>
              <Text selectable style={{ color: colors.text, fontSize: fontSize.md, fontFamily: fontFamily.mono }}>
                {revealed.key}
              </Text>
            </View>
            <Button title={copied ? 'Copied' : 'Copy key'} variant="secondary" onPress={() => void copyKey(revealed.key)} />
            <Button title="Done" onPress={() => setRevealed(null)} />
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}
