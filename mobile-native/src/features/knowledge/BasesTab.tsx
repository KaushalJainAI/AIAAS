import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ErrorState } from '../../components/ErrorState';
import { ListRow } from '../../components/ListRow';
import { LoadingState } from '../../components/LoadingState';
import { Section } from '../../components/Section';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { Icon } from '../../components/Icon';
import { useOrgs } from '../account/queries';
import { useRefresh } from '../../hooks/useRefresh';
import { spacing, typography, useTheme } from '../../theme';
import { BACKEND_LABEL, messageOf } from './format';
import { useKnowledgeBases } from './queries';
import type { KnowledgeBaseRow } from './types';

/**
 * The knowledge bases list, as the web's "Your knowledge bases" and "Team
 * knowledge bases" sections. Team bases are read-only here: the owner manages them.
 */
export function BasesTab() {
  const router = useRouter();
  const { colors } = useTheme();
  const orgs = useOrgs();
  const mine = useKnowledgeBases(null);
  const [teamPick, setTeamPick] = useState<number | null>(null);
  const [orgSheet, setOrgSheet] = useState(false);

  const orgList = orgs.data?.orgs ?? [];
  const teamOrg =
    orgList.find((o) => o.id === teamPick) ??
    orgList.find((o) => o.id === orgs.data?.active_org_id) ??
    orgList[0] ??
    null;
  const team = useKnowledgeBases(teamOrg?.id ?? null);

  const ownKbs = (mine.data?.knowledge_bases ?? []).filter((kb) => kb.is_mine);
  const teamKbs = teamOrg ? (team.data?.knowledge_bases ?? []).filter((kb) => !kb.is_mine) : [];
  const orgName = (id: number | null) => orgList.find((o) => o.id === id)?.name;

  const refetchAll = useCallback(async () => {
    await Promise.all([mine.refetch(), orgs.refetch(), teamOrg ? team.refetch() : Promise.resolve()]);
  }, [mine, orgs, team, teamOrg]);
  const { refreshing, onRefresh } = useRefresh(refetchAll);

  if (mine.isPending) return <LoadingState text="Loading knowledge bases" />;
  if (mine.isError) {
    return <ErrorState message={messageOf(mine.error, 'Knowledge bases could not be loaded.')} onRetry={() => void mine.refetch()} />;
  }

  return (
    <>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Button title="Search and ask" variant="secondary" onPress={() => router.push('/more/knowledge/search')} />

        <Section title="Your knowledge bases">
          {ownKbs.length === 0 ? (
            <Card>
              <Text style={[typography.body, { color: colors.mutedText }]}>No knowledge bases yet.</Text>
            </Card>
          ) : (
            ownKbs.map((kb) => <OwnRow key={kb.id} kb={kb} sharedWith={orgName(kb.org)} onOpen={() => router.push(`/more/knowledge/${kb.id}`)} />)
          )}
        </Section>

        {mine.data?.truncated ? <Text style={[typography.caption, { color: colors.mutedText }]}>Showing the first part of this list. The rest are not shown here.</Text> : null}

        {orgList.length > 0 ? (
          <Section
            title="Team knowledge bases"
            footer="Members can search these from chat. They cannot upload to them or delete from them."
          >
            {orgList.length > 1 ? (
              <ListRow
                icon="people-outline"
                title="Organisation"
                detail={teamOrg?.name ?? ''}
                onPress={() => setOrgSheet(true)}
              />
            ) : null}
            {team.isPending && teamOrg ? (
              <Card><Text style={[typography.body, { color: colors.mutedText }]}>Loading…</Text></Card>
            ) : teamKbs.length === 0 ? (
              <ListRow title="Nothing shared with this organisation yet." />
            ) : (
              teamKbs.map((kb) => (
                <ListRow
                  key={kb.id}
                  icon="library-outline"
                  title={kb.name}
                  subtitle={`Shared by ${kb.owner_name} · ${kb.doc_count} documents`}
                />
              ))
            )}
          </Section>
        ) : null}
      </ScrollView>

      <Sheet visible={orgSheet} onClose={() => setOrgSheet(false)} title="Organisation">
        {orgList.map((o) => (
          <ListRow
            key={o.id}
            title={o.name}
            chevron={false}
            onPress={() => {
              setTeamPick(o.id);
              setOrgSheet(false);
            }}
            detail={o.id === teamOrg?.id ? <Icon name="checkmark" size={18} color={colors.primary} /> : undefined}
          />
        ))}
      </Sheet>
    </>
  );
}

function OwnRow({ kb, sharedWith, onOpen }: { kb: KnowledgeBaseRow; sharedWith?: string; onOpen: () => void }) {
  const parts = [BACKEND_LABEL[kb.backend], `${kb.doc_count} documents`, kb.size_human];
  if (kb.shared_with_org && sharedWith) parts.push(`shared with ${sharedWith}`);
  return <ListRow icon="library-outline" title={kb.name} subtitle={parts.join(' · ')} onPress={onOpen} />;
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl, paddingBottom: spacing.xl },
});

