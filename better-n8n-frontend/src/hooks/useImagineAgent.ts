import { useCallback, useEffect, useState } from 'react';
import { useSocket } from '../lib/websocket';
import { usePersistedState } from './usePersistedState';
import { imagineAgent, type ImagineChatResponse, type ImagineConversation, type ImagineGeneration, type ImagineIntent, type ImagineMessage } from '../api/imagineAgent';
import { useImagineOptional } from '../contexts/imagineState';
import { apiErrorMessage } from '../lib/apiError';

export interface ChatItem {
  key: string;
  role: 'user' | 'assistant';
  content: string;
  intent?: ImagineIntent;
  requiresHitl?: boolean;
  generation?: ImagineGeneration | null;
  pending?: boolean;
}

interface State {
  conversationId: number | null;
  items: ChatItem[];
  pendingIntent: ImagineIntent | null;
  isSending: boolean;
}

/**
 * The terminal generation frame the Imagine socket sends. Only the four fields
 * this hook folds into a chat item are declared — the frame carries more, but
 * naming what is read is the point of typing it at all.
 */
interface GenerationEvent {
  generation_id?: number;
  /** Constrained to the same union the item holds — typing this as `string`
   *  let a frame with no status write `undefined` over a live one. */
  status?: ImagineGeneration['status'];
  output_url?: string | null;
  error?: string | null;
}

export function useImagineAgent() {
  const [persistedConvId, setPersistedConvId] = usePersistedState<number | null>('imagine.agentConversationId', null);
  const globalImagine = useImagineOptional();
  const [state, setState] = useState<State>({
    conversationId: persistedConvId,
    items: [],
    pendingIntent: null,
    isSending: false,
  });
  // Multi-conversation list — independent contexts, like chat sessions.
  // Each conversation's history is isolated (agent/graph.py reads only its 20
  // messages), so a new thread prevents prompt pollution and keeps token cost
  // linear in the current thread, not in the lifetime total.
  const [conversations, setConversations] = useState<ImagineConversation[]>([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);

  // Keep persisted id in sync when conversation changes via response
  useEffect(() => {
    if (state.conversationId !== persistedConvId) {
      setPersistedConvId(state.conversationId);
    }
  }, [state.conversationId, persistedConvId, setPersistedConvId]);

  // Hydrate messages when the hook mounts and we have a persisted conversationId but no items yet.
  // This survives page changes: the generation process is detached server-side, and this reloads
  // the conversation transcript including any pending/completed bubbles.
  useEffect(() => {
    if (persistedConvId && state.items.length === 0 && state.conversationId === persistedConvId) {
      imagineAgent
        .getConversation(persistedConvId)
        .then((conv) => {
          const items: ChatItem[] = (conv.messages || []).map((m: ImagineMessage) => ({
            key: `m-${m.id}`,
            role: m.role === 'system' ? 'assistant' : m.role,
            content: m.content,
            intent: m.intent ?? undefined,
            requiresHitl: m.requires_hitl,
            generation: m.generation,
            pending: m.generation?.status === 'pending' || m.generation?.status === 'processing',
          }));
          setState((s) => ({
            ...s,
            items,
            pendingIntent: conv.status === 'awaiting_hitl' ? conv.pending_intent : null,
          }));
        })
        .catch(() => {
          // Stale id (deleted on server) — forget it
          setPersistedConvId(null);
        });
    }
  }, [persistedConvId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Folds a terminal generation event into whichever chat item owns it. */
  const applyGenerationEvent = useCallback((data: GenerationEvent) => {
    setState(s => ({
      ...s,
      items: s.items.map(it =>
        it.generation && it.generation.id === data.generation_id
          ? {
              ...it,
              generation: {
                ...it.generation,
                // Absent means "unchanged": a frame that omits the field must
                // not blank out the status the item already has.
                status: data.status ?? it.generation.status,
                output_url: data.output_url ?? it.generation.output_url,
                error_message: data.error ?? it.generation.error_message,
              },
              pending: false,
            }
          : it
      ),
    }));
  }, []);

  const handleMessage = useCallback((msg: { type?: string; data?: GenerationEvent }) => {
    if (msg.type === 'generation.completed' || msg.type === 'generation.failed') {
      applyGenerationEvent(msg.data || {});
    }
  }, [applyGenerationEvent]);

  // If a global ImagineProvider is mounted (Layout), it already holds the WS.
  // Keeping a second socket here would duplicate events and toasts. Only open
  // a local socket when no global provider exists (e.g., in isolated tests).
  const shouldOwnSocket = !globalImagine;
  const { isConnected: localConnected } = useSocket({
    path: '/imagine-agent/',
    enabled: shouldOwnSocket,
    onMessage: handleMessage,
  });
  const isConnected = globalImagine ? true : localConnected;

  // When a global generation completes, fold it into the local chat item that
  // owns it. This keeps the bubble's loader turning into the image/video even
  // when the user was off the Imagine page — otherwise they'd return to a
  // permanently-spinning card.
  //
  // There used to be a second effect above this one whose entire body was an
  // early return and a comment saying "No-op". It did nothing, on every change
  // of `activeCount`, and its only lasting effect was a lint warning. The
  // refetch below is the one that actually does the folding.
  useEffect(() => {
    if (!state.items.some((it) => it.pending)) return;
    // If global says no active jobs anymore, re-pull the conversation to get completed URLs.
    const hasPending = state.items.some((it) => it.pending);
    if (hasPending && globalImagine && globalImagine.activeCount === 0) {
      const cid = state.conversationId;
      if (!cid) return;
      imagineAgent
        .getConversation(cid)
        .then((conv) => {
          const pendingStill = conv.messages?.some((m) => m.generation?.status === 'pending');
          if (!pendingStill) {
            const items: ChatItem[] = (conv.messages || []).map((m: ImagineMessage) => ({
              key: `m-${m.id}`,
              role: m.role === 'system' ? 'assistant' : m.role,
              content: m.content,
              intent: m.intent ?? undefined,
              requiresHitl: m.requires_hitl,
              generation: m.generation,
              pending: m.generation?.status === 'pending' || m.generation?.status === 'processing',
            }));
            setState((s) => ({ ...s, items }));
          }
        })
        .catch(() => {});
    }
  }, [globalImagine, state.items, state.conversationId]);

  const _applyResponse = useCallback((res: ImagineChatResponse, userMsg?: string) => {
    setState(s => {
      const next: ChatItem[] = [...s.items];
      if (userMsg) {
        next.push({ key: `u-${Date.now()}-${Math.random()}`, role: 'user', content: userMsg });
      }
      next.push({
        key: `a-${res.message_id}`,
        role: 'assistant',
        content: res.assistant_message,
        intent: res.intent_preview,
        requiresHitl: res.requires_hitl,
        generation: res.generation,
        pending: res.generation?.status === 'pending',
      });
      return {
        ...s,
        conversationId: res.conversation_id,
        items: next,
        pendingIntent: res.requires_hitl ? (res.intent_preview ?? null) : null,
        isSending: false,
      };
    });
  }, []);

  const sendMessage = useCallback(async (message: string, model?: string | null) => {
    setState(s => ({ ...s, isSending: true }));
    try {
      const res = await imagineAgent.chat(message, state.conversationId ?? undefined, model);
      _applyResponse(res, message);
    } catch (e: unknown) {
      setState(s => ({
        ...s,
        isSending: false,
        items: [
          ...s.items,
          { key: `u-${Date.now()}`, role: 'user', content: message },
          { key: `e-${Date.now()}`, role: 'assistant', content: `Error: ${apiErrorMessage(e, 'Something went wrong.')}` },
        ],
      }));
    }
  }, [state.conversationId, _applyResponse]);

  const resume = useCallback(async (decision: 'approve' | 'edit' | 'cancel', overrides?: Partial<ImagineIntent>) => {
    if (!state.conversationId) return;
    setState(s => ({ ...s, isSending: true }));
    try {
      const res = await imagineAgent.resume(state.conversationId, decision, overrides);
      _applyResponse(res);
    } catch (e: unknown) {
      // Clearing isSending without a word left a resume that failed looking
      // identical to one that succeeded and returned nothing.
      console.error('Imagine agent resume failed', e);
      setState(s => ({ ...s, isSending: false }));
    }
  }, [state.conversationId, _applyResponse]);

  const loadConversation = useCallback(async (id: number) => {
    const conv = await imagineAgent.getConversation(id);
    const items: ChatItem[] = (conv.messages || []).map((m: ImagineMessage) => ({
      key: `m-${m.id}`,
      role: m.role === 'system' ? 'assistant' : m.role,
      content: m.content,
      intent: m.intent ?? undefined,
      requiresHitl: m.requires_hitl,
      generation: m.generation,
      pending: m.generation?.status === 'pending',
    }));
    setState(s => ({
      ...s,
      conversationId: conv.id,
      items,
      pendingIntent: conv.status === 'awaiting_hitl' ? conv.pending_intent : null,
    }));
  }, []);

  const reset = useCallback(() => {
    setPersistedConvId(null);
    setState(s => ({ ...s, conversationId: null, items: [], pendingIntent: null }));
  }, [setPersistedConvId]);

  // ---- Multi-conversation helpers (like chatService) ----
  const refreshConversations = useCallback(async () => {
    setIsLoadingConversations(true);
    try {
      const list = await imagineAgent.listConversations();
      setConversations(list as ImagineConversation[]);
    } catch {
      // keep existing list — list failure should not blank the sidebar
    } finally {
      setIsLoadingConversations(false);
    }
  }, []);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  // Keep list in sync when the active conversation changes (new thread or switch)
  useEffect(() => {
    if (state.conversationId) void refreshConversations();
  }, [state.conversationId, refreshConversations]);

  const newConversation = useCallback(() => {
    reset();
  }, [reset]);

  const switchConversation = useCallback(
    async (id: number) => {
      // Optimistic: clear pending, then load
      setState((s) => ({ ...s, isSending: false }));
      await loadConversation(id);
      setPersistedConvId(id);
    },
    [loadConversation, setPersistedConvId]
  );

  const deleteConversation = useCallback(
    async (id: number) => {
      await imagineAgent.deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (state.conversationId === id) {
        reset();
      }
    },
    [state.conversationId, reset]
  );

  return {
    ...state,
    isConnected,
    conversations,
    isLoadingConversations,
    refreshConversations,
    newConversation,
    switchConversation,
    deleteConversation,
    sendMessage,
    resume,
    loadConversation,
    reset,
  };
}
