import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Clipboard from 'expo-clipboard';

import { Button } from '../../components/Button';
import { confirm } from '../../components/confirm';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Icon } from '../../components/Icon';
import { ListRow } from '../../components/ListRow';
import { LoadingState } from '../../components/LoadingState';
import { Screen } from '../../components/Screen';
import { Section } from '../../components/Section';
import { Text } from '../../components/Text';
import { success, tap, warning } from '../../lib/haptics';
import { errorMessage } from '../settings/errors';
import { Notice, type NoticeTone } from '../settings/Notice';
import { fontFamily, fontSize, pressedOpacity, radius, spacing, typography, useTheme } from '../../theme';
import { healthView, type HealthTone } from './health';
import { credentialIcon } from './icons';
import { useCredentialTypes, useCredentials, useDeleteCredential, useVerifyCredential } from './queries';

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

/** One credential: its fields (secrets masked until revealed), its health, and Verify / Edit / Delete. */
export function CredentialDetailScreen({ id }: { id: number }) {
  const { colors } = useTheme();
  const creds = useCredentials();
  const types = useCredentialTypes();
  const verify = useVerifyCredential();
  const remove = useDeleteCredential();
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: NoticeTone } | null>(null);

  if (creds.isPending) return <LoadingState text="Loading credential" />;
  if (creds.isError) {
    return <ErrorState message="Could not load this credential. Check your connection and try again." onRetry={() => void creds.refetch()} />;
  }
  const credential = (creds.data ?? []).find((c) => c.id === id);
  if (!credential) return <EmptyState title="Not available" message="This credential is no longer saved." />;

  const health = healthView(credential);
  const healthColor: Record<HealthTone, string> = {
    success: colors.success,
    warning: colors.warning,
    danger: colors.danger,
    muted: colors.mutedText,
  };
  const type = (types.data ?? []).find((t) => t.id === credential.credential_type);

  function toggleReveal(key: string) {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function copy(key: string, value: string) {
    await Clipboard.setStringAsync(value);
    tap();
    setCopied(key);
    setTimeout(() => setCopied((current) => (current === key ? null : current)), 2000);
  }

  function runVerify() {
    setNotice(null);
    verify.mutate(credential!.id, {
      onSuccess: (result) => {
        if (result.valid) {
          success();
          setNotice({ text: 'Credential verified successfully!', tone: 'success' });
        } else {
          setNotice({ text: `Verification failed: ${result.message}`, tone: 'danger' });
        }
      },
      onError: (err) => setNotice({ text: errorMessage(err, 'Verification failed. Check your connection and try again.'), tone: 'danger' }),
    });
  }

  async function removeCredential() {
    const ok = await confirm({
      title: 'Delete credential?',
      message: 'This action cannot be undone. Anything using this credential will stop working.',
      destructiveLabel: 'Delete',
    });
    if (!ok) return;
    remove.mutate(credential!.id, {
      onSuccess: () => {
        warning();
        router.back();
      },
      onError: (err) => setNotice({ text: errorMessage(err, 'Could not delete this credential.'), tone: 'danger' }),
    });
  }

  return (
    <Screen edges={['left', 'right']}>
      <Stack.Screen options={{ title: credential.name }} />
      <ScrollView contentContainerStyle={{ gap: spacing.xl, paddingBottom: spacing.xxl }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.primaryBg, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={credentialIcon(type?.icon)} size={22} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={typography.heading} accessibilityRole="header">{credential.name}</Text>
            <Text style={[typography.caption, { color: colors.mutedText }]}>{credential.credential_type_display}</Text>
          </View>
        </View>

        <Notice message={notice?.text} tone={notice?.tone} />

        <Section title="Fields">
          {credential.fields.length === 0 ? (
            <ListRow title="No fields stored." chevron={false} />
          ) : (
            credential.fields.map((field) => {
              const secret = field.type === 'password';
              const shown = secret && !revealed.has(field.key) ? '••••••••••••' : field.value;
              return (
                <View key={field.key} style={{ padding: spacing.lg, gap: spacing.sm }}>
                  <Text style={typography.bodyStrong}>{field.label}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <View
                      style={{
                        flex: 1,
                        minHeight: 44,
                        justifyContent: 'center',
                        paddingHorizontal: spacing.md,
                        borderRadius: radius.md,
                        backgroundColor: colors.surfaceMuted,
                      }}
                    >
                      <Text selectable style={{ color: colors.text, fontSize: fontSize.md, fontFamily: fontFamily.mono }}>
                        {shown || 'Empty'}
                      </Text>
                    </View>
                    {secret ? (
                      <IconButton
                        label={revealed.has(field.key) ? 'Hide value' : 'Show value'}
                        icon={revealed.has(field.key) ? 'eye-off-outline' : 'eye-outline'}
                        onPress={() => toggleReveal(field.key)}
                      />
                    ) : null}
                    <IconButton
                      label={copied === field.key ? 'Copied' : 'Copy value'}
                      icon={copied === field.key ? 'checkmark' : 'copy-outline'}
                      onPress={() => void copy(field.key, field.value)}
                    />
                  </View>
                </View>
              );
            })
          )}
        </Section>

        <Section title="Status">
          <ListRow
            title={health.text}
            subtitle={credential.last_error && !credential.is_verified ? credential.last_error : undefined}
            chevron={false}
            detail={<Icon name="ellipse" size={10} color={healthColor[health.tone]} />}
          />
          <ListRow title="Created" detail={formatDate(credential.created_at)} chevron={false} />
          <ListRow title="Updated" detail={formatDate(credential.updated_at)} chevron={false} />
          <ListRow title="Last used" detail={formatDate(credential.last_used_at)} chevron={false} />
        </Section>

        <View style={{ gap: spacing.sm }}>
          <Button title="Verify" loading={verify.isPending} disabled={verify.isPending} onPress={runVerify} />
          <Button
            title="Edit"
            variant="secondary"
            onPress={() => router.push({ pathname: '/more/credentials/form', params: { id: String(credential.id) } })}
          />
          <Button title="Delete" variant="secondary" loading={remove.isPending} disabled={remove.isPending} onPress={() => void removeCredential()} />
        </View>
      </ScrollView>
    </Screen>
  );
}

function IconButton({ label, icon, onPress }: { label: string; icon: React.ComponentProps<typeof Icon>['name']; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? pressedOpacity : 1 })}
    >
      <Icon name={icon} size={18} />
    </Pressable>
  );
}
