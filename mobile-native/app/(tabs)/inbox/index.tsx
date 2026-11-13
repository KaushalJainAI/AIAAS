import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from 'react-native';

import { EmptyState } from '../../../src/components/EmptyState';
import { Text } from '../../../src/components/Text';
import { ErrorText } from '../../../src/components/ErrorText';
import { Screen } from '../../../src/components/Screen';
import { NotificationRow } from '../../../src/features/inbox/NotificationRow';
import { RequestRow } from '../../../src/features/inbox/RequestRow';
import { SegmentedControl } from '../../../src/features/inbox/SegmentedControl';
import { messageOf } from '../../../src/features/inbox/request';
import {
  useInboxPolling,
  useMarkAllRead,
  useMarkRead,
  useNotifications,
  usePendingRequests,
} from '../../../src/features/inbox/queries';
import { targetFor, type NotificationTarget } from '../../../src/features/inbox/target';
import { tap } from '../../../src/lib/haptics';
import { useTheme } from '../../../src/theme';

/** Opens a notification's target: a native route, or the embedded web app for the rest. */
function openTarget(target: NotificationTarget) {
  if (target.kind === 'web') {
    router.push({ pathname: '/web', params: { path: target.path, title: target.title } });
    return;
  }
  if (target.params) {
    router.push({ pathname: target.pathname as never, params: target.params });
    return;
  }
  router.push(target.pathname as never);
}

type Segment = 'waiting' | 'notifications';

export default function InboxScreen() {
  const { colors, spacing, fontSize } = useTheme();
  const [segment, setSegment] = useState<Segment>('waiting');

  // Poll the pending queue every 30 s, but only while this screen is focused.
  const polling = useInboxPolling();
  const pending = usePendingRequests(polling);
  const notifications = useNotifications();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();

  const requests = pending.data ?? [];
  const notes = notifications.data ?? [];
  const unread = notes.filter((n) => !n.is_read).length;

  const showMarkAll = segment === 'notifications' && unread > 0;

  return (
    <Screen edges={['left', 'right']}>
      <Stack.Screen
        options={{
          headerRight: showMarkAll
            ? () => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Mark all notifications as read"
                  disabled={markAll.isPending}
                  onPress={() => markAll.mutate()}
                  hitSlop={8}
                >
                  <Text style={{ color: colors.primary, fontSize: fontSize.md, fontWeight: '600' }}>Mark all read</Text>
                </Pressable>
              )
            : undefined,
        }}
      />

      <SegmentedControl<Segment>
        value={segment}
        onChange={setSegment}
        items={[
          { key: 'waiting', label: 'Waiting on you', count: requests.length },
          { key: 'notifications', label: 'Notifications', count: unread },
        ]}
      />

      {segment === 'waiting' ? (
        <FlatList
          data={requests}
          keyExtractor={(item) => item.request_id}
          contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl, flexGrow: 1 }}
          renderItem={({ item }) => (
            <RequestRow request={item} onPress={() => router.push(`/inbox/${item.request_id}`)} />
          )}
          refreshControl={
            <RefreshControl
              refreshing={pending.isRefetching}
              onRefresh={() => void pending.refetch()}
              tintColor={colors.primary}
            />
          }
          ListHeaderComponent={pending.isError ? <ErrorText message={messageOf(pending.error)} /> : undefined}
          ListEmptyComponent={
            pending.isPending ? (
              <View style={{ paddingVertical: spacing.xxl }}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : (
              <View style={{ paddingVertical: spacing.xxl }}>
                <EmptyState
                  title="Nothing waiting on you"
                  message="When an agent needs an approval or an answer, it shows up here."
                />
              </View>
            )
          }
        />
      ) : (
        <FlatList
          data={notes}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl, flexGrow: 1 }}
          renderItem={({ item }) => (
            <NotificationRow
              notification={item}
              onPress={() => {
                // Marks read, then opens the matching screen when the link names one we have.
                tap();
                if (!item.is_read) markRead.mutate(item.id);
                const target = targetFor(item.data?.action_url);
                if (target) openTarget(target);
              }}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={notifications.isRefetching}
              onRefresh={() => void notifications.refetch()}
              tintColor={colors.primary}
            />
          }
          ListHeaderComponent={notifications.isError ? <ErrorText message={messageOf(notifications.error)} /> : undefined}
          ListEmptyComponent={
            notifications.isPending ? (
              <View style={{ paddingVertical: spacing.xxl }}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : (
              <View style={{ paddingVertical: spacing.xxl }}>
                <EmptyState title="No notifications" message="Reminders and finished runs appear here." />
              </View>
            )
          }
        />
      )}
    </Screen>
  );
}
