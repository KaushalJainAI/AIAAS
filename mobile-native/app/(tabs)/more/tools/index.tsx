import { useMemo, useState, type ReactElement } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Switch } from '../../../../src/components/Switch';
import { Stack, useRouter } from 'expo-router';

import { EmptyState } from '../../../../src/components/EmptyState';
import { ErrorState } from '../../../../src/components/ErrorState';
import { ErrorText } from '../../../../src/components/ErrorText';
import { ListRow } from '../../../../src/components/ListRow';
import { LoadingState } from '../../../../src/components/LoadingState';
import { Screen } from '../../../../src/components/Screen';
import { SearchBar } from '../../../../src/components/SearchBar';
import { SegmentedControl } from '../../../../src/components/SegmentedControl';
import { Section } from '../../../../src/components/Section';
import { Text } from '../../../../src/components/Text';
import { messageOf } from '../../../../src/features/agents/format';
import {
  FALLBACK_CATEGORY_ICON,
  FILTERS,
  ICON_FOR_CATEGORY,
  matchesFilter,
  matchesQuery,
  shortBlurb,
  type FilterKey,
} from '../../../../src/features/tools/copy';
import { useToolCatalogue, useToolUsage, useUpdateTools } from '../../../../src/features/tools/queries';
import type { ToolCategory, ToolChange, ToolEntry } from '../../../../src/features/tools/types';
import { useRefresh } from '../../../../src/hooks/useRefresh';
import { tap } from '../../../../src/lib/haptics';
import { spacing, typography, useTheme } from '../../../../src/theme';

/**
 * The tool library: the one place a tool is switched off for the whole workspace.
 * A grant (in the agent builder) decides what one agent may reach; this switch decides
 * what exists to be granted. Grant-backed groups come first for that reason.
 */
export default function ToolsScreen() {
  const router = useRouter();
  const { colors, spacing: s } = useTheme();
  const catalogue = useToolCatalogue();
  const usage = useToolUsage();
  const update = useUpdateTools();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const { refreshing, onRefresh } = useRefresh(() => Promise.all([catalogue.refetch(), usage.refetch()]));

  const q = query.trim();
  const searching = q.length > 0 || filter !== 'all';
  const categories = useMemo(() => catalogue.data?.categories ?? [], [catalogue.data]);

  // Search and filter apply across every category. A category with no match disappears.
  const visible = useMemo(
    () =>
      categories
        .map((category) => ({
          category,
          tools: category.tools.filter((t) => matchesQuery(t, q) && matchesFilter(t, filter)),
        }))
        .filter(({ category, tools }) => tools.length > 0 || (!q && filter === 'all' && Boolean(category.note))),
    [categories, q, filter],
  );

  const granted = visible.filter((v) => v.category.grantBacked);
  const alwaysOn = visible.filter((v) => !v.category.grantBacked);

  const isOpen = (key: string) => searching || !collapsed.has(key);
  const toggleOpen = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const applyChanges = (changes: Record<string, ToolChange>) => {
    if (Object.keys(changes).length === 0) return;
    update.mutate(changes);
  };

  const toggleTool = (tool: ToolEntry, enabled: boolean) => {
    tap();
    applyChanges({ [tool.name]: { enabled } });
  };

  const toggleCategory = (category: ToolCategory, enabled: boolean) => {
    const changes: Record<string, ToolChange> = {};
    for (const tool of category.tools) {
      if (tool.locked || tool.unserved || tool.enabled === enabled) continue;
      changes[tool.name] = { enabled };
    }
    applyChanges(changes);
  };

  const changedCount = categories.reduce((n, c) => n + c.tools.filter((t) => t.customized).length, 0);
  const subtitle = catalogue.data
    ? `${catalogue.data.enabledTools} of ${catalogue.data.totalTools} switched on${changedCount > 0 ? ` · ${changedCount} changed from default` : ''}`
    : 'Loading your tool library';

  const renderCategory = (category: ToolCategory, tools: ToolEntry[]) => {
    const Icon = ICON_FOR_CATEGORY[category.icon] ?? FALLBACK_CATEGORY_ICON;
    const switchable = tools.filter((t) => !t.locked && !t.unserved);
    const onCount = tools.filter((t) => t.enabled).length;
    const allOn = switchable.length > 0 && switchable.every((t) => t.enabled);
    const agents = typeof usage.data?.usage?.[category.key] === 'number' ? usage.data?.usage[category.key] : undefined;
    const open = isOpen(category.key);
    const countText =
      tools.length === 0
        ? ''
        : `${onCount === tools.length ? `${tools.length}` : `${onCount}/${tools.length}`}${
            category.grantBacked && agents !== undefined ? ` · ${agents} ${agents === 1 ? 'agent' : 'agents'}` : ''
          }`;

    const rows: ReactElement[] = [
      <ListRow
        key={`cat-${category.key}`}
        title={category.label}
        subtitle={category.unserved ? `Unavailable. ${category.description}` : category.description}
        icon={Icon}
        detail={countText}
        onPress={tools.length > 0 ? () => toggleOpen(category.key) : undefined}
        chevron={tools.length > 0}
      />,
    ];
    if (category.note) {
      rows.push(<ListRow key={`note-${category.key}`} title={category.note} />);
    }
    if (open && tools.length > 0) {
      if (switchable.length > 1) {
        rows.push(
          <ListRow
            key={`all-${category.key}`}
            title={allOn ? 'Turn all off' : 'Turn all on'}
            onPress={() => toggleCategory(category, !allOn)}
            disabled={update.isPending}
            chevron={false}
          />,
        );
      }
      for (const tool of tools) {
        rows.push(
          <ListRow
            key={tool.name}
            title={tool.displayName}
            subtitle={toolSubtitle(tool)}
            detail={
              <Switch
                accessibilityLabel={`${tool.enabled ? 'Turn off' : 'Turn on'} ${tool.displayName}`}
                accessibilityRole="switch"
                value={tool.enabled}
                disabled={update.isPending || tool.locked || tool.unserved}
                onValueChange={(next) => toggleTool(tool, next)}
                trackColor={{ false: colors.border, true: colors.primary }}

              />
            }
            onPress={() => router.push(`/more/tools/${encodeURIComponent(tool.name)}`)}
            chevron={false}
          />,
        );
      }
    }
    return rows;
  };

  let body;
  if (catalogue.isPending) {
    body = <LoadingState text="Loading tools" />;
  } else if (catalogue.isError || !catalogue.data) {
    body = (
      <ErrorState
        title="We couldn't load your tools"
        message={messageOf(catalogue.error, 'The library is code, so nothing is lost. This is a connection problem.')}
        onRetry={() => void catalogue.refetch()}
      />
    );
  } else if (visible.length === 0) {
    body = <EmptyState title="No tool matches that" message="Try a different word, or clear the filter." />;
  } else {
    body = (
      <>
        {granted.length > 0 ? (
          <Section
            title="Granted per agent"
            footer="Off here means off everywhere. Per-agent access is set in each agent."
          >
            {granted.flatMap(({ category, tools }) => renderCategory(category, tools))}
          </Section>
        ) : null}
        {alwaysOn.length > 0 ? (
          <Section title="Always on" footer="No grant needed. Details open on a tap.">
            {alwaysOn.flatMap(({ category, tools }) => renderCategory(category, tools))}
          </Section>
        ) : null}
      </>
    );
  }

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: 'Tools' }} />
      <ScrollView
        contentContainerStyle={{ gap: s.lg, paddingBottom: spacing.xxl }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Text style={[typography.caption, { color: colors.mutedText }]}>{subtitle}</Text>
        <SearchBar value={query} onChangeText={setQuery} placeholder="Search tools by name or what they do" />
        <SegmentedControl
          items={FILTERS.map((f) => ({ key: f.key, label: f.label, count: 0 }))}
          value={filter}
          onChange={setFilter}
        />
        {update.isError ? (
          <ErrorText message={`That change didn't save. Nothing has been switched off. ${messageOf(update.error, 'Try again.')}`} />
        ) : null}
        <View style={{ gap: s.lg }}>{body}</View>
      </ScrollView>
    </Screen>
  );
}

/** One line under a tool's name: what it does, and why it may be unavailable. */
function toolSubtitle(tool: ToolEntry): string {
  const parts: string[] = [];
  if (tool.unserved) parts.push('Not available yet');
  else if (tool.locked) parts.push('Always on');
  parts.push(shortBlurb(tool.description) || tool.displayName);
  return parts.join(' · ');
}

