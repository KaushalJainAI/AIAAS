import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Switch } from '../../components/Switch';
import { useRouter } from 'expo-router';

import { Badge } from '../../components/Badge';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { ErrorText } from '../../components/ErrorText';
import { Icon } from '../../components/Icon';
import { ListRow } from '../../components/ListRow';
import { LoadingState } from '../../components/LoadingState';
import { Section } from '../../components/Section';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { useOrgs } from '../account/queries';
import { success } from '../../lib/haptics';
import { spacing, typography, useTheme } from '../../theme';
import { documentName } from './documents';
import { BACKEND_HINT, BACKEND_LABEL, messageOf } from './format';
import { openDocument } from './openDocument';
import { useKnowledgeBases, usePersonalDocuments, useSetKnowledgeSharing } from './queries';

/** One of the person's knowledge bases: what it holds, and whether the team can search it. */
export function BaseDetail({ id }: { id: number }) {
  const router = useRouter();
  const { colors } = useTheme();
  const mine = useKnowledgeBases(null);
  const orgs = useOrgs();
  const files = usePersonalDocuments();
  const share = useSetKnowledgeSharing();
  const [pick, setPick] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (mine.isPending) return <LoadingState text="Loading knowledge base" />;
  if (mine.isError) {
    return (
      <ErrorState
        message={messageOf(mine.error, 'The knowledge base could not be loaded.')}
        onRetry={() => void mine.refetch()}
      />
    );
  }
  const kb = mine.data?.knowledge_bases.find((row) => row.id === id && row.is_mine);
  if (!kb) return <EmptyState title="Not available" message="This knowledge base is not available." />;

  const orgList = orgs.data?.orgs ?? [];
  const target = orgList.find((o) => o.id === pick) ?? orgList[0] ?? null;
  const sharedOrgName = orgList.find((o) => o.id === kb.org)?.name;

  const setSharing = (patch: { org?: number | null; shared_with_org?: boolean }) => {
    setError(null);
    share.mutate(
      { id: kb.id, patch },
      {
        onSuccess: () => success(),
        onError: (e) => setError(messageOf(e, 'Could not change sharing.')),
      },
    );
  };

  const docs = (files.data?.documents ?? []).filter((doc) => doc.knowledge_base_id === kb.id);

  return (
    <>
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <View style={styles.head}>
            <Text style={[typography.heading, { color: colors.text }]}>{kb.name}</Text>
            {kb.description ? (
              <Text style={[typography.body, { color: colors.mutedText }]}>{kb.description}</Text>
            ) : null}
            <View style={styles.badges}>
              <Badge label={BACKEND_LABEL[kb.backend]} tone="neutral" />
              {kb.is_default ? <Badge label="Default" tone="info" /> : null}
              <Badge label={`${kb.doc_count} documents`} tone="neutral" />
              <Badge label={kb.size_human} tone="neutral" />
            </View>
            <Text style={[typography.caption, { color: colors.mutedText }]}>{BACKEND_HINT[kb.backend]}</Text>
          </View>
        </Card>

        <Section
          title="Sharing"
          footer="Members can search it from chat. They cannot upload to it or delete from it."
        >
          {kb.shared_with_org && kb.org != null ? (
            <ListRow
              icon="people-outline"
              title={`Shared with ${sharedOrgName ?? 'your team'}`}
              chevron={false}
              detail={
                <Switch
                  accessibilityLabel={`Share ${kb.name} with ${sharedOrgName ?? 'your team'}`}
                  value
                  disabled={share.isPending}
                  onValueChange={() => setSharing({ shared_with_org: false })}
                />
              }
            />
          ) : orgList.length === 0 ? (
            <ListRow
              icon="people-outline"
              title="Share with your team"
              subtitle="Join an organisation to share this knowledge base with your team."
              chevron={false}
            />
          ) : (
            <>
              {orgList.length > 1 ? (
                <ListRow
                  icon="business-outline"
                  title="Organisation"
                  detail={target?.name ?? ''}
                  onPress={() => setPickerOpen(true)}
                />
              ) : null}
              <ListRow
                icon="people-outline"
                title={`Share with ${target?.name ?? 'your organisation'}`}
                chevron={false}
                detail={
                  <Switch
                    accessibilityLabel={`Share ${kb.name} with ${target?.name ?? 'your organisation'}`}
                    value={false}
                    disabled={share.isPending || !target}
                    onValueChange={() => {
                      if (target) setSharing({ org: target.id, shared_with_org: true });
                    }}
                  />
                }
              />
            </>
          )}
          <ErrorText message={error} />
        </Section>

        <Section title="Documents in this knowledge base">
          {files.isPending ? (
            <Card>
              <Text style={[typography.body, { color: colors.mutedText }]}>Loading files…</Text>
            </Card>
          ) : files.isError ? (
            <ErrorState
              message={messageOf(files.error, 'Your files could not be loaded.')}
              onRetry={() => void files.refetch()}
            />
          ) : docs.length === 0 ? (
            <Card>
              <Text style={[typography.body, { color: colors.mutedText }]}>
                No documents are in this knowledge base yet.
              </Text>
            </Card>
          ) : (
            docs.map((doc) => (
              <ListRow
                key={doc.id}
                icon="document-text-outline"
                title={documentName(doc)}
                subtitle={`${doc.file_type.toUpperCase()} · ${doc.folder_path || 'Top level'}`}
                onPress={() => openDocument(router, doc.id, documentName(doc))}
              />
            ))
          )}
        </Section>
        {files.data?.truncated ? (
          <Text style={[typography.caption, { color: colors.mutedText }]}>
            Only the first 1,000 files were checked. Older ones may be missing.
          </Text>
        ) : null}
      </ScrollView>

      <Sheet visible={pickerOpen} onClose={() => setPickerOpen(false)} title="Share with which organisation">
        {orgList.map((o) => (
          <ListRow
            key={o.id}
            title={o.name}
            chevron={false}
            detail={o.id === target?.id ? <Icon name="checkmark" size={18} color={colors.primary} /> : undefined}
            onPress={() => {
              setPick(o.id);
              setPickerOpen(false);
            }}
          />
        ))}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl, paddingBottom: spacing.xl },
  head: { gap: spacing.sm },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
