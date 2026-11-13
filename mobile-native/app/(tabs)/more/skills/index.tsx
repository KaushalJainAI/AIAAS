import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { Button } from '../../../../src/components/Button';
import { EmptyState } from '../../../../src/components/EmptyState';
import { ErrorState } from '../../../../src/components/ErrorState';
import { ListRow } from '../../../../src/components/ListRow';
import { LoadingState } from '../../../../src/components/LoadingState';
import { Screen } from '../../../../src/components/Screen';
import { SearchBar } from '../../../../src/components/SearchBar';
import { SegmentedControl } from '../../../../src/components/SegmentedControl';
import { Section } from '../../../../src/components/Section';
import { Text } from '../../../../src/components/Text';
import { messageOf } from '../../../../src/features/agents/format';
import { SKILL_PAGE_SIZE, TABS, usageLabel } from '../../../../src/features/skills/copy';
import type { Skill, SkillTab } from '../../../../src/features/skills/types';
import { useSkillSearch } from '../../../../src/features/skills/queries';
import { useRefresh } from '../../../../src/hooks/useRefresh';
import { spacing, typography, useTheme } from '../../../../src/theme';

/** Your own skills, or the library of shared ones. The other tab's count is read in one tiny request. */
export default function SkillsScreen() {
  const router = useRouter();
  const { colors, spacing: s } = useTheme();
  const [tab, setTab] = useState<SkillTab>('mine');
  const [query, setQuery] = useState('');
  const search = query.trim();

  const skills = useSkillSearch(search, tab, SKILL_PAGE_SIZE);
  const otherTab: SkillTab = tab === 'mine' ? 'public' : 'mine';
  // Browse mode (no query) for the count: a count must not cost an embedding search.
  const other = useSkillSearch('', otherTab, 1);

  const { refreshing, onRefresh } = useRefresh(() => skills.refetch());

  const items: Skill[] = skills.data?.results ?? [];
  const mine = tab === 'mine';
  const countOf = (t: SkillTab) => (t === tab ? skills.data?.total : other.data?.total);
  const tabItems = TABS.map((t) => ({ key: t.key, label: t.label, count: countOf(t.key) ?? 0 }));

  const open = (skill: Skill) => router.push(`/more/skills/${skill.id}?tab=${tab}`);
  const create = () => router.push('/more/skills/new');

  let body;
  if (skills.isPending && items.length === 0) {
    body = <LoadingState text="Loading skills" />;
  } else if (skills.isError) {
    body = <ErrorState message={messageOf(skills.error, "We couldn't load skills.")} onRetry={() => void skills.refetch()} />;
  } else if (items.length === 0) {
    if (search) {
      body = <EmptyState title="No skill matches that" message="Try a different word." />;
    } else if (mine) {
      body = (
        <EmptyState
          title="No skills yet"
          message="A skill is a page of instructions (a checklist, a house style, a procedure) that any agent can be given."
        />
      );
    } else {
      body = <EmptyState title="Nothing shared yet" message="Skills other people share appear here." />;
    }
  } else {
    body = (
      <Section>
        {items.map((skill) => (
          <ListRow
            key={skill.id}
            title={skill.title || 'Untitled skill'}
            subtitle={
              [
                skill.description || 'No description.',
                mine ? usageLabel(skill.used_by) : `By ${skill.author}`,
              ]
                .filter(Boolean)
                .join(' · ')
            }
            detail={skill.category}
            icon={skill.isShared && mine ? 'people-outline' : 'sparkles-outline'}
            onPress={() => open(skill)}
          />
        ))}
      </Section>
    );
  }

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: 'Skills' }} />
      <ScrollView
        contentContainerStyle={{ gap: s.lg, paddingBottom: spacing.xxl }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Text style={[typography.body, { color: colors.mutedText }]}>Reusable instructions you can attach to any agent.</Text>
        <Button title="New skill" onPress={create} />
        <SegmentedControl items={tabItems} value={tab} onChange={setTab} />
        <SearchBar
          value={query}
          onChangeText={setQuery}
          placeholder={mine ? 'Search your skills' : 'Search shared skills'}
        />
        <View>{body}</View>
      </ScrollView>
    </Screen>
  );
}
