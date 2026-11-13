import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { Button } from '../../components/Button';
import { confirm } from '../../components/confirm';
import { ErrorState } from '../../components/ErrorState';
import { ErrorText } from '../../components/ErrorText';
import { LoadingState } from '../../components/LoadingState';
import { Screen } from '../../components/Screen';
import { Section } from '../../components/Section';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { success, warning } from '../../lib/haptics';
import { spacing, typography, useTheme } from '../../theme';
import { errorMessage } from '../settings/errors';
import { PickerSheet } from '../settings/Picker';
import { PickerRow } from '../settings/PickerRow';
import { publishShare, withdrawShare } from './api';
import { connectionKeys, useSharePreview } from './queries';
import type { CustomToolKind, ShareVisibility } from './types';

/** The web's wording for who can find and install a listing. Never defaults to public. */
const VISIBILITY: { value: ShareVisibility; label: string; detail: string }[] = [
  { value: 'link', label: 'Anyone with the link', detail: 'Only people who open the link can find it.' },
  { value: 'platform', label: 'Anyone signed in', detail: 'Any signed-in user can find and install it.' },
  { value: 'public', label: 'Public — no account needed', detail: 'Anyone on the internet can read the listing.' },
];

/**
 * Publish a snapshot of one of the user's own tools, or withdraw it. The
 * snapshot carries no secrets: whoever installs it links their own credential.
 */
export function ShareScreen({ kind, id, name }: { kind: CustomToolKind; id: number; name: string }) {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const preview = useSharePreview(kind, id);

  const [tagline, setTagline] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<ShareVisibility>('platform');
  const [seeded, setSeeded] = useState(false);
  const [pickVisibility, setPickVisibility] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Seed the form from the current listing (or the tool's name) once it arrives.
  // During render, not in an effect, so the blank form never paints first.
  if (preview.data && !seeded) {
    setSeeded(true);
    setTagline(preview.data.tagline || name);
    setDescription(preview.data.description || '');
    setVisibility(preview.data.visibility || 'platform');
  }

  if (preview.isPending) return <LoadingState text="Loading listing" />;
  if (preview.isError) {
    return <ErrorState message="Could not load this tool's listing. Check your connection and try again." onRetry={() => void preview.refetch()} />;
  }

  const published = preview.data.published;
  const visibilityLabel = VISIBILITY.find((v) => v.value === visibility)?.label ?? '';

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: connectionKeys.share(kind, id) });
    void queryClient.invalidateQueries({ queryKey: connectionKeys.shared });
  }

  async function publish() {
    setError(null);
    if (!tagline.trim()) return setError('Add a one-line description.');
    setBusy(true);
    try {
      await publishShare(kind, id, {
        tagline: tagline.trim(),
        description: description.trim() || undefined,
        visibility,
      });
      success();
      refresh();
      router.back();
    } catch (err) {
      setError(errorMessage(err, 'Could not share this tool.'));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    const ok = await confirm({
      title: 'Withdraw this listing?',
      message: 'It is unlisted, not deleted. Anyone who installed it keeps their copy.',
      destructiveLabel: 'Withdraw',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await withdrawShare(kind, id);
      warning();
      refresh();
      router.back();
    } catch (err) {
      setError(errorMessage(err, 'Could not withdraw this tool.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen edges={['left', 'right']}>
      <Stack.Screen options={{ title: 'Share tool' }} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.xl, paddingBottom: spacing.xxl }}>
        <View style={{ gap: spacing.xs }}>
          <Text style={typography.heading} accessibilityRole="header">Share “{name}”</Text>
          <Text style={[typography.caption, { color: colors.mutedText }]}>
            Publishes a snapshot. Your credential never travels. Whoever installs it links their own.
          </Text>
        </View>

        {published ? (
          <Section>
            <View style={{ padding: spacing.lg, gap: spacing.xs }}>
              <Text style={typography.body}>Listed as <Text style={typography.mono}>{preview.data.slug}</Text></Text>
              <Text style={[typography.caption, { color: colors.mutedText }]}>
                {preview.data.install_count} install{preview.data.install_count === 1 ? '' : 's'} · version {preview.data.version}
              </Text>
            </View>
          </Section>
        ) : null}

        <Section>
          <View style={{ padding: spacing.lg, gap: spacing.lg }}>
            <TextField
              label="One-line description"
              value={tagline}
              onChangeText={setTagline}
              placeholder="What this connects to, in a few words"
            />
            <TextField
              label="Description (optional)"
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
              style={{ minHeight: 72, textAlignVertical: 'top' }}
            />
            <View style={{ gap: spacing.xs }}>
              <PickerRow
                label="Visibility"
                value={visibilityLabel}
                placeholder="Anyone signed in"
                onPress={() => setPickVisibility(true)}
              />
              <Text style={[typography.caption, { color: colors.mutedText }]}>
                {VISIBILITY.find((v) => v.value === visibility)?.detail ?? 'Who can find and install this. Never defaults to public.'}
              </Text>
            </View>
          </View>
        </Section>

        <ErrorText message={error} />

        <View style={{ gap: spacing.sm }}>
          <Button
            title={published ? 'Update listing' : 'Share'}
            loading={busy}
            disabled={!tagline.trim() || busy}
            onPress={() => void publish()}
          />
          {published ? (
            <Button title="Withdraw" variant="secondary" disabled={busy} onPress={() => void withdraw()} />
          ) : null}
          <Button title="Cancel" variant="secondary" disabled={busy} onPress={() => router.back()} />
        </View>
      </ScrollView>

      <PickerSheet
        visible={pickVisibility}
        title="Visibility"
        options={VISIBILITY.map((v) => ({ value: v.value, label: v.label, detail: v.detail }))}
        value={visibility}
        onPick={(v) => setVisibility(v as ShareVisibility)}
        onClose={() => setPickVisibility(false)}
      />
    </Screen>
  );
}
