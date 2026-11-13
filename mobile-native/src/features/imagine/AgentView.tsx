/**
 * Agent: describe the media in your own words. The agent picks the kind, model and
 * settings, then checks with you before anything is spent. Conversations are kept
 * per thread, listed in a sheet where they can be renamed or deleted.
 * Mirrors better-n8n-frontend/src/components/imagine/ImagineChat.tsx and the
 * conversation list in pages/Imagine.tsx.
 */
import { useRef, useState, type ElementRef } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { Markdown } from '../../components/Markdown';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { confirm } from '../../components/confirm';
import { Chips, Note, Notice, TextBox } from '../builder/ui';
import { messageOf } from '../agents/format';
import { success, tap, warning } from '../../lib/haptics';
import { pressedOpacity, radius, spacing, typography, useTheme } from '../../theme';
import { GenerationCard } from './GenerationCard';
import { IntentCard } from './IntentCard';
import {
  useDeleteImagineConversation,
  useImagineChat,
  useImagineConversation,
  useImagineConversations,
  useImagineResume,
  useImagineCapabilities,
  useRenameImagineConversation,
} from './queries';
import type { ImagineConversation, ImagineIntent, ImagineMessage, MediaKind } from './types';

const STARTERS: { kind: MediaKind; text: string }[] = [
  { kind: 'image', text: 'A neon-lit Tokyo street at night, reflections on wet asphalt' },
  { kind: 'image', text: 'Watercolour fox curled asleep in a forest, soft light' },
  { kind: 'video', text: 'A 6-second aerial clip over snowy mountains at golden hour' },
  { kind: 'audio', text: 'Narrate calmly: "Welcome to the future of media."' },
];

export function AgentView() {
  const { colors } = useTheme();
  const list = useImagineConversations();
  const caps = useImagineCapabilities();
  const [conversationId, setConversationId] = useState<number | null>(null);
  const conv = useImagineConversation(conversationId);
  const chat = useImagineChat();
  const resume = useImagineResume();
  const remove = useDeleteImagineConversation();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const scrollRef = useRef<ElementRef<typeof ScrollView>>(null);

  const messages: ImagineMessage[] = conv.data?.messages ?? [];
  const pending = conv.data?.status === 'awaiting_hitl' ? conv.data.pending_intent : null;
  const sending = chat.isPending;

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || sending) return;
    setError(null);
    try {
      const res = await chat.mutateAsync({ message, conversationId: conversationId ?? undefined });
      setDraft('');
      setConversationId(res.conversation_id);
      tap();
    } catch (err) {
      setError(messageOf(err, 'Something went wrong. Try again.'));
    }
  };

  const decide = async (decision: 'approve' | 'edit' | 'cancel', overrides?: Partial<ImagineIntent>) => {
    if (conversationId == null) return;
    setError(null);
    try {
      await resume.mutateAsync({ conversationId, decision, overrides });
      if (decision === 'cancel') warning();
      else success();
    } catch (err) {
      warning();
      setError(messageOf(err, 'Could not answer that. Try again.'));
    }
  };

  const models = pending ? caps.data?.[pending.type] ?? [] : [];
  const empty = messages.length === 0 && !pending;

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.toolbar}>
        <Text numberOfLines={1} style={[typography.label, { color: colors.text, flex: 1 }]}>
          {conv.data?.title || (conversationId == null ? 'New conversation' : 'Untitled')}
        </Text>
        <TextAction label="Chats" onPress={() => setListOpen(true)} />
        <TextAction label="New" onPress={() => { setConversationId(null); setError(null); }} />
      </View>

      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        refreshControl={
          <RefreshControl refreshing={conv.isRefetching} onRefresh={() => void conv.refetch()} tintColor={colors.primary} />
        }
        contentContainerStyle={{ gap: spacing.md, padding: spacing.lg, flexGrow: 1 }}
      >
        {empty ? (
          <View style={{ gap: spacing.lg }}>
            <Text style={[typography.body, { color: colors.mutedText }]}>
              Describe it in your own words. The agent picks the model and settings, then checks with you before spending anything.
            </Text>
            <Chips<string>
              options={STARTERS.map((s) => ({ value: s.text, label: s.text }))}
              value=""
              onChange={(text) => void send(text)}
            />
          </View>
        ) : null}

        {messages.map((m) => (
          <MessageRow key={m.id} message={m} />
        ))}

        {pending ? (
          <IntentCard
            intent={pending}
            models={models}
            disabled={resume.isPending}
            onApprove={() => void decide('approve')}
            onEdit={(overrides) => void decide('edit', overrides)}
            onCancel={() => void decide('cancel')}
          />
        ) : null}

        {sending ? <Note>Thinking…</Note> : null}
        {error ? <Notice text={error} /> : null}
      </ScrollView>

      <View style={[styles.composer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
        <TextBox
          accessibilityLabel="Describe what you want to create"
          multiline
          value={draft}
          onChangeText={setDraft}
          placeholder={pending ? 'Approve, edit or cancel above…' : 'Describe what you want to create…'}
          style={{ flex: 1, minHeight: 44, maxHeight: 120 }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          disabled={!draft.trim() || sending}
          onPress={() => void send(draft)}
          style={({ pressed }) => [
            styles.send,
            { backgroundColor: colors.primary, opacity: !draft.trim() || sending ? 0.4 : pressed ? pressedOpacity : 1 },
          ]}
        >
          <Icon name="arrow-up" size={20} color={colors.primaryText} />
        </Pressable>
      </View>

      <ConversationsSheet
        visible={listOpen}
        conversations={list.data ?? []}
        loading={list.isPending}
        activeId={conversationId}
        onClose={() => setListOpen(false)}
        onOpen={(id) => {
          setConversationId(id);
          setError(null);
          setListOpen(false);
        }}
        onNew={() => {
          setConversationId(null);
          setError(null);
          setListOpen(false);
        }}
        onDeleted={(id) => {
          if (conversationId === id) setConversationId(null);
        }}
        remove={(id) => remove.mutateAsync(id)}
      />
    </View>
  );
}

function TextAction({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.textAction, { opacity: pressed ? pressedOpacity : 1 }]}
    >
      <Text style={[typography.label, { color: colors.primary }]}>{label}</Text>
    </Pressable>
  );
}

function MessageRow({ message: m }: { message: ImagineMessage }) {
  const { colors } = useTheme();
  if (m.role === 'user') {
    return (
      <View style={{ alignItems: 'flex-end' }}>
        <View style={[styles.userBubble, { backgroundColor: colors.infoBg, borderRadius: radius.md }]}>
          <Text style={[typography.body, { color: colors.text }]}>{m.content}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={{ gap: spacing.sm }}>
      {m.content ? <Markdown text={m.content} /> : null}
      {m.generation ? (
        <GenerationCard
          generation={{
            id: m.generation.id,
            type: m.generation.type,
            prompt: m.generation.prompt,
            model: m.generation.model,
            status: m.generation.status,
            output_url: m.generation.output_url,
            error_message: m.generation.error_message,
          }}
        />
      ) : null}
    </View>
  );
}

/** The chats the caller has. Open one, start a new one, rename or delete. */
function ConversationsSheet({ visible, conversations, loading, activeId, onClose, onOpen, onNew, onDeleted, remove }: {
  visible: boolean;
  conversations: ImagineConversation[];
  loading: boolean;
  activeId: number | null;
  onClose: () => void;
  onOpen: (id: number) => void;
  onNew: () => void;
  onDeleted: (id: number) => void;
  remove: (id: number) => Promise<unknown>;
}) {
  const { colors } = useTheme();
  const rename = useRenameImagineConversation();
  const [renaming, setRenaming] = useState<{ id: number; title: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const doDelete = async (c: ImagineConversation) => {
    const ok = await confirm({
      title: 'Delete this conversation?',
      message: 'Its messages and any unfinished request go with it.',
      destructiveLabel: 'Delete',
    });
    if (!ok) return;
    warning();
    setActionError(null);
    try {
      await remove(c.id);
      onDeleted(c.id);
    } catch (err) {
      setActionError(messageOf(err, 'Could not delete that conversation.'));
    }
  };

  const saveRename = async () => {
    if (!renaming) return;
    const title = renaming.title.trim();
    if (!title) return;
    setActionError(null);
    try {
      await rename.mutateAsync({ id: renaming.id, title });
      setRenaming(null);
    } catch (err) {
      setActionError(messageOf(err, 'Could not rename that conversation.'));
    }
  };

  return (
    <Sheet visible={visible} title="Chats" onClose={onClose}>
      <Button title="New conversation" onPress={onNew} />
      {actionError ? <Notice text={actionError} /> : null}
      <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
        {loading ? <Note>Loading your chats…</Note> : null}
        {!loading && conversations.length === 0 ? <Note>No chats yet. Start one.</Note> : null}
        {conversations.map((c) => (
          <View
            key={c.id}
            style={[styles.convRow, { borderColor: c.id === activeId ? colors.primary : colors.border, borderRadius: radius.md }]}
          >
            {renaming?.id === c.id ? (
              <View style={{ flex: 1, gap: spacing.sm }}>
                <TextBox
                  accessibilityLabel="Conversation title"
                  value={renaming.title}
                  onChangeText={(title) => setRenaming({ id: c.id, title })}
                  autoFocus
                />
                <View style={{ flexDirection: 'row', gap: spacing.md }}>
                  <TextAction label="Save" onPress={() => void saveRename()} />
                  <TextAction label="Cancel" onPress={() => setRenaming(null)} />
                </View>
              </View>
            ) : (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${c.title || 'Untitled'}`}
                  onPress={() => onOpen(c.id)}
                  style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}
                >
                  <Text numberOfLines={1} style={[typography.label, { color: colors.text }]}>{c.title || 'Untitled'}</Text>
                  <Text numberOfLines={1} style={[typography.caption, { color: colors.mutedText }]}>
                    {c.last_message ? `${c.last_message.role === 'user' ? 'You: ' : ''}${c.last_message.content.slice(0, 60)}` : 'No messages'}
                  </Text>
                </Pressable>
                <TextAction label="Rename" onPress={() => setRenaming({ id: c.id, title: c.title ?? '' })} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${c.title || 'conversation'}`}
                  onPress={() => void doDelete(c)}
                  style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Icon name="trash-outline" size={18} color={colors.danger} />
                </Pressable>
              </>
            )}
          </View>
        ))}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  textAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.xs },
  userBubble: { maxWidth: '85%', padding: spacing.md },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, padding: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  convRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderWidth: StyleSheet.hairlineWidth, marginBottom: spacing.sm },
});
