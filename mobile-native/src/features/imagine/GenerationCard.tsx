/**
 * One generation: its prompt, its state, and what it made. An image shows in the
 * frame of its own ratio. Video and audio open to play. Save or share and delete
 * sit at the foot, as they do on the web result card.
 */
import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { Text } from '../../components/Text';
import { messageOf } from '../agents/format';
import { pressedOpacity, radius, spacing, typography, useTheme } from '../../theme';
import { Notice, Panel } from '../builder/ui';
import { aspectOf, openMedia, saveOrShare } from './media';
import type { MediaKind } from './types';

/** The fields a card reads. Both the form's jobs and the agent's generations fit. */
export interface CardGeneration {
  id: number;
  type: MediaKind;
  prompt: string;
  model: string;
  status: string;
  output_url: string | null;
  output_urls?: string[];
  error_message: string | null;
  aspect_ratio?: string | null;
  created_at?: string;
}

interface Props {
  generation: CardGeneration;
  /** Omitted where the card is read-only (inside a chat). */
  onDelete?: (id: number) => void;
  deleting?: boolean;
}

const KIND_LABEL: Record<MediaKind, string> = { image: 'Image', video: 'Video', audio: 'Audio' };

export function GenerationCard({ generation: g, onDelete, deleting = false }: Props) {
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urls = g.output_urls?.length ? g.output_urls : g.output_url ? [g.output_url] : [];
  const done = g.status === 'completed' && urls.length > 0;
  const failed = g.status === 'failed';
  const modelName = g.model.split('/').pop() ?? g.model;

  const share = async () => {
    if (!urls[0]) return;
    setBusy(true);
    setError(null);
    try {
      await saveOrShare(urls[0]);
    } catch (err) {
      setError(messageOf(err, 'Could not save that file. It may have expired.'));
    } finally {
      setBusy(false);
    }
  };

  const play = async (url: string) => {
    setError(null);
    try {
      await openMedia(url);
    } catch (err) {
      setError(messageOf(err, 'Could not open that file.'));
    }
  };

  return (
    <Panel>
      <Text numberOfLines={3} style={[typography.body, { color: colors.text }]}>{g.prompt}</Text>

      {failed ? (
        <Notice text={`Generation failed${g.error_message ? `: ${g.error_message}` : '.'}`} />
      ) : !done ? (
        <View style={styles.pending}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[typography.caption, { color: colors.mutedText }]}>
            {g.type === 'video' ? 'Rendering video…' : 'Generating…'}
          </Text>
        </View>
      ) : g.type === 'image' ? (
        urls.map((url) => (
          <Image
            key={url}
            accessibilityLabel={g.prompt}
            source={{ uri: url }}
            resizeMode="cover"
            style={[styles.image, { aspectRatio: aspectOf(g.aspect_ratio), borderRadius: radius.md, backgroundColor: colors.inputBackground }]}
          />
        ))
      ) : (
        urls.map((url, i) => (
          <Button
            key={url}
            title={urls.length > 1 ? `Play ${KIND_LABEL[g.type].toLowerCase()} ${i + 1}` : `Play ${KIND_LABEL[g.type].toLowerCase()}`}
            variant="secondary"
            onPress={() => void play(url)}
          />
        ))
      )}

      {error ? <Notice text={error} /> : null}

      <View style={styles.footer}>
        <Text style={[typography.caption, { color: colors.mutedText, flex: 1 }]} numberOfLines={1}>
          {KIND_LABEL[g.type]} · {modelName}
        </Text>
        {done ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save or share"
            disabled={busy}
            onPress={() => void share()}
            style={({ pressed }) => [styles.action, { opacity: busy ? 0.5 : pressed ? pressedOpacity : 1 }]}
          >
            {busy ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Icon name="share-outline" size={20} color={colors.primary} />
            )}
          </Pressable>
        ) : null}
        {onDelete ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete"
            disabled={deleting}
            onPress={() => onDelete(g.id)}
            style={({ pressed }) => [styles.action, { opacity: deleting ? 0.5 : pressed ? pressedOpacity : 1 }]}
          >
            <Icon name="trash-outline" size={20} color={colors.danger} />
          </Pressable>
        ) : null}
      </View>
    </Panel>
  );
}

const styles = StyleSheet.create({
  image: { width: '100%' },
  pending: { minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  footer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  action: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
