import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { ListRow } from '../../components/ListRow';
import { LoadingState } from '../../components/LoadingState';
import { Section } from '../../components/Section';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { confirm } from '../../components/confirm';
import { success } from '../../lib/haptics';
import { spacing, useTheme } from '../../theme';
import { formatDateTime, formatSize, locationOf, typeName } from './display';
import { errorMessage } from './helpers';
import { useRestoreVersion, useVersions } from './queries';
import type { Document, DocumentVersion } from './types';

const SOURCE_LABEL: Record<DocumentVersion['source'], string> = {
  app: 'Saved in an app',
  agent: 'Saved by an agent',
  restore: 'Before a restore',
};

interface Props {
  doc: Document;
  onClose: () => void;
  /** Reports the outcome after the sheet has closed. */
  notify: (text: string, tone?: 'success' | 'danger') => void;
}

/** A file's properties and its earlier versions, with restore. Mirrors the web's Properties dialog and version list. */
export function DetailsSheet({ doc, onClose, notify }: Props) {
  const { colors } = useTheme();
  const versions = useVersions(doc.id);
  const restore = useRestoreVersion(doc.id);
  const [failure, setFailure] = useState<string | null>(null);

  const author = doc.author ? `${doc.author.kind === 'agent' ? 'Agent' : 'Chat'} · ${doc.author.name}` : 'You';
  const facts: [string, string][] = [
    ['Type', typeName(doc)],
    ['Size', formatSize(doc.file_size)],
    ['Location', locationOf(doc)],
    ['Created', formatDateTime(doc.created_at)],
    ['Modified', formatDateTime(doc.updated_at)],
    ['Written by', author],
  ];

  const askRestore = async (version: DocumentVersion) => {
    const ok = await confirm({
      title: 'Restore this version?',
      message: `The file goes back to how it was on ${formatDateTime(version.created_at)}. The current version is kept, so this can be undone.`,
      destructiveLabel: 'Restore',
    });
    if (!ok) return;
    setFailure(null);
    try {
      await restore.mutateAsync({ versionId: version.id });
      success();
      onClose();
      notify('Restored an earlier version');
    } catch (err) {
      setFailure(errorMessage(err, 'That version could not be restored.'));
    }
  };

  return (
    <Sheet visible onClose={onClose} title="Properties">
      <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.sm }}>
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>{doc.filename}</Text>
        <Section>
          {facts.map(([label, value]) => (
            <ListRow key={label} title={label} detail={value} chevron={false} />
          ))}
        </Section>

        <Section title="Earlier versions" footer="Restoring keeps the current version, so a restore can be undone.">
          {versions.isPending ? (
            <View style={{ minHeight: 120 }}>
              <LoadingState />
            </View>
          ) : versions.isError ? (
            <View style={{ minHeight: 160 }}>
              <ErrorState message="The versions could not be loaded." onRetry={() => void versions.refetch()} />
            </View>
          ) : versions.data && versions.data.length > 0 ? (
            versions.data.map((version) => (
              <ListRow
                key={version.id}
                title={SOURCE_LABEL[version.source]}
                subtitle={`${formatDateTime(version.created_at)} · ${formatSize(version.size)}`}
                icon="arrow-undo-outline"
                chevron={false}
                disabled={restore.isPending}
                onPress={() => void askRestore(version)}
              />
            ))
          ) : (
            <View style={{ minHeight: 120 }}>
              <EmptyState title="No earlier versions" message="Changes you save will appear here." />
            </View>
          )}
        </Section>

        {failure ? <Text style={{ color: colors.danger, fontSize: 14 }}>{failure}</Text> : null}
      </ScrollView>
    </Sheet>
  );
}
