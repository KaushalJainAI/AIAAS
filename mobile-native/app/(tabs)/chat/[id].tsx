import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '../../../src/components/Button';
import { EmptyState } from '../../../src/components/EmptyState';
import { ErrorText } from '../../../src/components/ErrorText';
import { Icon } from '../../../src/components/Icon';
import { Screen } from '../../../src/components/Screen';
import { confirm } from '../../../src/components/confirm';
import { useAIModels } from '../../../src/features/account/queries';
import { submitFeedback } from '../../../src/features/runs/api';
import { solutionsApi } from '../../../src/features/team/api';
import { success, tap, warning } from '../../../src/lib/haptics';
import { useTheme } from '../../../src/theme';
import { pickDocuments, pickPhotos, type StagedFile } from '../../../src/features/chat/attachments';
import {
  AttachSheet,
  ModeSheet,
  ModelSheet,
  SessionMenuSheet,
  SessionSettingsSheet,
  type MenuAction,
} from '../../../src/features/chat/ChatSheets';
import { CommandPalette } from '../../../src/features/chat/CommandPalette';
import { Composer } from '../../../src/features/chat/Composer';
import { LiveTurn, MessageBubble, UserBubble } from '../../../src/features/chat/ChatParts';
import { MessageSheet, copyText } from '../../../src/features/chat/MessageSheet';
import {
  chatKeys,
  completeCommandArg,
  confirmCommand,
  createSession,
  deleteMessage,
  deleteSession,
  fetchCommands,
  fetchSession,
  setRunAutonomy,
  updateSession,
  uploadAttachment,
} from '../../../src/features/chat/chatApi';
import {
  buildCommandPayload,
  commandPrefix,
  completableArg,
  findCommand,
  rankCommands,
  splitCommandLine,
  taskAfterPrefix,
} from '../../../src/features/chat/commandLine';
import { isChatMode, nextChatMode, toChatMode, type ChatMode } from '../../../src/features/chat/mode';
import type { ChatMessage, ChatSessionDetail, CommandCandidate, CommandChip, CommandDef } from '../../../src/features/chat/types';
import { hasLiveContent, useChatTurn } from '../../../src/features/chat/useChatTurn';

/** Plain words for the kind of thing a command argument names, for the completion heading. */
const ARG_NOUN: Record<string, string> = {
  agent: 'an agent',
  skill: 'a skill',
  model: 'a model',
  effort: 'an effort level',
  file: 'a file',
  project: 'a project',
  connection: 'a connection',
  mission: 'a mission',
};

function messageOf(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'Something went wrong. Try again.';
}

type Row =
  | { key: string; kind: 'live' }
  | { key: string; kind: 'user'; text: string }
  | { key: string; kind: 'message'; message: ChatMessage };

type Sheet = 'mode' | 'model' | 'attach' | 'menu' | 'settings' | null;

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sessionId = String(id);
  const { colors, spacing: s } = useTheme();
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  /** The command the box is building: its chip (the picked argument) once chosen. */
  const [picked, setPicked] = useState<{ command: CommandDef; chip: CommandChip | null } | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [messageFor, setMessageFor] = useState<ChatMessage | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  /** The command whose confirm card is waiting: its confirm call needs the name. */
  const [cardCommand, setCardCommand] = useState<string | null>(null);

  const session = useQuery({
    queryKey: chatKeys.session(sessionId),
    queryFn: () => fetchSession(sessionId),
  });
  const commands = useQuery({ queryKey: chatKeys.commands, queryFn: fetchCommands, staleTime: 5 * 60_000 });
  const catalogue = useAIModels();
  const mode: ChatMode = toChatMode(session.data?.autonomy);

  const turn = useChatTurn(sessionId, {
    onSteersReturned: (texts) => {
      const text = texts.join('\n');
      setDraft((prev) => (prev.trim() ? `${text}\n${prev}` : text));
      setNotice('The agent finished before reading your message. It is back in the box.');
    },
    onRefused: (error, userText) => {
      setNotice(error.message);
      if (userText) setDraft((prev) => (prev.trim() ? prev : userText));
    },
  });
  const { state } = turn;
  const busy = state.active;
  const text = draft.trim();
  const commandList = commands.data ?? [];

  // --- the palette: commands while a name is typed, arguments once a command is picked ---

  const commandMode = draft.startsWith('/') && !/\s/.test(draft.slice(1)) && picked === null;
  const argArg = picked && !picked.chip ? completableArg(picked.command) : null;
  const argMode = argArg !== null && picked !== null && draft.startsWith(`/${picked.command.name}`);
  const argQuery = argMode && picked ? draft.slice(`/${picked.command.name}`.length).trim() : '';
  const candidates = useQuery({
    queryKey: ['chat', 'complete', picked?.command.name ?? '', argArg?.name ?? '', argQuery],
    queryFn: () => completeCommandArg(picked!.command.name, argArg!.name, argQuery),
    enabled: argMode && argArg !== null,
  });

  const ranked = commandMode ? rankCommands(draft.slice(1), commandList) : [];

  const pickCommand = (def: CommandDef) => {
    setPicked({ command: def, chip: null });
    setDraft(`/${def.name} `);
  };

  const pickCandidate = (c: CommandCandidate) => {
    if (!picked || !argArg) return;
    const chip: CommandChip = { arg: argArg.name, id: c.value, label: c.label };
    setPicked({ command: picked.command, chip });
    setDraft(`/${picked.command.name} ${c.label} `);
  };

  const onChangeDraft = (next: string) => {
    setDraft(next);
    // Editing the chosen command away forgets it: the box is plain text again.
    if (picked && !next.startsWith(commandPrefix(picked.command, picked.chip))) setPicked(null);
  };

  // --- session writes ---

  const patchSession = async (patch: Partial<ChatSessionDetail>) => {
    await updateSession(sessionId, patch);
    queryClient.setQueryData<ChatSessionDetail>(chatKeys.session(sessionId), (old) => (old ? { ...old, ...patch } : old));
    void queryClient.invalidateQueries({ queryKey: chatKeys.sessions });
  };

  const setMode = async (next: ChatMode) => {
    try {
      await patchSession({ autonomy: next });
    } catch (err) {
      setNotice(messageOf(err));
      return;
    }
    // A turn already running takes the change at its next step. Plan cannot switch mid-run.
    if (busy && next !== 'plan') {
      try {
        await setRunAutonomy(sessionId, next);
      } catch {
        // The run finished between the tap and the request: the saved mode applies next turn.
      }
    }
    tap();
  };

  const newChat = useMutation({
    mutationFn: () => createSession('New chat'),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.sessions });
      router.replace({ pathname: '/chat/[id]', params: { id: String(created.id) } });
    },
    onError: (err) => setNotice(messageOf(err)),
  });

  /** A client command runs here, with no model call. */
  const runClient = (def: CommandDef, rest: string) => {
    if (def.name === 'help') {
      setPicked(null);
      setDraft('/');
      return;
    }
    setPicked(null);
    setDraft('');
    switch (def.name) {
      case 'new':
      case 'clear':
        newChat.mutate();
        return;
      case 'mode': {
        const level = rest.trim().toLowerCase();
        void setMode(isChatMode(level) ? level : nextChatMode(mode));
        return;
      }
      case 'model':
      case 'effort':
        setSheet('model');
        return;
      case 'file':
        setSheet('attach');
        return;
      case 'code':
        router.push({ pathname: '/web', params: { path: '/code', title: 'Code' } });
        return;
      case 'approvals':
        router.push('/more/runs' as never);
        return;
      case 'connect':
        router.push('/more/connections' as never);
        return;
      default:
        setNotice(`/${def.name} runs on the web for now.`);
    }
  };

  // --- sending ---

  /** Uploads the staged files one by one; each leaves the chip list once it is in the chat. */
  const uploadStaged = async (): Promise<boolean> => {
    if (staged.length === 0) return true;
    setUploading(true);
    try {
      for (const file of staged) {
        await uploadAttachment(sessionId, file);
        setStaged((prev) => prev.filter((f) => f.key !== file.key));
      }
      void queryClient.invalidateQueries({ queryKey: chatKeys.session(sessionId) });
      return true;
    } catch (err) {
      setNotice(messageOf(err));
      return false;
    } finally {
      setUploading(false);
    }
  };

  const onPrimary = async () => {
    setNotice(null);
    if (busy) {
      if (!text) {
        await turn.stop();
        return;
      }
      // While a turn runs, typed text is a steer: it joins the run at its next step.
      const steerText = text;
      setDraft('');
      setPicked(null);
      try {
        const result = await turn.steer(steerText);
        if (result.dropped > 0) setNotice(`${result.dropped} message(s) were dropped because the queue was full.`);
      } catch {
        setDraft((prev) => (prev.trim() ? `${steerText}\n${prev}` : steerText));
        setNotice('The agent finished before reading your message. It is back in the box.');
      }
      return;
    }

    // A slash command: either picked from the palette, or typed out in full.
    let command: { def: CommandDef; chip: CommandChip | null; rest: string } | null = null;
    const parsed = splitCommandLine(draft);
    if (picked) {
      command = { def: picked.command, chip: picked.chip, rest: taskAfterPrefix(draft, picked.command, picked.chip) };
    } else if (parsed) {
      const def = findCommand(parsed.name, commandList);
      if (!def) {
        setNotice(
          commands.isPending ? 'Commands are still loading. Try again in a moment.' : `No command called '/${parsed.name}'. Try /help.`,
        );
        return;
      }
      command = { def, chip: null, rest: parsed.rest };
    }

    if (command?.def.kind === 'client') {
      runClient(command.def, command.rest);
      return;
    }
    if (!text && staged.length === 0) return;

    // Files first, so the turn that follows can read them.
    if (!(await uploadStaged())) return;
    if (!text) {
      success();
      return;
    }

    const shown = command ? [commandPrefix(command.def, command.chip), command.rest].filter(Boolean).join(' ') : text;
    setDraft('');
    setPicked(null);
    success();
    if (command) {
      setCardCommand(command.def.name);
      void turn.send(shown, { command: buildCommandPayload(command.def, command.chip, command.rest) });
    } else {
      void turn.send(text);
    }
  };

  // --- messages ---

  const messages = session.data?.messages.filter((m) => m.role !== 'system') ?? [];

  /** Takes a message and everything after it out of the cached transcript, as the server did. */
  const dropFrom = (messageId: number) =>
    queryClient.setQueryData<ChatSessionDetail>(chatKeys.session(sessionId), (old) => {
      if (!old) return old;
      const at = old.messages.findIndex((m) => m.id === messageId);
      return at < 0 ? old : { ...old, messages: old.messages.slice(0, at) };
    });

  const removeMessage = (messageId: number) =>
    queryClient.setQueryData<ChatSessionDetail>(chatKeys.session(sessionId), (old) =>
      old ? { ...old, messages: old.messages.filter((m) => m.id !== messageId) } : old,
    );

  const takeBack = async (m: ChatMessage) => {
    try {
      await deleteMessage(sessionId, m.id, true);
      dropFrom(m.id);
      setDraft(m.content);
      tap();
    } catch (err) {
      setNotice(messageOf(err));
    }
  };

  /** Removes an answer and sends its prompt again, as the web's Regenerate does. */
  const regenerate = async (m: ChatMessage) => {
    const at = messages.findIndex((x) => x.id === m.id);
    let j = at - 1;
    while (j >= 0 && messages[j].role !== 'user') j -= 1;
    if (j < 0) {
      setNotice('Could not find the original prompt to rewrite.');
      return;
    }
    const prompt = messages[j];
    try {
      await deleteMessage(sessionId, prompt.id, true);
      dropFrom(prompt.id);
      void turn.send(prompt.content);
    } catch (err) {
      setNotice(messageOf(err));
    }
  };

  const removeOne = async (m: ChatMessage) => {
    try {
      await deleteMessage(sessionId, m.id);
      removeMessage(m.id);
      warning();
    } catch (err) {
      setNotice(messageOf(err));
    }
  };

  const rate = async (m: ChatMessage, rating: 1 | -1, reason?: string) => {
    try {
      await submitFeedback({ target: 'message', id: m.id, rating, ...(reason ? { reason } : {}) });
      tap();
    } catch {
      setNotice('Could not save feedback.');
    }
  };

  const reviewSolution = async (solutionId: number, kind: 'confirmed' | 'failed') => {
    await solutionsApi.review(session.data?.org ?? null, solutionId, kind);
    tap();
  };

  const confirmCard = async (values: Record<string, unknown>) => {
    if (!cardCommand) return;
    try {
      await confirmCommand(cardCommand, {}, values);
      success();
      setCardCommand(null);
    } catch (err) {
      setNotice(messageOf(err));
    }
  };

  // --- chat-level actions ---

  const removeChat = async () => {
    const title = session.data?.title || 'Untitled chat';
    const ok = await confirm({
      title: 'Delete this chat?',
      message: `"${title}" and its messages will be removed. This cannot be undone.`,
      destructiveLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await deleteSession(sessionId);
      queryClient.removeQueries({ queryKey: chatKeys.session(sessionId) });
      void queryClient.invalidateQueries({ queryKey: chatKeys.sessions });
      warning();
      router.back();
    } catch (err) {
      setNotice(messageOf(err));
    }
  };

  const saveSettings = async (patch: Partial<ChatSessionDetail>) => {
    setSavingSettings(true);
    try {
      await patchSession(patch);
      setSheet(null);
      success();
    } catch (err) {
      setNotice(messageOf(err));
    } finally {
      setSavingSettings(false);
    }
  };

  const pickFiles = (run: () => Promise<StagedFile[]>) => {
    run()
      .then((files) => setStaged((prev) => [...prev, ...files.filter((f) => !prev.some((p) => p.key === f.key))]))
      .catch((err) => setNotice(messageOf(err)));
  };

  // --- render ---

  if (session.isPending) {
    return (
      <Screen edges={['left', 'right']}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  if (session.isError || !session.data) {
    return (
      <Screen edges={['left', 'right']}>
        <Stack.Screen options={{ title: 'Chat' }} />
        <View style={styles.center}>
          <ErrorText message={session.error instanceof Error ? session.error.message : 'Could not open this chat.'} />
          <View style={{ marginTop: s.md, alignSelf: 'stretch' }}>
            <Button title="Try again" variant="secondary" onPress={() => void session.refetch()} />
          </View>
        </View>
      </Screen>
    );
  }

  const data = session.data;
  const modelName =
    catalogue.data?.providers.flatMap((p) => p.models).find((m) => m.value === data.llm_model)?.name ?? data.llm_model;
  const primaryLabel = !busy ? 'Send' : text ? 'Steer' : 'Stop';
  const primaryDisabled = (!busy && !text && staged.length === 0) || uploading;

  const argNoun = argArg ? (ARG_NOUN[argArg.kind] ?? 'an option') : '';
  const palette = commandMode ? (
    <CommandPalette
      commands={ranked}
      candidates={null}
      onPickCommand={pickCommand}
      onPickCandidate={() => undefined}
      loading={commands.isPending}
    />
  ) : argMode && argArg ? (
    <CommandPalette
      commands={[]}
      candidates={candidates.data ?? []}
      candidateTitle={`Choose ${argNoun}`}
      onPickCommand={() => undefined}
      onPickCandidate={pickCandidate}
      loading={candidates.isPending}
    />
  ) : null;

  const menuActions: MenuAction[] = [
    { label: 'Rename and settings', icon: 'create-outline', onPress: () => setSheet('settings') },
    { label: 'Model and effort', icon: 'sparkles-outline', onPress: () => setSheet('model') },
    { label: 'Mode', icon: 'options-outline', onPress: () => setSheet('mode') },
    { label: 'Delete chat', icon: 'trash-outline', destructive: true, onPress: () => void removeChat() },
  ];

  // Live rows first (the bottom of an inverted list), then the saved transcript, newest first.
  const rows: Row[] = [];
  if (hasLiveContent(state) || cardCommand !== null) rows.push({ key: 'live', kind: 'live' });
  if (state.pendingUser !== null) rows.push({ key: 'pending', kind: 'user', text: state.pendingUser });
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    rows.push({ key: `m-${messages[i].id}`, kind: 'message', message: messages[i] });
  }

  return (
    <Screen edges={['left', 'right']} style={styles.noPadding}>
      <Stack.Screen
        options={{
          title: data.title || 'Chat',
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Chat menu"
              onPress={() => setSheet('menu')}
              hitSlop={8}
              style={styles.headerButton}
            >
              <Icon name="ellipsis-horizontal" size={22} color={colors.text} />
            </Pressable>
          ),
        }}
      />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <FlatList
          style={styles.flex}
          inverted
          data={rows}
          keyExtractor={(row) => row.key}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: s.lg, gap: s.md }}
          ListEmptyComponent={<EmptyState title="Ask anything" message="Type a message below to begin." />}
          renderItem={({ item }) => {
            switch (item.kind) {
              case 'live':
                return (
                  <LiveTurn
                    state={state}
                    onApprove={(callId) => {
                      success();
                      void turn.approve(callId);
                    }}
                    onReject={(callId) => {
                      warning();
                      void turn.reject(callId);
                    }}
                    onSkip={(callId) => {
                      tap();
                      void turn.reject(callId, 'skipped');
                    }}
                    onAnswer={(callId, value) => {
                      success();
                      void turn.answer(callId, value);
                    }}
                    onDismissBlocked={turn.dismissBlocked}
                    onReviewSolution={reviewSolution}
                    onConfirmCommand={(values) => void confirmCard(values)}
                    onCancelCommand={() => setCardCommand(null)}
                  />
                );
              case 'user':
                return <UserBubble text={item.text} />;
              case 'message':
                return <MessageBubble message={item.message} onLongPress={setMessageFor} onReviewSolution={reviewSolution} />;
            }
          }}
        />

        <Composer
          draft={draft}
          onChangeDraft={onChangeDraft}
          placeholder={busy ? 'Steer the agent…' : 'Ask anything...'}
          busy={busy}
          primaryLabel={primaryLabel}
          primaryDisabled={primaryDisabled}
          onPrimary={() => void onPrimary()}
          onAttach={() => setSheet('attach')}
          staged={staged}
          onRemoveStaged={(key) => setStaged((prev) => prev.filter((f) => f.key !== key))}
          uploading={uploading}
          palette={palette}
          mode={mode}
          onOpenMode={() => setSheet('mode')}
          modelLabel={modelName || 'Model'}
          onOpenModel={() => setSheet('model')}
          notice={notice}
        />
      </KeyboardAvoidingView>

      <ModeSheet visible={sheet === 'mode'} value={mode} onPick={(m) => void setMode(m)} onClose={() => setSheet(null)} />
      <ModelSheet
        visible={sheet === 'model'}
        provider={data.llm_provider ?? ''}
        model={data.llm_model}
        effort={data.llm_effort ?? ''}
        onPickModel={(p, m) => {
          void patchSession({ llm_provider: p, llm_model: m }).catch((err) => setNotice(messageOf(err)));
        }}
        onPickEffort={(level) => {
          void patchSession({ llm_effort: level }).catch((err) => setNotice(messageOf(err)));
        }}
        onClose={() => setSheet(null)}
      />
      <AttachSheet
        visible={sheet === 'attach'}
        onDocuments={() => pickFiles(pickDocuments)}
        onPhotos={() => pickFiles(pickPhotos)}
        onClose={() => setSheet(null)}
      />
      <SessionMenuSheet visible={sheet === 'menu'} actions={menuActions} onClose={() => setSheet(null)} />
      <SessionSettingsSheet
        visible={sheet === 'settings'}
        session={data}
        saving={savingSettings}
        onSave={(patch) => void saveSettings(patch)}
        onClose={() => setSheet(null)}
      />
      <MessageSheet
        message={messageFor}
        onClose={() => setMessageFor(null)}
        onCopy={(m) => {
          copyText(m.content);
          tap();
        }}
        onRegenerate={(m) => void regenerate(m)}
        onTakeBack={(m) => void takeBack(m)}
        onDelete={(m) => void removeOne(m)}
        onFeedback={(m, rating, reason) => void rate(m, rating, reason)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  noPadding: { padding: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  headerButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
