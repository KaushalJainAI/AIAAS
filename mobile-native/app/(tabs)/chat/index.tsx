import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '../../../src/components/Button';
import { EmptyState } from '../../../src/components/EmptyState';
import { ErrorText } from '../../../src/components/ErrorText';
import { ListRow } from '../../../src/components/ListRow';
import { Screen } from '../../../src/components/Screen';
import { SearchBar } from '../../../src/components/SearchBar';
import { Sheet } from '../../../src/components/Sheet';
import { Text } from '../../../src/components/Text';
import { confirm } from '../../../src/components/confirm';
import { fontFamily } from '../../../src/fonts';
import {
  chatKeys,
  createSession,
  deleteSession,
  fetchSessionsPage,
  updateSession,
} from '../../../src/features/chat/chatApi';
import { relativeTime } from '../../../src/features/chat/format';
import type { ChatSessionSummary } from '../../../src/features/chat/types';
import { success, tap, warning } from '../../../src/lib/haptics';
import { radius, spacing, typography, useTheme } from '../../../src/theme';

function messageOf(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'Please try again.';
}

export default function ChatListScreen() {
  const { colors, spacing: s, radius: r } = useTheme();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [actionFor, setActionFor] = useState<ChatSessionSummary | null>(null);
  const [renaming, setRenaming] = useState<ChatSessionSummary | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  const list = useInfiniteQuery({
    queryKey: chatKeys.sessions,
    queryFn: ({ pageParam }) => fetchSessionsPage(pageParam),
    initialPageParam: 1,
    // `all` holds the pages so far, so the next page number is its length plus one.
    getNextPageParam: (last, all) => (last.hasNext ? all.length + 1 : undefined),
  });
  const items = useMemo(() => list.data?.pages.flatMap((page) => page.items) ?? [], [list.data]);
  const needle = query.trim().toLowerCase();
  const shown = needle ? items.filter((c) => (c.title || 'Untitled chat').toLowerCase().includes(needle)) : items;

  const create = useMutation({
    mutationFn: () => createSession('New chat'),
    onSuccess: (session) => {
      success();
      void queryClient.invalidateQueries({ queryKey: chatKeys.sessions });
      router.push({ pathname: '/chat/[id]', params: { id: String(session.id) } });
    },
    onError: (err) => setError(messageOf(err)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteSession(id),
    onSuccess: () => {
      warning();
      void queryClient.invalidateQueries({ queryKey: chatKeys.sessions });
    },
    onError: (err) => setError(messageOf(err)),
  });

  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => updateSession(id, { title }),
    onSuccess: () => {
      success();
      setRenaming(null);
      void queryClient.invalidateQueries({ queryKey: chatKeys.sessions });
    },
    onError: (err) => setError(messageOf(err)),
  });

  const confirmDelete = async (session: ChatSessionSummary) => {
    const ok = await confirm({
      title: 'Delete this chat?',
      message: `"${session.title || 'Untitled chat'}" and its messages will be removed. This cannot be undone.`,
      destructiveLabel: 'Delete',
    });
    if (ok) remove.mutate(String(session.id));
  };

  const openRename = (session: ChatSessionSummary) => {
    setActionFor(null);
    setDraftTitle(session.title || '');
    setRenaming(session);
  };

  return (
    <Screen edges={['left', 'right']}>
      <View style={{ gap: s.md, marginBottom: s.md }}>
        <Button
          title="New chat"
          onPress={() => {
            tap();
            create.mutate();
          }}
          loading={create.isPending}
        />
        <SearchBar value={query} onChangeText={setQuery} placeholder="Search chats" />
      </View>

      {error ? <ErrorText message={error} /> : null}

      {list.isError && items.length === 0 ? (
        <View style={styles.center}>
          <ErrorText message={messageOf(list.error)} />
          <View style={{ marginTop: s.md, alignSelf: 'stretch' }}>
            <Button title="Try again" variant="secondary" onPress={() => void list.refetch()} />
          </View>
        </View>
      ) : list.isPending ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(session) => String(session.id)}
          contentContainerStyle={shown.length === 0 ? styles.flexGrow : { gap: s.sm, paddingBottom: s.xl }}
          refreshControl={
            <RefreshControl
              refreshing={list.isRefetching && !list.isFetchingNextPage}
              onRefresh={() => void list.refetch()}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          onEndReached={() => {
            if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
          }}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            needle ? (
              <EmptyState title="No chats match" message="Try another word." />
            ) : (
              <EmptyState title="No chats yet" message="Start one with New chat." />
            )
          }
          ListFooterComponent={
            list.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={{ margin: s.md }} /> : undefined
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityHint="Opens the chat. Long press for more."
              onPress={() => router.push({ pathname: '/chat/[id]', params: { id: String(item.id) } })}
              onLongPress={() => setActionFor(item)}
              delayLongPress={400}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: r.md, padding: s.md, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Text numberOfLines={1} style={[typography.label, { color: colors.text }]}>
                {item.title || 'Untitled chat'}
              </Text>
              <SessionMeta session={item} />
            </Pressable>
          )}
        />
      )}

      <Sheet visible={actionFor !== null} onClose={() => setActionFor(null)} title={actionFor?.title || 'Untitled chat'}>
        <View style={{ paddingBottom: s.md }}>
          <ListRow title="Rename" icon="create-outline" onPress={() => actionFor && openRename(actionFor)} />
          <ListRow
            title="Delete chat"
            icon="trash-outline"
            destructive
            onPress={() => {
              const target = actionFor;
              setActionFor(null);
              if (target) void confirmDelete(target);
            }}
          />
        </View>
      </Sheet>

      <Sheet visible={renaming !== null} onClose={() => setRenaming(null)} title="Rename chat">
        <View style={{ gap: s.md, paddingBottom: s.md }}>
          <TextInput
            value={draftTitle}
            onChangeText={setDraftTitle}
            autoFocus
            maxLength={200}
            accessibilityLabel="Chat title"
            style={[
              styles.input,
              { color: colors.text, backgroundColor: colors.inputBackground, borderColor: colors.border, borderRadius: radius.md, fontFamily: fontFamily.regular },
            ]}
          />
          <Button
            title="Save"
            loading={rename.isPending}
            onPress={() => {
              const title = draftTitle.trim();
              if (!renaming || !title) return;
              rename.mutate({ id: String(renaming.id), title });
            }}
          />
        </View>
      </Sheet>
    </Screen>
  );
}

/** "Waiting for your answer" or "Working…" when a run needs the person, otherwise the age. */
function SessionMeta({ session }: { session: ChatSessionSummary }) {
  const { colors } = useTheme();
  const waiting = session.run_state === 'waiting';
  const working = session.run_state === 'running';
  const label = waiting ? 'Waiting for your answer' : working ? 'Working…' : null;
  const age = relativeTime(session.updated_at);
  return (
    <Text
      numberOfLines={1}
      style={[typography.caption, { color: waiting ? colors.primary : colors.mutedText, marginTop: spacing.xs }]}
    >
      {[label, age].filter(Boolean).join(' · ')}
    </Text>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  flexGrow: { flexGrow: 1 },
  row: { borderWidth: StyleSheet.hairlineWidth },
  input: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, minHeight: 44 },
});
