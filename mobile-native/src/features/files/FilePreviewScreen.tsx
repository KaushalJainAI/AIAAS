import { useState, type ReactNode } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';

import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { LoadingState } from '../../components/LoadingState';
import { Markdown } from '../../components/Markdown';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { success } from '../../lib/haptics';
import { refreshAccessToken } from '../../api/client';
import { spacing, typography, useTheme } from '../../theme';
import { defaultAppFor } from '../apps/catalogue';
import { kindOf, legacySentence, typeName, formatJson } from './display';
import { documentDownloadPath } from './api';
import { sendCopy } from './download';
import { FileActions, type FileTarget } from './FileActions';
import { errorMessage } from './helpers';
import { NoticeBar, useNotice } from './notice';
import { canPreviewNatively, useOpenFile } from './open';
import { useDocument } from './queries';
import { authorizationHeaders, buildUrl } from './transfer';
import type { Document } from './types';

/** Longer text is cut here so a big file cannot freeze the screen. */
const MAX_TEXT_CHARS = 150_000;

/** A picture, drawn from the server with the bearer token. A failure offers one retry. */
function PictureView({ doc }: { doc: Document }) {
  const { colors } = useTheme();
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const uri = buildUrl(documentDownloadPath(doc.id), { inline: 1 });

  if (failed) {
    return (
      <ErrorState
        message="This picture could not be loaded."
        onRetry={() => {
          setFailed(false);
          // The sign-in may have run out: refresh it, then draw the picture again.
          void refreshAccessToken().catch(() => null).finally(() => setAttempt((n) => n + 1));
        }}
      />
    );
  }

  return (
    <View style={styles.pictureWrap}>
      <Image
        key={attempt}
        accessibilityLabel={doc.filename}
        source={{ uri, headers: authorizationHeaders() }}
        resizeMode="contain"
        onError={() => setFailed(true)}
        style={[styles.picture, { backgroundColor: colors.surfaceMuted }]}
      />
    </View>
  );
}

/** The file's own words: Markdown rendered, or plain text kept as typed. */
function TextView({ doc }: { doc: Document }) {
  const { colors } = useTheme();
  const content = doc.content ?? '';
  const cut = content.length > MAX_TEXT_CHARS;
  const text = cut ? content.slice(0, MAX_TEXT_CHARS) : content;

  if (kindOf(doc) === 'markdown') {
    return (
      <ScrollView contentContainerStyle={styles.textPad}>
        <Markdown text={text} />
        {cut ? <Text style={{ color: colors.mutedText, fontSize: 14, marginTop: spacing.md }}>{cutNote}</Text> : null}
      </ScrollView>
    );
  }
  const plain = kindOf(doc) === 'json' ? (formatJson(text) ?? text) : text;
  return (
    <ScrollView contentContainerStyle={styles.textPad}>
      <Text selectable style={{ ...typography.mono, color: colors.text }}>
        {plain}
      </Text>
      {cut ? <Text style={{ color: colors.mutedText, fontSize: 14, marginTop: spacing.md }}>{cutNote}</Text> : null}
    </ScrollView>
  );
}

const cutNote = 'Showing the first 150,000 characters. Open the file to see the rest.';

interface Props {
  id: number;
}

/** One file, shown in the app: a picture, or plain text and Markdown. Everything else opens in its web app. */
export function FilePreviewScreen({ id }: Props) {
  const { colors } = useTheme();
  const doc = useDocument(id);
  const openFile = useOpenFile();
  const { notice, show, dismiss } = useNotice();
  const [target, setTarget] = useState<FileTarget | null>(null);
  const [sending, setSending] = useState(false);

  const d = doc.data;
  const app = d ? defaultAppFor(d) : undefined;

  let body: ReactNode;
  if (doc.isPending) {
    body = <LoadingState text="Opening…" />;
  } else if (doc.isError || !d) {
    body = (
      <ErrorState
        message={errorMessage(doc.error, 'This file could not be opened.')}
        onRetry={() => void doc.refetch()}
      />
    );
  } else if (!canPreviewNatively(d)) {
    body = (
      <EmptyState
        title="No preview here"
        message={kindOf(d) === 'legacy_office' ? legacySentence(d) : `${typeName(d)}. Open it in ${app?.title ?? 'an app'}, or send a copy.`}
      />
    );
  } else if (kindOf(d) === 'media') {
    body = <PictureView doc={d} />;
  } else {
    body = <TextView doc={d} />;
  }

  return (
    <Screen edges={['left', 'right', 'bottom']} style={{ padding: 0 }}>
      <Stack.Screen options={{ title: d?.filename ?? 'File' }} />
      <View style={styles.body}>{body}</View>

      {d ? (
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <NoticeBar notice={notice} onDismiss={dismiss} />
          {app ? <Button title={`Open in ${app.title}`} onPress={() => openFile(d, app)} /> : null}
          <View style={styles.row}>
            <View style={styles.grow}>
              <Button
                title="Download"
                variant="secondary"
                loading={sending}
                onPress={() => {
                  setSending(true);
                  sendCopy(d)
                    .then(() => success())
                    .catch((err: unknown) => show(errorMessage(err, 'Could not download the file.'), 'danger'))
                    .finally(() => setSending(false));
                }}
              />
            </View>
            <View style={styles.grow}>
              <Button title="More" variant="secondary" onPress={() => setTarget({ kind: 'file', doc: d })} />
            </View>
          </View>
        </View>
      ) : null}

      {target ? <FileActions target={target} onClose={() => setTarget(null)} notify={show} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  pictureWrap: { flex: 1, padding: spacing.md },
  picture: { flex: 1, borderRadius: 6 },
  textPad: { padding: spacing.lg },
  footer: { padding: spacing.lg, gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', gap: spacing.sm },
  grow: { flex: 1 },
});
