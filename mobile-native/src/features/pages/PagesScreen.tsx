import { useState, type ReactNode } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Stack, useRouter } from 'expo-router';

import { API_ORIGIN } from '../../config';
import { ActionSheet, type SheetAction } from '../files/ActionSheet';
import { confirm } from '../../components/confirm';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { ListRow } from '../../components/ListRow';
import { LoadingState } from '../../components/LoadingState';
import { Screen } from '../../components/Screen';
import { Section } from '../../components/Section';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Text } from '../../components/Text';
import { success, warning } from '../../lib/haptics';
import { spacing, fontSize, useTheme } from '../../theme';
import { useRefresh } from '../../hooks/useRefresh';
import { errorMessage } from '../files/helpers';
import { NoticeBar, useNotice } from '../files/notice';
import { webHref } from '../files/web';
import { pageUrl } from '../files/share';
import { ionIconFor } from '../files/icons';
import { usePages, useWithdrawAnyPage } from './queries';
import type { PageVisibility, PublishedPage } from './types';

type Scope = 'mine' | 'platform';

/** The web's wording for who can open a page. */
export const VISIBILITY_LABEL: Record<PageVisibility, string> = {
  link: 'Anyone with the link',
  platform: 'Everyone on the platform',
  public: 'Public',
};

/** Pages you published, and the ones listed on the platform. Withdrawing unlists; nothing is deleted. Mirrors `pages/Pages.tsx`. */
export function PagesScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const [scope, setScope] = useState<Scope>('mine');
  const pages = usePages(scope === 'platform' ? 'platform' : undefined);
  const withdraw = useWithdrawAnyPage();
  const { notice, show, dismiss } = useNotice();
  const [picked, setPicked] = useState<PublishedPage | null>(null);
  const { refreshing, onRefresh } = useRefresh(pages.refetch);
  const rows = pages.data?.results ?? [];

  const open = (page: PublishedPage) => router.push(webHref(`/p/${encodeURIComponent(page.slug)}`, page.title));

  const copy = async (page: PublishedPage) => {
    try {
      await Clipboard.setStringAsync(pageUrl(page.slug, API_ORIGIN));
      success();
      show('Link copied');
    } catch {
      show('Could not copy the link.', 'danger');
    }
  };

  const askWithdraw = async (page: PublishedPage) => {
    const ok = await confirm({
      title: 'Withdraw this page?',
      message: 'Its link will stop opening. Nothing is deleted.',
      destructiveLabel: 'Withdraw',
    });
    if (!ok) return;
    try {
      await withdraw.mutateAsync(page.slug);
      warning();
      show('Page withdrawn — its link no longer opens.');
    } catch (err) {
      show(errorMessage(err, 'Could not withdraw that page.'), 'danger');
    }
  };

  const actionsFor = (page: PublishedPage): SheetAction[] => {
    const actions: SheetAction[] = [
      { key: 'open', label: 'Open', icon: 'open-outline', onPress: () => { setPicked(null); open(page); } },
      { key: 'copy', label: 'Copy link', icon: 'link-outline', onPress: () => { setPicked(null); void copy(page); } },
    ];
    if (page.is_mine && page.is_listed) {
      actions.push({
        key: 'withdraw',
        label: 'Withdraw',
        icon: 'trash-outline',
        destructive: true,
        onPress: () => {
          setPicked(null);
          void askWithdraw(page);
        },
      });
    }
    return actions;
  };

  let body: ReactNode;
  if (pages.isPending) body = <LoadingState text="Loading…" />;
  else if (pages.isError)
    body = <ErrorState message="Pages could not be loaded." onRetry={() => void pages.refetch()} />;
  else if (rows.length === 0)
    body = (
      <EmptyState
        title={scope === 'mine' ? 'Nothing published yet' : 'Nobody has listed a page yet'}
        message={
          scope === 'mine'
            ? 'Ask in chat — "publish this report as a page" — and it will appear here.'
            : 'Nobody has listed a page on the platform yet.'
        }
      />
    );
  else
    body = (
      <Section>
        {rows.map((page) => (
          <ListRow
            key={page.slug}
            title={page.title}
            subtitle={`${page.is_listed === false ? 'Withdrawn' : VISIBILITY_LABEL[page.visibility ?? 'platform']} · ${page.kind} · ${new Date(page.updated_at).toLocaleDateString()}`}
            icon={ionIconFor('scroll-text')}
            chevron={false}
            onPress={() => setPicked(page)}
          />
        ))}
      </Section>
    );

  return (
    <Screen edges={['left', 'right']}>
      <Stack.Screen options={{ title: 'Pages' }} />
      <Text style={{ color: colors.mutedText, fontSize: fontSize.md, marginBottom: spacing.md }}>
        Reports, pages and files you published, shareable by link
      </Text>
      <SegmentedControl<Scope>
        items={[
          { key: 'mine', label: 'Yours', count: 0 },
          { key: 'platform', label: 'On the platform', count: 0 },
        ]}
        value={scope}
        onChange={setScope}
      />
      <NoticeBar notice={notice} onDismiss={dismiss} />
      <ScrollView
        contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xxl, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <View>{body}</View>
      </ScrollView>
      {picked ? <ActionSheet title={picked.title} actions={actionsFor(picked)} onClose={() => setPicked(null)} /> : null}
    </Screen>
  );
}
