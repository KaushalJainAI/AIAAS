import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ErrorState } from '../../components/ErrorState';
import { ErrorText } from '../../components/ErrorText';
import { Icon } from '../../components/Icon';
import { ListRow } from '../../components/ListRow';
import { LoadingState } from '../../components/LoadingState';
import { Section } from '../../components/Section';
import { SearchBar } from '../../components/SearchBar';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { confirm } from '../../components/confirm';
import { useOrgs } from '../account/queries';
import { useKnowledgeBases } from '../knowledge/queries';
import { useRefresh } from '../../hooks/useRefresh';
import { success, tap, warning } from '../../lib/haptics';
import { pressedOpacity, radius, spacing, typography, useTheme } from '../../theme';
import { CURATOR_ROLES, type Org } from '../account/types';
import { messageOf } from './form';
import { ImportSheet } from './ImportSheet';
import { Notice } from './Notice';
import { cleanTag, scopeParam, statusForTab } from './page';
import {
  useReviewSolution,
  useRetractSolution,
  useSolutionPages,
  useSolutions,
} from './queries';
import { SolutionCard } from './SolutionCard';
import { TeamInsights } from './TeamInsights';
import type { OrgScope, Solution, SolutionListOptions } from './types';

type Tab = 'library' | 'drafts' | 'queue' | 'insights';

const TAB_LABEL: Record<Tab, string> = {
  library: 'Library',
  drafts: 'My drafts',
  queue: 'Review queue',
  insights: 'Insights',
};

/**
 * Team knowledge: what the organisation has already solved. The library, the
 * drafts a chat found for you, and (for curators) the review queue and insights.
 * Scope is "Just mine" or one organisation, defaulting to the active one.
 */
export function TeamScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { colors } = useTheme();
  const orgsQuery = useOrgs();
  const orgs: Org[] = orgsQuery.data?.orgs ?? [];
  const ready = orgsQuery.data !== undefined;

  const [picked, setPicked] = useState<OrgScope | undefined>(undefined);
  const scope: OrgScope = picked !== undefined ? picked : (orgsQuery.data?.active_org_id ?? null);
  const scopeOrg = orgs.find((o) => o.id === scope);
  const canCurate = !!scopeOrg && (CURATOR_ROLES as readonly string[]).includes(scopeOrg.role);
  const scopeName = scope == null ? 'Just mine' : (scopeOrg?.name ?? 'Organisation');

  const [pickedTab, setPickedTab] = useState<Tab>('library');
  const tab: Tab = (pickedTab === 'queue' || pickedTab === 'insights') && !canCurate ? 'library' : pickedTab;
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [attentionOn, setAttentionOn] = useState(false);
  const [mineOn, setMineOn] = useState(false);
  const [tagState, setTagState] = useState('');
  const [scopeSheet, setScopeSheet] = useState(false);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const isLibrary = tab === 'library';
  const attention = isLibrary && attentionOn;
  const mine = isLibrary && mineOn;
  const tag = isLibrary ? cleanTag(tagState) : '';
  const search = isLibrary && !attention ? submitted : '';

  const opts: SolutionListOptions =
    tab === 'drafts' || tab === 'queue'
      ? { status: statusForTab(tab) }
      : attention
        ? { attention: true, tag, mine }
        : { q: search, tag, mine };

  const listEnabled = ready && (tab !== 'queue' || canCurate) && tab !== 'insights';
  const pages = useSolutionPages(scope, opts, listEnabled);
  const draftCount = useSolutions(scope, { status: 'draft' }, ready);
  const queueCount = useSolutions(scope, { status: 'pending_review' }, ready && canCurate);
  const attentionCount = useSolutions(scope, { attention: true, tag, mine }, ready && isLibrary);
  const teamBases = useKnowledgeBases(scope);

  const items: Solution[] = pages.data?.pages.flatMap((p) => p.solutions) ?? [];
  const lastPage = pages.data?.pages[pages.data.pages.length - 1];
  const attentionCut = attention && lastPage?.truncated === true;
  const tagCapped = lastPage?.tag_scan_capped === true;

  const stillTrue = useReviewSolution();
  const retract = useRetractSolution();
  const rowBusy = stillTrue.isPending || retract.isPending;

  const refetchAll = useCallback(async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: ['solutions'] }), orgsQuery.refetch()]);
  }, [qc, orgsQuery]);
  const { refreshing, onRefresh } = useRefresh(refetchAll);

  const openSolution = (id: number) => router.push(`/more/team/${id}?org=${scopeParam(scope)}`);
  const writeNew = (problem?: string) =>
    router.push(`/more/team/form?org=${scopeParam(scope)}${problem ? `&problem=${encodeURIComponent(problem)}` : ''}`);
  const editSolution = (id: number) => router.push(`/more/team/form?org=${scopeParam(scope)}&id=${id}`);

  const markStillTrue = (s: Solution) => {
    setActionError(null);
    setNotice(null);
    stillTrue.mutate(
      { org: scope, id: s.id, kind: 'verified', reason: '' },
      {
        onSuccess: () => {
          success();
          setNotice('Marked as still true.');
        },
        onError: (e) => setActionError(messageOf(e, 'Could not record that.')),
      },
    );
  };

  const removeSolution = (s: Solution) => {
    void confirm({
      title: 'Remove it?',
      message: 'It leaves the library. The row is kept as removed.',
      destructiveLabel: 'Yes, remove',
    }).then((ok) => {
      if (!ok) return;
      setActionError(null);
      setNotice(null);
      retract.mutate(
        { org: scope, id: s.id },
        {
          onSuccess: () => {
            warning();
            setNotice('Removed.');
          },
          onError: (e) => setActionError(messageOf(e, 'Could not remove it.')),
        },
      );
    });
  };

  const pickTab = (next: Tab) => {
    tap();
    setPickedTab(next);
    setNotice(null);
    setActionError(null);
  };

  const pickScope = (next: OrgScope) => {
    setPicked(next);
    setScopeSheet(false);
    setSubmitted('');
    setTagState('');
    setAttentionOn(false);
    setMineOn(false);
  };

  const tabs: Tab[] = canCurate ? ['library', 'drafts', 'queue', 'insights'] : ['library', 'drafts'];
  const draftTotal = draftCount.data?.total;
  const queueTotal = queueCount.data?.total;
  const attentionTotal = attentionCount.data?.total;

  const header = (
    <View style={styles.header}>
      <Section>
        <ListRow
          icon="business-outline"
          title="Whose solutions"
          detail={scopeName}
          onPress={() => setScopeSheet(true)}
        />
      </Section>

      <View style={styles.chips}>
        {tabs.map((id) => {
          const on = id === tab;
          const count = id === 'drafts' ? draftTotal : id === 'queue' ? queueTotal : undefined;
          return (
            <Toggle key={id} label={TAB_LABEL[id]} count={count} on={on} onPress={() => pickTab(id)} />
          );
        })}
      </View>

      {tab === 'insights' ? null : (
        <>
          {isLibrary && !attention ? (
            <SearchBar
              value={query}
              onChangeText={setQuery}
              placeholder="Describe the problem or paste the error"
              onSubmit={() => setSubmitted(query.trim())}
            />
          ) : null}

          {isLibrary ? (
            <View style={styles.chips}>
              <Toggle
                label="Needs attention"
                count={attentionTotal}
                on={attention}
                onPress={() => setAttentionOn((v) => !v)}
              />
              <Toggle label="Only mine" on={mine} onPress={() => setMineOn((v) => !v)} />
              {tag ? (
                <Toggle label={`Tagged ${tag} ×`} on onPress={() => setTagState('')} />
              ) : null}
            </View>
          ) : null}

          {isLibrary ? (
            <View style={styles.buttons}>
              <View style={styles.button}>
                <Button title="New solution" onPress={() => writeNew()} />
              </View>
              <View style={styles.button}>
                <Button title="Import" variant="secondary" onPress={() => setImporting(true)} />
              </View>
            </View>
          ) : null}

          <Notice text={notice} />
          <ErrorText message={actionError} />
          {attentionCut ? (
            <Text style={[typography.caption, { color: colors.mutedText }]}>
              Only the first 500 solutions were checked. Older ones are not in this list.
            </Text>
          ) : null}
          {tagCapped ? (
            <Text style={[typography.caption, { color: colors.mutedText }]}>
              This tag was searched among the newest solutions only. Older matches may be missing.
            </Text>
          ) : null}
        </>
      )}
    </View>
  );

  const scopeSheetEl = (
    <Sheet visible={scopeSheet} onClose={() => setScopeSheet(false)} title="Whose solutions">
      <ListRow
        title="Just mine"
        chevron={false}
        detail={scope == null ? <Icon name="checkmark" size={18} color={colors.primary} /> : undefined}
        onPress={() => pickScope(null)}
      />
      {orgs.map((o) => (
        <ListRow
          key={o.id}
          title={o.name}
          chevron={false}
          detail={o.id === scope ? <Icon name="checkmark" size={18} color={colors.primary} /> : undefined}
          onPress={() => pickScope(o.id)}
        />
      ))}
    </Sheet>
  );

  const importSheet = importing ? (
    <ImportSheet
      org={scope}
      onClose={() => setImporting(false)}
      onStarted={(message) => setNotice(message)}
    />
  ) : null;

  if (tab === 'insights') {
    return (
      <>
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {header}
          {scopeOrg ? <TeamInsights org={scopeOrg.id} orgName={scopeOrg.name} /> : null}
        </ScrollView>
        {scopeSheetEl}
      </>
    );
  }

  const emptyText =
    tab === 'drafts'
      ? 'No drafts. When a fix is found in a team chat, its draft waits here for you to share or discard.'
      : tab === 'queue'
        ? 'Nothing is waiting for review.'
        : attention
          ? 'Nothing needs attention right now.'
          : submitted || tag || mine
            ? 'No saved solution matches these filters.'
            : '';

  return (
    <>
      <FlatList
        data={items}
        keyExtractor={(s) => String(s.id)}
        contentContainerStyle={styles.list}
        ListHeaderComponent={header}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        renderItem={({ item }) => (
          <SolutionCard
            s={item}
            attentionView={attention}
            busy={rowBusy}
            onOpen={() => openSolution(item.id)}
            onTag={(t) => {
              setTagState(t);
              setPickedTab('library');
            }}
            onStillTrue={() => markStillTrue(item)}
            onEdit={() => editSolution(item.id)}
            onRetract={() => removeSolution(item)}
          />
        )}
        ListEmptyComponent={
          pages.isPending && listEnabled ? (
            <LoadingState text="Loading solutions" />
          ) : pages.isError ? (
            <ErrorState
              message={messageOf(pages.error, 'Solutions could not be loaded.')}
              onRetry={() => void pages.refetch()}
            />
          ) : !ready ? (
            <LoadingState text="Loading solutions" />
          ) : isLibrary && !attention && !submitted && !tag && !mine ? (
            <LibraryStart onWrite={() => writeNew()} onImport={() => setImporting(true)} hasOrg={orgs.length > 0} />
          ) : (
            <Text style={[typography.body, styles.centre, { color: colors.mutedText }]}>{emptyText}</Text>
          )
        }
        ListFooterComponent={
          <View style={styles.footer}>
            {pages.hasNextPage ? (
              <Button
                title="Load more"
                variant="secondary"
                loading={pages.isFetchingNextPage}
                onPress={() => void pages.fetchNextPage()}
              />
            ) : null}
            {isLibrary && scope != null ? <TeamDocuments bases={teamBases.data?.knowledge_bases ?? []} /> : null}
          </View>
        }
      />
      {scopeSheetEl}
      {importSheet}
    </>
  );
}

/** The library's first-run view: how it fills, in the web's three ways (and a team line when there is no organisation). */
function LibraryStart({ onWrite, onImport, hasOrg }: { onWrite: () => void; onImport: () => void; hasOrg: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={styles.start}>
      <Text style={[typography.heading, { color: colors.text }]}>Nothing saved yet</Text>
      <Text style={[typography.body, { color: colors.mutedText }]}>The library fills in three ways. Pick one to start.</Text>
      <Card>
        <Text style={[typography.label, { color: colors.text }]}>Write one</Text>
        <Text style={[typography.body, { color: colors.mutedText }]}>
          Describe a problem you solved and how you fixed it. It takes a few minutes.
        </Text>
        <View style={styles.startAction}>
          <Button title="Write one" variant="secondary" onPress={onWrite} />
        </View>
      </Card>
      <Card>
        <Text style={[typography.label, { color: colors.text }]}>Import from a document</Text>
        <Text style={[typography.body, { color: colors.mutedText }]}>
          Pick a Word, PDF, Markdown or text file from your library. The fixes in it arrive as drafts.
        </Text>
        <View style={styles.startAction}>
          <Button title="Import from a document" variant="secondary" onPress={onImport} />
        </View>
      </Card>
      <Card>
        <Text style={[typography.label, { color: colors.text }]}>Solve something in chat</Text>
        <Text style={[typography.body, { color: colors.mutedText }]}>
          When a fix works, give the answer a thumbs-up. We will draft it for you to review.
        </Text>
      </Card>
      {!hasOrg ? (
        <Card>
          <Text style={[typography.label, { color: colors.text }]}>Create a team</Text>
          <Text style={[typography.body, { color: colors.mutedText }]}>
            A team library is shared by everyone in the team. Create one in the web app to start sharing fixes.
          </Text>
        </Card>
      ) : null}
    </View>
  );
}

/** Knowledge bases the team shares with this organisation. Read-only; the owner shares them from Knowledge. */
function TeamDocuments({ bases }: { bases: { id: number; name: string; owner_name: string; doc_count: number; is_mine: boolean }[] }) {
  const shared = bases.filter((kb) => !kb.is_mine);
  return (
    <Section title="Team documents" footer="A knowledge base is shared from Knowledge bases, by the person who owns it.">
      {shared.length === 0 ? (
        <ListRow title="Nothing shared yet." chevron={false} />
      ) : (
        shared.map((kb) => (
          <ListRow
            key={kb.id}
            icon="library-outline"
            title={kb.name}
            subtitle={`Shared by ${kb.owner_name} · ${kb.doc_count} documents`}
          />
        ))
      )}
    </Section>
  );
}

/** A filter or tab pill: 44pt, selected fills with the primary colour. */
function Toggle({ label, count, on, onPress }: { label: string; count?: number; on: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={count ? `${label}, ${count}` : label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.toggle,
        {
          borderColor: on ? colors.primary : colors.border,
          backgroundColor: on ? colors.primary : colors.surface,
          opacity: pressed ? pressedOpacity : 1,
        },
      ]}
    >
      <Text style={[typography.label, { color: on ? colors.primaryText : colors.text }]}>{label}</Text>
      {count ? <Badge count={count} tone={on ? 'neutral' : 'danger'} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md, paddingBottom: spacing.xl, flexGrow: 1 },
  scroll: { paddingBottom: spacing.xl },
  header: { gap: spacing.md, paddingBottom: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  toggle: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  buttons: { flexDirection: 'row', gap: spacing.md },
  button: { flex: 1 },
  footer: { gap: spacing.lg, paddingTop: spacing.md },
  centre: { textAlign: 'center', paddingVertical: spacing.xl },
  start: { gap: spacing.md, paddingTop: spacing.md },
  startAction: { marginTop: spacing.sm },
});
