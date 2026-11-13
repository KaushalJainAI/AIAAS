import { useState, type ReactNode } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { ActionSheet, type SheetAction } from '../files/ActionSheet';
import { confirm } from '../../components/confirm';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { ListRow } from '../../components/ListRow';
import { LoadingState } from '../../components/LoadingState';
import { Screen } from '../../components/Screen';
import { Section } from '../../components/Section';
import { Text } from '../../components/Text';
import { success, warning } from '../../lib/haptics';
import { fontSize, spacing, useTheme } from '../../theme';
import { useRefresh } from '../../hooks/useRefresh';
import { errorMessage, plural } from '../files/helpers';
import { NoticeBar, useNotice } from '../files/notice';
import { webHref } from '../files/web';
import { ionIconFor } from '../files/icons';
import { useDashboards, useDeleteAnyDashboard, useRefreshAnyDashboard } from './queries';
import type { Dashboard } from './types';

/** Live dashboards: refreshed here without a model call. Opening one goes to the web app's Dashboards page. Mirrors `pages/Dashboards.tsx`. */
export function DashboardsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const dashboards = useDashboards();
  const refresh = useRefreshAnyDashboard();
  const remove = useDeleteAnyDashboard();
  const { notice, show, dismiss } = useNotice();
  const [picked, setPicked] = useState<Dashboard | null>(null);
  const { refreshing, onRefresh } = useRefresh(dashboards.refetch);
  const rows = dashboards.data?.results ?? [];

  const doRefresh = async (dashboard: Dashboard) => {
    try {
      await refresh.mutateAsync(dashboard.id);
      success();
      show('Dashboard refreshed.');
    } catch (err) {
      show(errorMessage(err, 'Could not refresh that dashboard.'), 'danger');
    }
  };

  const askDelete = async (dashboard: Dashboard) => {
    const ok = await confirm({
      title: 'Delete this dashboard?',
      message: `“${dashboard.title}” will be deleted. This cannot be undone.`,
      destructiveLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(dashboard.id);
      warning();
      show('Dashboard deleted.');
    } catch (err) {
      show(errorMessage(err, 'Could not delete that dashboard.'), 'danger');
    }
  };

  const actionsFor = (dashboard: Dashboard): SheetAction[] => [
    {
      key: 'open',
      label: 'Open',
      icon: 'open-outline',
      onPress: () => {
        setPicked(null);
        router.push(webHref('/dashboards', dashboard.title));
      },
    },
    {
      key: 'refresh',
      label: 'Refresh',
      icon: 'refresh-outline',
      onPress: () => {
        setPicked(null);
        void doRefresh(dashboard);
      },
    },
    {
      key: 'delete',
      label: 'Delete',
      icon: 'trash-outline',
      destructive: true,
      onPress: () => {
        setPicked(null);
        void askDelete(dashboard);
      },
    },
  ];

  let body: ReactNode;
  if (dashboards.isPending) body = <LoadingState text="Loading…" />;
  else if (dashboards.isError)
    body = <ErrorState message="Dashboards could not be loaded." onRetry={() => void dashboards.refetch()} />;
  else if (rows.length === 0)
    body = (
      <EmptyState
        title="Nothing here yet"
        message={'Ask in chat — "track MRR and churn on a dashboard" — and it will appear here.'}
      />
    );
  else
    body = (
      <Section>
        {rows.map((dashboard) => (
          <ListRow
            key={dashboard.id}
            title={dashboard.title}
            subtitle={plural(dashboard.spec.tiles.length, 'tile')}
            icon={ionIconFor('layout-dashboard')}
            chevron={false}
            onPress={() => setPicked(dashboard)}
          />
        ))}
      </Section>
    );

  return (
    <Screen edges={['left', 'right']}>
      <Stack.Screen options={{ title: 'Dashboards' }} />
      <Text style={{ color: colors.mutedText, fontSize: fontSize.md, marginBottom: spacing.md }}>
        Live tiles — ask in chat to build one, refresh it here
      </Text>
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
