import { useState, useRef, useEffect, useCallback, useDeferredValue, useMemo } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  RUN_STATUS_EVENT,
  abortChatRun,
  getChatRun,
  startChatRun,
  subscribeChatRun,
  useRunningChatKeys,
  type RunFrame,
  type RunMeta,
} from '../../lib/chatRuns';
import { usePersistedState } from '../../hooks/usePersistedState';
import { clearChatDraft, useChatDraft } from '../../hooks/useChatDraft';
import ThinkingTimer from './ThinkingTimer';
import { 
  Loader2,
  X,
  Search,
  Image as ImageIcon,
  Video,
  File as FileIcon,
  Mic,
  Shield,
  ChevronDown,
  BrainCircuit,
  Settings2,
  Lightbulb,
  Zap,
  Wand2,
  Globe2,
  Code,
  Mail,
  FolderSearch,
  LifeBuoy,
  FileText,
  Slash,
  Bot,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { chatService, type StandaloneChatMessage as ChatMessage, type ChatSession } from '../../api';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import { TextSelectionMenu } from './TextSelectionMenu';
import { MediaPreview } from './MediaPreview';
import HtmlArtifact from './HtmlArtifact';
import ChartArtifact from './ChartArtifact';
import PlanDock from '../plan/PlanDock';
import { actionsFrom, historyFrom } from '../../lib/planView';
import PlanPanel from '../orchestration/PlanPanel';
import FileCards from '../files/FileCards';
import FilePreviewProvider from '../files/FilePreviewProvider';
import MarkdownMessage from './MarkdownMessage';
import TranscriptSkeleton from './TranscriptSkeleton';
import { forgetTranscript, readTranscript, writeTranscript } from '../../lib/transcriptCache';
import type { ChatSessionSummary } from '../../api/chat';

import { useAIModels } from '../../hooks/useAIModels';
import { useChatStream, type StreamEvent } from '../../hooks/useChatStream';
import { usePlanStream } from '../../hooks/usePlanStream';
import { planProgress } from '../../lib/planStream';
import { useMessagePanels } from '../../hooks/useMessagePanels';
import { useMessageSelection } from '../../hooks/useMessageSelection';
import { useChatModelSelection } from '../../hooks/useChatModelSelection';
import { useEffortSelection, EFFORT_LABELS } from '../../hooks/useEffortSelection';
import { EffortPicker } from './EffortPicker';
import { prettyModel } from '../../lib/modelNames';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../contexts/authState';
import GuestBanner from './GuestBanner';
import ChatHistorySidebar from './ChatHistorySidebar';
import ChatHeader from './ChatHeader';
import ChatMessageItem from './ChatMessageItem';
import ChatSettingsDialog from './ChatSettingsDialog';
import ToolApprovalCard from './ToolApprovalCard';
import QuestionCard from './QuestionCard';
import type { QuestionAnswer } from '../../lib/question';
import { SendButton } from '../ui/SendButton';
import { apiErrorMessage } from '../../lib/apiError';
import { nextChatMode, toChatMode } from '../../lib/chatMode';
import CommandPalette from './CommandPalette';
import CommandCard from './CommandCard';
import { useCommands } from '../../hooks/useCommands';
import commandsService from '../../api/commands';
import {
  buildCommandPayload,
  findCommand,
  prefillCommandInput,
  splitCommandLine,
  type CommandChip as CommandChipData,
  type CommandDef,
} from '../../lib/commands';

/**
 * What the composer is set to do with the next message. Named because it is the
 * state's type, a cast target, and a parameter — three places that were
 * previously three different spellings, two of them `any`.
 */
export type ChatIntent = 'normal' | 'search' | 'image' | 'video' | 'research';

/**
 * A tool-argument field as text. `StreamActivity.args` is `Record<string,
 * unknown>` because the wire carries no schema for it, so anything rendered
 * out of it has to be narrowed rather than trusted.
 */
const argText = (value: unknown): string => (typeof value === 'string' ? value : '');

export default function StandaloneChat() {
  const { isAuthenticated } = useAuth();
  const isGuest = !isAuthenticated;
  const location = useLocation();
  const navigate = useNavigate();
  /** The sidebar "New chat" CTA lands here with this flag, from any page
      including this one — an explicit fresh start, not a restore. */
  const newChatRequested =
    (location.state as { newChat?: boolean } | null)?.newChat === true;
  
  // Helper to strip XML/HTML tags from tool call argument values
  const stripXmlTags = (val: unknown): string => {
    if (typeof val !== 'string') return String(val ?? '');
    return val.replace(/<\/?[a-zA-Z_][a-zA-Z0-9_:.-]*[^>]*>/g, '').trim();
  };
  
  const [params, setParams] = useSearchParams();

  // --- Chat State ---
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // `isLoading` means *the agent is working on a turn*, and nothing else. It
  // drives the live block, so fetching a transcript must never set it — doing
  // that is what made arriving on the page claim the model was thinking.
  const [isLoading, setIsLoading] = useState(false);
  //: Steers waiting for the running turn to reach its next tool boundary, and
  //: any the mailbox had to drop. Both are reported by the steer endpoint.
  const [queuedSteers, setQueuedSteers] = useState(0);
  const [droppedSteers, setDroppedSteers] = useState(0);
  // Fetching an existing transcript. Distinct from `isLoading` above.
  const [isRestoring, setIsRestoring] = useState(false);
  // The answer that just finished streaming. It is already on screen, so it
  // mounts without the entrance animation every other message gets.
  const [settledId, setSettledId] = useState<number | string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  // Auth and guest conversations are independent: a guest reusing an auth
  // session id (or vice versa) hits a 404 because the lookup is user-scoped,
  // and a DB wipe leaves any persisted id stale. Two keys keep the namespaces
  // separate so a stale or cross-owner id is never sent to the wrong endpoint.
  const [authConversationId, setAuthConversationId] = usePersistedState<string | undefined>(
    'chat.lastSessionId',
    undefined,
  );
  const [guestConversationId, setGuestConversationId] = usePersistedState<string | undefined>(
    'chat.lastGuestSessionId',
    undefined,
  );
  const conversationId = isGuest ? guestConversationId : authConversationId;
  const setConversationId = isGuest ? setGuestConversationId : setAuthConversationId;
  // The composer's unsent text, kept per conversation: typing half a message,
  // switching threads and coming back restores each box where it was left.
  const [input, setInput] = useChatDraft(conversationId, isGuest);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** Session ids whose turn is still streaming, including backgrounded ones. */
  const runningKeys = useRunningChatKeys();

  // --- Slash commands (P10, §18) ---
  // The palette opens on a leading `/`; chips carry resolved ids so the
  // request never re-resolves a name already chosen. Client-kind commands
  // run in the browser, action-kind through `/commands/run/`, turn-kind as
  // a normal streamed turn with `command` attached.
  const { commands, refetch: refetchCommands } = useCommands({ enabled: !isGuest });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pickedCommand, setPickedCommand] = useState<CommandDef | null>(null);
  const [commandChips, setCommandChips] = useState<CommandChipData[]>([]);
  const [commandArgText, setCommandArgText] = useState('');
  const [commandError, setCommandError] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  void refetchCommands;

  const queryClient = useQueryClient();
  const { data: conversations = [], refetch: loadHistory } = useQuery({
    queryKey: ['chatSessions'],
    queryFn: async () => {
      try {
        const res = await chatService.getSessions();
        return res || [];
      } catch (e) {
        console.error("Failed to load history", e);
        return [];
      }
    },
    staleTime: 5 * 60 * 1000,
    enabled: !isGuest,
  });

  // --- Model Selection State ---
  // Default to NVIDIA Nemotron 3 Super so the chat works out-of-the-box using
  // the server-side NVIDIA_API_KEY (no per-user credential required).
  const { providers: dynamicProviders, meta: catalogueMeta } = useAIModels();

  const {
    provider: llmProvider,
    model: llmModel,
    setProvider: setLlmProvider,
    isDropdownOpen: showModelDropdown,
    setDropdownOpen: setShowModelDropdown,
    searchQuery: modelSearchQuery,
    setSearchQuery: setModelSearchQuery,
    dropdownRef,
    select: selectModel,
    adopt: adoptSessionModel,
  } = useChatModelSelection({ isGuest, providers: dynamicProviders, fallbackModel: catalogueMeta?.fallback?.model });

  // Which rungs are on offer depends on the model chosen just above, so this
  // reads that selection rather than owning it. See `useEffortSelection` for
  // why a stale level is dropped rather than sent.
  const {
    effective: llmEffort,
    effortToSend,
    available: effortLevels,
    supported: effortSupported,
    choose: chooseEffort,
    adopt: adoptSessionEffort,
  } = useEffortSelection({
    providers: dynamicProviders, provider: llmProvider, model: llmModel, isGuest,
  });

  // --- Agentic Features State ---
  const [isFollowUpsExpanded, setIsFollowUpsExpanded] = useState(true);
  const [activeIntent, setActiveIntent] = useState<ChatIntent>('normal');
  const [deletingMsgId, setDeletingMsgId] = useState<number | null>(null);
  const { toggle: togglePanel, isOpen: isPanelOpen, openIdFor: openPanelId } = useMessagePanels();
  
  // Text Selection State
  const {
    anchor: selectionPos,
    reference: activeReference,
    syncFromDocument: syncSelection,
    dismiss: dismissSelection,
    copySelection,
    referenceSelection,
    clearReference,
  } = useMessageSelection();



  // --- File Upload State ---
  const [isUploading, setIsUploading] = useState(false);

  // --- Live Streaming State (Perplexity-like) ---
  const {
    live,
    applyEvent: applyStreamEvent,
    reset: resetStream,
    clearStatus: clearStreamStatus,
    clearPendingToolCall,
    clearPendingQuestion,
    dismissBlockedAttachments,
  } = useChatStream();

  // The coding team's lanes, locks and changes — beside the turn's own
  // state, not inside it, so worker heartbeats never re-render the
  // transcript. Fed from the same frames (`task_update` / `lease_update` /
  // `code_change`), which the lead's workers publish to the lead's sink.
  const {
    plan,
    applyPlanEvent,
    resetPlan,
  } = usePlanStream();

  // What the plan dock shows: the running turn's plan while there is one,
  // otherwise the most recent reply's — so the current plan has one place.
  const dockPlan = useMemo(() => {
    if (isLoading && live.todoHistory.length > 0) {
      return { history: live.todoHistory, actions: actionsFrom(live.activity), live: true };
    }
    const last = [...messages].reverse().find(
      m => m.role === 'assistant' && Array.isArray(m.metadata?.todos) && m.metadata.todos.length > 0);
    return {
      history: last ? historyFrom(last.metadata?.todo_history, last.metadata?.todos) : [],
      actions: last ? actionsFrom(last.metadata?.tool_trace) : [],
      live: false,
    };
  }, [isLoading, live.todoHistory, live.activity, messages]);

  // Bound as consts so a `&&` guard narrows them inside event handlers too,
  // which a `live.x` property read does not.
  const { pendingToolCall, pendingQuestion, blockedAttachments } = live;
  // The answer being streamed re-parses its whole markdown on every update.
  // Deferred, so that work yields to typing in the composer rather than
  // making the box lag behind the keys while an answer is arriving.
  const streamedContent = useDeferredValue(live.content);

  const [showSessionSettings, setShowSessionSettings] = useState(false);
  const [systemPromptDraft, setSystemPromptDraft] = useState('');
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isReasoningExpanded, setIsReasoningExpanded] = useState(false);
  const [isLiveCodeExpanded, setIsLiveCodeExpanded] = useState(true);
  const [isLiveSourcesExpanded, setIsLiveSourcesExpanded] = useState(true);
  const [isLiveMediaExpanded, setIsLiveMediaExpanded] = useState(true);

  // --- Effects ---
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle auto-expanding textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  // The thinking clock lives in <ThinkingTimer/>, which owns its own interval.
  // Ticking it here re-rendered the whole transcript ten times a second.






  /** Paints a fetched or cached session. The two must land identically. */
  const applySession = (session: ChatSession) => {
    setMessages(session.messages as unknown as ChatMessage[]);
    setConversationId(session.id);
    setCurrentSession(session);
    adoptSessionModel(session.llm_provider, session.llm_model);
    adoptSessionEffort(session.llm_effort ?? '');
  };

  /**
   * Opens a conversation, cache first.
   *
   * The transcript is fetched imperatively rather than through react-query, so
   * a cache hit has to be read by hand: in-memory for a return trip within the
   * session, localStorage for a reload. Either way the conversation is on
   * screen before the request goes out, and the response reconciles behind it.
   * A miss falls through to the skeleton, never to the thinking indicator —
   * this is a GET, and saying otherwise reports work nobody is doing.
   */
  const loadConversation = async (id: string) => {
    const cached =
      queryClient.getQueryData<ChatSession>(['chatSession', id]) ?? readTranscript(id);
    if (cached?.messages) applySession(cached);

    setIsRestoring(true);
    try {
      const session = await chatService.getSession(id);
      if (session && session.messages) {
        applySession(session);
        queryClient.setQueryData(['chatSession', id], session);
      }
    } catch (e) {
      console.error("Failed to load conversation", e);
    } finally {
      setIsRestoring(false);
      // A turn still running for this conversation owns the loading state:
      // the transcript arriving does not mean the answer is in. Clearing it
      // unconditionally here would drop the pending state of a turn adopted
      // moments earlier, whichever of the two happened to settle last.
      setIsLoading(getChatRun(id)?.status === 'running');
    }
  };

  /**
   * A notification's "Open" lands here as `?session=<id>` (the chat approval
   * writer links the waiting thread). Adopt it instead of the persisted one,
   * and publish the open thread back into the URL so any conversation is
   * linkable. Guests keep their fresh session: ids are user-scoped, so a
   * linked auth id adopted into guest state would 404.
   */
  useEffect(() => {
    if (isGuest || newChatRequested) return;
    const s = params.get('session');
    if (s && s !== conversationId) loadConversation(s);
    // Runs on param change only; `loadConversation` paints through `applySession`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);
  useEffect(() => {
    if (isGuest) return;
    const s = params.get('session');
    if (conversationId ? s === conversationId : !s) return;
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (conversationId) next.set('session', conversationId);
        else next.delete('session');
        return next;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  /**
   * Re-attach to turns the server is still running.
   *
   * A turn now outlives the request that started it, so a reload mid-answer
   * leaves work in flight that this page knows nothing about. Adopting every
   * active run replays the partial answer into the open conversation and
   * lights up the "still working" marker for the others.
   */
  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;

    (async () => {
      try {
        const active = await chatService.getActiveRuns();
        if (cancelled) return;
        for (const id of active) {
          if (getChatRun(id)?.status === 'running') continue; // already ours
          startChatRun(
            id,
            (onEvent, signal) => chatService.attachStream(id, onEvent, signal),
          );
        }
      } catch {
        // Re-attaching is recovery, not a precondition for chatting.
      }
    })();

    return () => { cancelled = true; };
  }, [isGuest]);

  useEffect(() => {
    if (showHistory) loadHistory();
  }, [showHistory, loadHistory]);

  // Reopen where the user left off, and only there. A first login (or any
  // arrival with no persisted session) stays on a fresh Ask hero with the
  // composer front and centre — auto-opening the newest thread made a new
  // user land mid-way through an old conversation instead of a new chat.
  // The transcript is refetched, so a turn that finished in the background
  // is present on arrival.
  useEffect(() => {
    // An explicit "New chat" starts empty: restoring would repaint the
    // previous transcript underneath it. The effect by
    // `startNewConversation` below clears the ids; this just skips the fetch.
    if (newChatRequested) return;
    if (isGuest) return; // Guests start with a fresh session each visit
    // A linked `?session=` is adopted by the effect above — restoring the
    // persisted thread here as well would repaint over it, last-write-wins.
    if (params.get('session')) return;
    if (conversationId) {
      loadConversation(conversationId);
    }
    // Mount only, deliberately. This restores the session the user left open;
    // re-running it when `conversationId` changes would re-load the transcript
    // every time they switch conversations, fighting the explicit
    // `loadConversation` calls that do the switching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Keeps the reload cache current.
   *
   * Writing it only on load would cache the transcript as it was on arrival and
   * leave every answer since out of it — the reload after a long conversation,
   * which is exactly when the head start is worth most, would paint the
   * staleest possible version. Guests are skipped: their thread does not
   * outlive the tab, so there is nothing to restore it into.
   */
  useEffect(() => {
    if (isGuest || !conversationId || !currentSession || messages.length === 0) return;
    writeTranscript({
      ...currentSession,
      id: conversationId,
      // Same widening the read side does: `StandaloneChatMessage` carries the
      // metadata this page renders, `ChatSession.messages` is the narrower API
      // shape, and the cache round-trips whichever it was handed.
      messages: messages as unknown as ChatSession['messages'],
    });
  }, [isGuest, conversationId, currentSession, messages]);

  const saveLLMSettings = async (provider: string, model: string) => {
    selectModel(provider, model);

    if (conversationId) {
      try {
        await chatService.updateSession(conversationId, { llm_provider: provider, llm_model: model });
      } catch (err) {
         console.error('Failed to update session settings', err);
      }
    }
    
    toast.success(`Chat engine switched to ${model}`);
  };

  /**
   * Persist an effort choice the same way a model choice is persisted.
   *
   * Separate from `saveLLMSettings` rather than folded into it because the two
   * are chosen independently: switching model must not silently reset the
   * effort, and changing effort must not re-announce the model with a toast.
   */
  const saveEffort = async (next: string) => {
    chooseEffort(next);

    if (conversationId) {
      try {
        await chatService.updateSession(conversationId, { llm_effort: next });
      } catch (err) {
        console.error('Failed to update reasoning effort', err);
      }
    }
  };

  const processFile = async (file: File) => {
    if (!conversationId) {
      // Need a session first
      try {
        const newSession = await chatService.createSession({
          title: `File Upload: ${file.name}`,
          llm_provider: llmProvider,
          llm_model: llmModel,
          system_prompt: ""
        });
        setConversationId(newSession.id);
        uploadFileToSession(newSession.id, file);
      } catch (err) {
        console.error('Failed to create session for upload', err);
        toast.error("Failed to create session for upload");
      }
    } else {
      uploadFileToSession(conversationId, file);
    }
  };

  const handleDeleteMessage = async (msgId: number) => {
    if (!conversationId) return;
    
    // Safety: If it's a timestamp ID (> 10^12), it hasn't been synced yet
    // but in most cases our new SSE sync will handle this.
    // If it's STILL optimistic, we just remove it locally.
    if (msgId > 1000000000000) {
      setMessages(prev => prev.filter(m => m.id !== msgId));
      return;
    }

    setDeletingMsgId(msgId);
    try {
      await chatService.deleteMessage(conversationId, msgId);
      setMessages(prev => prev.filter(m => m.id !== msgId));
      toast.success("Message deleted");
    } catch (err) {
      console.error('Failed to delete message', err);
      toast.error("Failed to delete message");
    } finally {
      setDeletingMsgId(null);
    }
  };

  /**
   * Clears the view back to an empty conversation.
   *
   * The live stream state has to go with it. A run belongs to a conversation,
   * not to this component, so a turn still streaming in the old thread keeps
   * pushing frames after the switch — without this reset its status line
   * ("Reasoning (step 4)...") and partial answer stay painted over the new,
   * empty chat. The subscription effect cannot do it: with no conversation
   * open there is nothing for it to attach to and it returns early.
   */
  const startNewConversation = useCallback(() => {
    setMessages([]);
    setConversationId(undefined);
    setCurrentSession(null);
    setActiveIntent('normal');
    setIsLoading(false);
    setIsRestoring(false);
    setSettledId(null);
    resetStream();
    resetPlan();
    // `setConversationId` comes from `usePersistedState`, which returns a plain
    // `useState` setter — stable, but the linter cannot see that through the
    // custom hook's tuple, so it is listed rather than suppressed.
  }, [resetStream, resetPlan, setConversationId]);

  /**
   * Consumes the sidebar "New chat" flag. Works both when arriving from
   * another page (mounts fresh, and the restore effect above already stood
   * down) and when already here (same path, new location state). The flag
   * is replaced away so a reload does not wipe the chat the user then starts.
   */
  useEffect(() => {
    if (!newChatRequested) return;
    startNewConversation();
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [newChatRequested, startNewConversation, navigate, location.pathname, location.search]);

  const handleDeleteConversation = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this conversation?')) return;

    try {
      await chatService.deleteSession(id);
      queryClient.setQueryData<ChatSessionSummary[]>(['chatSessions'], (old = []) => old.filter(c => c.id !== id));
      // Both caches too, or the deleted thread paints again on the next reload.
      queryClient.removeQueries({ queryKey: ['chatSession', id] });
      forgetTranscript(id);
      // Its unsent draft goes with it, or the text haunts the next thread.
      clearChatDraft(id, isGuest);
      if (conversationId === id) {
        startNewConversation();
      }
      toast.success("Conversation deleted");
    } catch (err) {
      console.error("Failed to delete conversation", err);
      toast.error("Failed to delete conversation");
    }
  };

  const uploadFileToSession = async (sessionId: string, file: File) => {
    setIsUploading(true);
    try {
      const response = await chatService.uploadFile(sessionId, file);
      toast.success(response.status || "File uploaded successfully");
      // Refresh messages to show the system message about the upload
      const sessionDetails = await chatService.getSession(sessionId);
      if (sessionDetails?.messages) {
        setMessages(sessionDetails.messages as unknown as ChatMessage[]);
      }
    } catch (err: unknown) {
      toast.error(apiErrorMessage(err, 'Failed to upload file'));
    } finally {
      setIsUploading(false);
    }
  };

  const handleRewriteMessage = async (messageId: number) => {
    if (!conversationId) return;
    try {
      setDeletingMsgId(messageId);
      
      const targetIndex = messages.findIndex(m => m.id === messageId);
      if (targetIndex === -1) return;

      let precedingUserMsgIndex = targetIndex - 1;
      while (precedingUserMsgIndex >= 0 && messages[precedingUserMsgIndex].role !== 'user') {
        precedingUserMsgIndex--;
      }

      if (precedingUserMsgIndex === -1 || !messages[precedingUserMsgIndex].id) {
        toast.error('Could not find the original prompt to rewrite');
        return;
      }

      const userMsg = messages[precedingUserMsgIndex];

      await chatService.deleteMessage(conversationId, userMsg.id as number, true);
      
      setMessages(messages.slice(0, precedingUserMsgIndex));
      
      handleSend(userMsg.content);
      toast.success('Regenerating response...');
    } catch (err) {
      console.error('Failed to rewrite message', err);
      toast.error('Failed to rewrite message');
    } finally {
      setDeletingMsgId(null);
    }
  };

  const handleRewindAfterMessage = async (messageId: number) => {
    if (!conversationId) return;
    
    // Safety: If it's a timestamp ID, we can't rewind in the backend yet.
    // We just handle it locally.
    if (messageId > 1000000000000) {
      const targetIndex = messages.findIndex(m => m.id === messageId);
      if (targetIndex !== -1) {
        const targetMessage = messages[targetIndex];
        setMessages(messages.slice(0, targetIndex + 1));
        setInput(targetMessage.content);
        setTimeout(() => textareaRef.current?.focus(), 50);
      }
      return;
    }

    try {
      setDeletingMsgId(messageId);
      await chatService.deleteMessage(conversationId, messageId, false, true);
      
      const targetIndex = messages.findIndex(m => m.id === messageId);
      if (targetIndex !== -1) {
        const targetMessage = messages[targetIndex];
        setMessages(messages.slice(0, targetIndex + 1));
        setInput(targetMessage.content);
        setTimeout(() => {
          textareaRef.current?.focus();
        }, 50);
      }
      toast.success('Message ready to edit');
    } catch (err) {
      console.error('Failed to reverse context', err);
      toast.error('Failed to reverse context');
    } finally {
      setDeletingMsgId(null);
    }
  };

  const handleEditMessage = async (messageId: number, content: string) => {
    if (!conversationId) return;
    try {
      setDeletingMsgId(messageId);
      await chatService.deleteMessage(conversationId, messageId, true);
      
      const targetIndex = messages.findIndex(m => m.id === messageId);
      if (targetIndex !== -1) {
        setMessages(messages.slice(0, targetIndex));
      }
      setInput(content);
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
      toast.success('Message ready to edit');
    } catch (err) {
      console.error('Failed to prepare message for editing', err);
      toast.error('Failed to prepare message for editing');
    } finally {
      setDeletingMsgId(null);
    }
  };

  // Determine if this session has a default intent (but don't lock it)
  const lockedIntent = currentSession?.intent;
  const isLocked = false; // "no lock thing" - removing lock functionality as requested

  useEffect(() => {
    if (lockedIntent && !['chat', 'search', 'normal'].includes(lockedIntent) && !conversationId) {
       setActiveIntent(lockedIntent as ChatIntent);
    }
  }, [lockedIntent, conversationId]);

  const toggleIntent = (intent: ChatIntent) => {
    setActiveIntent(prev => {
      const next = prev === intent ? 'normal' : intent;
      
      // Recommendation for media generation
      if (['image', 'video', 'audio'].includes(next)) {
        toast.info("Recommended to use a new thread for media generation to avoid context pollution.", {
          duration: 5000
        });
      }
      
      return next;
    });
    textareaRef.current?.focus();
  };

  /**
   * How much this conversation asks before acting: Ask (approve side
   * effects) · Auto (the reviewer may allow clear matches) · Plan (look,
   * don't touch). Stored on the session, so it survives reloads; switching
   * mid-turn rides the steer mailbox and stands for the rest of the run.
   * Auto looks visibly different so nobody is in it without knowing.
   */
  type ChatMode = 'ask' | 'auto' | 'plan';
  const [autonomy, setAutonomy] = useState<ChatMode>('ask');

  useEffect(() => {
    setAutonomy(toChatMode(currentSession?.autonomy));
  }, [currentSession?.autonomy, conversationId]);

  const setMode = async (next: ChatMode) => {
    setAutonomy(next);
    if (conversationId) {
      try {
        const updated = await chatService.updateSession(conversationId, { autonomy: next });
        setCurrentSession(prev => (prev ? { ...prev, ...updated } : updated));
      } catch (err) {
        console.error('Failed to update chat mode', err);
      }
      if (isLoading) {
        // A turn is going: the session value applies next turn, so also
        // switch this one mid-run. Plan cannot switch mid-run (the toolbox
        // is already built) — the session value still applies next turn.
        try {
          if (next !== 'plan') await chatService.setAutonomy(conversationId, next);
        } catch (err) {
          console.error('Failed to switch mode mid-run', err);
        }
      }
    }
    textareaRef.current?.focus();
  };

  const cycleMode = () => {
    void setMode(nextChatMode(autonomy));
  };

  /**
   * `scope` says how long the allowance lasts, and the middle rung is the
   * point of having three. An approval a user clicks through without reading
   * launders consent rather than granting it, so the way to keep the remaining
   * prompts meaningful is to stop re-asking the ones already answered — but
   * someone who only wants to stop being asked for the rest of *this*
   * conversation should not have to grant a standing allowance over their own
   * mailbox to get there. The backend has taken `once | session | always`
   * since approvals were reworked; this screen was still sending a boolean.
   */
  const handleApproveTool = async (
    callId: string, scope: 'once' | 'session' | 'always' = 'once',
  ) => {
    if (!conversationId || !pendingToolCall) return;

    clearPendingToolCall();
    setIsLoading(true);

    // Same background-run treatment as a normal send: approving a tool starts
    // another streamed turn, and it must survive leaving the page too.
    startChatRun(
      conversationId,
      (onEvent, signal) =>
        chatService.sendMessageStream(
          conversationId,
          "Approve",
          activeIntent,
          onEvent,
          undefined,
          signal,
          llmProvider,
          llmModel,
          callId,
          scope === 'always',
          effortToSend,
          { approvalScope: scope },
        ),
      { intent: activeIntent },
    );
  };

  /**
   * Declining has to reach the server, which it did not.
   *
   * The button called `clearPendingToolCall()` and stopped: the card went
   * away, the graph stayed parked on its `interrupt()`, and the model was
   * never told it had been refused. `reject_tool_call` has existed since agent
   * runs got the same asymmetry fixed — chat simply never called it.
   *
   * It resumes the turn like an approval does, because that is what a refusal
   * is for: the model is told what it may not do and carries on with what it
   * can. So it goes through `startChatRun` too, or a denial on a tab that gets
   * closed leaves the turn dangling.
   */
  const handleDenyTool = async (callId: string) => {
    if (!conversationId || !pendingToolCall) return;

    clearPendingToolCall();
    setIsLoading(true);

    startChatRun(
      conversationId,
      (onEvent, signal) =>
        chatService.sendMessageStream(
          conversationId,
          "Deny",
          activeIntent,
          onEvent,
          undefined,
          signal,
          llmProvider,
          llmModel,
          undefined,
          undefined,
          effortToSend,
          { rejectToolCall: callId },
        ),
      { intent: activeIntent },
    );
  };

  /**
   * Answer the question the run paused on. The answer resumes the same turn —
   * like an approval, it carries no new message — and comes back to the model
   * as the result of its `ask_user` call. The server checks it against the
   * question actually asked, so a stale card fails as an error, not a turn.
   */
  const handleAnswerQuestion = (answer: QuestionAnswer) => {
    const callId = pendingQuestion?.call_id;
    if (!conversationId || !callId) return;
    clearPendingQuestion();
    setIsLoading(true);
    startChatRun(
      conversationId,
      (onEvent, signal) =>
        chatService.sendMessageStream(
          conversationId, 'Answer', activeIntent, onEvent, undefined, signal,
          llmProvider, llmModel, undefined, undefined, effortToSend,
          { answerToolCall: callId, answer },
        ),
      { intent: activeIntent },
    );
  };

  /** Skipping is a refusal of the question: the run proceeds on its assumption. */
  const handleSkipQuestion = () => {
    const callId = pendingQuestion?.call_id;
    if (!conversationId || !callId) return;
    clearPendingQuestion();
    setIsLoading(true);
    startChatRun(
      conversationId,
      (onEvent, signal) =>
        chatService.sendMessageStream(
          conversationId, 'Skip', activeIntent, onEvent, undefined, signal,
          llmProvider, llmModel, undefined, undefined, effortToSend,
          { rejectToolCall: callId, rejectReason: 'skipped' },
        ),
      { intent: activeIntent },
    );
  };

  const handleSaveSessionSettings = async (patch: Partial<ChatSession>) => {
    if (!conversationId || !currentSession) return;
    if (isGuest && 'memory_enabled' in patch) {
      toast.error('Log in to use conversation memory.');
      return;
    }
    setIsSavingSettings(true);
    try {
      const updated = await chatService.updateSession(conversationId, patch);
      // Merge rather than replace: the PATCH response does not carry `messages`,
      // and swapping the whole object in would blank the transcript.
      setCurrentSession(prev => (prev ? { ...prev, ...updated } : updated));
      if ('memory_enabled' in patch) {
        toast.success(patch.memory_enabled ? 'Memory on' : 'Memory off for this chat');
      } else {
        toast.success('Settings saved');
        setShowSessionSettings(false);
      }
    } catch (err: unknown) {
      console.error('Failed to save chat settings', err);
      toast.error(apiErrorMessage(err, 'Could not save chat settings'));
    } finally {
      setIsSavingSettings(false);
    }
  };

  /**
   * Applies one SSE frame. Live turn state is folded by `useChatStream`; only
   * the effects that reach outside the turn are handled here.
   */
  const handleStreamEvent = (event: StreamEvent, meta: RunMeta = {}, replayed = false) => {
    const { optimisticId, intentToSend } = { optimisticId: meta.optimisticId, intentToSend: meta.intent };
    applyStreamEvent(event);
    applyPlanEvent(event);

    switch (event.type) {
      case 'status': {
        // The optimistic user message gets its real database id here.
        const realId = typeof event.user_message_id === 'number'
          ? event.user_message_id
          : null;
        if (optimisticId && realId !== null) {
          setMessages(prev => prev.map(m => (
            m.id === optimisticId ? { ...m, id: realId } : m
          )));
        }
        break;
      }

      case 'ask_permission':
      case 'ask_question':
        setIsLoading(false);
        break;

      case 'steers_returned': {
        // Messages sent while the agent was writing its final answer: the run
        // ended before it reached a point where it reads them. They go back in
        // the box — the same place a too-late steer already lands — so nothing
        // the user typed is lost and nothing is sent without them seeing it.
        // Not on replay: a re-attached stream would put the text back again.
        const returned = Array.isArray(event.messages)
          ? event.messages.filter((m): m is string => typeof m === 'string' && m.trim() !== '')
          : [];
        if (replayed || returned.length === 0) break;
        const text = returned.join('\n');
        setInput(prev => (prev.trim() ? `${text}\n${prev}` : text));
        setQueuedSteers(0);
        toast.info(
          returned.length === 1
            ? 'The agent finished before reading your message. It is back in the box.'
            : `The agent finished before reading ${returned.length} messages. They are back in the box.`,
        );
        break;
      }

      case 'done': {
        // The `done` frame carries whole persisted messages. `StreamEvent`
        // fields are `unknown` by design, so the assertion happens once, here,
        // rather than at each of the six reads below.
        const aiResponse = event.ai_response as ChatMessage | undefined;
        const userMessage = event.user_message as ChatMessage | undefined;

        // Batched with the append below, so the settled answer mounts already
        // exempt from the entrance animation — the text has been on screen for
        // the length of the stream and must not fade in over itself.
        setSettledId(aiResponse?.id ?? null);
        setMessages(prev => {
          // A stop before any text was streamed closes the turn with no
          // answer to show; the question stands on its own.
          if (!aiResponse) return prev;
          // A replayed frame may be re-applied after the transcript was
          // reloaded from the server, which already contains this answer.
          if (aiResponse.id && prev.some(m => m.id === aiResponse.id)) {
            return prev;
          }
          const reconciled = optimisticId && userMessage
            ? prev.map(m => (
                m.id === optimisticId || m.id === userMessage.id
                  ? { ...m, id: userMessage.id }
                  : m
              ))
            : prev;
          return [...reconciled, aiResponse];
        });
        setIsLoading(false);
        clearReference();

        // Sync intent to session state if it was locked this turn
        if (intentToSend && currentSession && !['chat', 'search', 'normal'].includes(intentToSend) && currentSession.intent !== intentToSend) {
          setCurrentSession({ ...currentSession, intent: intentToSend });
        }
        break;
      }

      case 'error':
        // Only the live delivery should raise a toast; replaying the frame
        // when the user comes back would re-announce an old failure.
        //
        // Held longer than a default toast because these are the failures that
        // tell the user what to change — no credential, no credit, a model the
        // provider retired — and each is a sentence or two, not a word.
        if (!replayed && typeof event.message === 'string') {
          toast.error(event.message, { duration: 12000 });
        }
        setIsLoading(false);
        break;
    }
  };

  /**
   * The server refused the message before the turn began (the input
   * sanitizer). Nothing was saved, so it comes out of the transcript here too:
   * the next message is answered as if this one had never been sent, and the
   * user can keep chatting. A conversation created only to hold it is deleted
   * rather than left in the list, empty and titled after the refused text.
   */
  const dropRefusedMessage = (
    sessionId: string,
    meta: RunMeta,
    notice: string | undefined,
    replayed: boolean,
  ) => {
    if (meta.optimisticId) {
      setMessages(prev => prev.filter(m => m.id !== meta.optimisticId));
    }
    if (replayed) return;
    toast.warning(
      notice || "We didn't process this message due to security concerns. It was not saved.",
      { duration: 12000 },
    );
    if (meta.createdSession && !isGuest) {
      chatService.deleteSession(sessionId).catch(err => {
        console.error('Failed to remove the empty conversation', err);
      });
      queryClient.setQueryData<ChatSessionSummary[]>(
        ['chatSessions'], (old = []) => old.filter(c => c.id !== sessionId));
      queryClient.removeQueries({ queryKey: ['chatSession', sessionId] });
      forgetTranscript(sessionId);
      clearChatDraft(sessionId, isGuest);
      startNewConversation();
    }
  };

  // The subscription effect below must not re-subscribe on every render, so it
  // reads the handlers through refs that always hold the latest closure.
  const handleStreamEventRef = useRef(handleStreamEvent);
  handleStreamEventRef.current = handleStreamEvent;
  const dropRefusedMessageRef = useRef(dropRefusedMessage);
  dropRefusedMessageRef.current = dropRefusedMessage;

  /**
   * Binds the view to the run for whichever conversation is open.
   *
   * Every buffered frame is replayed first, so a turn that streamed while the
   * user was elsewhere paints in full on return; `resetStream` before the
   * replay keeps the fold from being applied twice.
   */
  useEffect(() => {
    if (!conversationId) return;
    // No run: nothing to attach to. `isLoading` is left alone — a send that
    // is still creating its session has already set it, and clearing it here
    // would flicker the composer back to idle for a tick.
    const run = getChatRun(conversationId);
    if (!run) return;

    resetStream();
    resetPlan();
    setIsLoading(run.status === 'running');

    return subscribeChatRun(conversationId, (frame: RunFrame, replayed) => {
      if (frame.type === RUN_STATUS_EVENT) {
        setIsLoading(false);
        clearStreamStatus();
        // Both refusals happen before the server saves anything, so both take
        // the message back out: the injection filter and the content policy.
        if (frame.status === 'error'
            && (frame.code === 'SECURITY_VIOLATION' || frame.code === 'CONTENT_POLICY')) {
          dropRefusedMessageRef.current(
            conversationId,
            run.meta,
            typeof frame.error === 'string' ? frame.error : undefined,
            replayed,
          );
          return;
        }
        // `RunFrame` is a union with `SseEvent`, whose fields are `unknown`,
        // so the status frame's own `error?: string` has to be re-narrowed
        // here rather than assumed.
        if (!replayed && frame.status === 'error' && typeof frame.error === 'string') {
          toast.error(frame.error);
        }
        return;
      }
      handleStreamEventRef.current(frame, run.meta, replayed);
    });
    // `runningKeys` is the signal that a run was created for this conversation
    // after the effect first ran (a brand-new session starts its run one tick
    // after `conversationId` is set).
  }, [conversationId, runningKeys, resetStream, resetPlan, clearStreamStatus]);

  /**
   * Send a message to a turn that is already running, instead of dropping it.
   *
   * Sending while busy used to be a no-op — `handleSend` returned early and the
   * text sat in the box doing nothing. The backend has had a steer mailbox for
   * a while, and it is a queue, so several follow-ups sent while the agent
   * works all arrive in order at its next tool boundary. This is the only path
   * that reaches it.
   */
  useEffect(() => {
    // The counters describe one run's mailbox, so they go when the run does.
    if (!isLoading) {
      setQueuedSteers(0);
      setDroppedSteers(0);
    }
  }, [isLoading]);

  const steerRunningTurn = async (text: string) => {
    if (!conversationId) return;
    setInput('');
    try {
      const result = await chatService.steer(conversationId, text);
      setQueuedSteers(result.queued);
      // Only ever non-zero when the mailbox overflowed. Surfaced because an
      // instruction the user believes was accepted and that vanished is
      // exactly what the queue exists to prevent.
      if (result.dropped) setDroppedSteers(result.dropped);
    } catch {
      // The turn finished between the keypress and the request — put the text
      // back so it can be sent as an ordinary message rather than lost.
      setInput(text);
      setQueuedSteers(0);
    }
  };

  /**
   * Client-kind commands run in the browser: settings, panels, navigation.
   * No model call. Each is one branch here rather than a second registry,
   * because the behaviour is UI affordances the server cannot perform — and
   * the *listing* still comes from the server, so `/help` stays complete.
   */
  const runClientCommand = async (command: CommandDef, rest: string) => {
    const arg = rest.trim();
    switch (command.name) {
      case 'new':
      case 'clear':
        startNewConversation();
        setInput('');
        break;
      case 'mode': {
        const level = arg.toLowerCase();
        if (level === 'ask' || level === 'auto' || level === 'plan') {
          await setMode(level);
        } else {
          // Bare `/mode`: cycle like Shift+Tab rather than refusing.
          cycleMode();
        }
        setInput('');
        break;
      }
      case 'model':
        setShowModelDropdown(true);
        textareaRef.current?.focus();
        break;
      case 'effort':
        setShowModelDropdown(true);
        textareaRef.current?.focus();
        break;
      case 'file':
        // `/file <path>` attaches by path: the chip, not an upload.
        if (arg) {
          toast.info(`Attaching ${arg} — send a message to use it.`);
        }
        setInput('');
        break;
      case 'code': {
        const label = commandChips[0]?.label ?? arg;
        window.location.href = label ? `/code?project=${encodeURIComponent(label)}` : '/code';
        break;
      }
      case 'approvals':
        window.location.href = '/runs';
        break;
      case 'connect': {
        const label = commandChips[0]?.label ?? arg;
        window.location.href = label ? `/connections?open=${encodeURIComponent(label)}` : '/connections';
        break;
      }
      case 'help':
        toast.info('Every command is listed in the panel below.', { duration: 4000 });
        setInput('/help ');
        break;
      default:
        // Unknown client command: the server listing is the authority, so a
        // branch missing here is a client behind the server — fall through to
        // a normal send rather than dropping the text.
        await handleSend(arg ? `/${command.name} ${arg}` : `/${command.name}`);
        return;
    }
    setPickedCommand(null);
    setCommandChips([]);
    setCommandArgText('');
    setPaletteOpen(false);
  };

  /**
   * Confirm-sheet decisions: mission start, schedule arm, memory forget,
   * publish. Pressing the primary button is the approval — the typed command
   * covered nothing after the sheet.
   */
  const runCommandConfirm = async (
    name: string,
    baseArgs: Record<string, unknown>,
    confirm: Record<string, unknown>,
  ) => {
    setConfirmBusy(true);
    try {
      if (confirm.__forget) {
        await commandsService.confirm('memory_forget', {}, { memory_id: confirm.memory_id });
        toast.success('Forgotten.');
        return;
      }
      if (confirm.__preview) {
        const preview = await commandsService.run(
          'schedule',
          { ...baseArgs, cron: confirm.cron },
          {},
          {},
        );
        const card = (preview.card ?? {}) as { preview?: { description?: string; error?: string } };
        toast.info(card.preview?.description ?? card.preview?.error ?? 'Schedule previewed.');
        return;
      }
      const result = await commandsService.confirm(name, baseArgs, confirm);
      if (name === 'goal' && result.mission_id) {
        toast.success(`Mission #${String(result.mission_id)} started.`);
      } else if (name === 'schedule') {
        toast.success('Schedule armed.');
      } else {
        toast.success('Done.');
      }
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not confirm.'));
    } finally {
      setConfirmBusy(false);
    }
  };

  const handleSend = async (overrideInput?: string) => {
    const textToSend = overrideInput ?? input;
    if (!textToSend.trim()) return;
    if (isLoading) {
      await steerRunningTurn(textToSend.trim());
      return;
    }

    const intentToSend = activeIntent;

    // A command typed out in full and sent without the palette is parsed by
    // the backend. Client-kind commands never reach the turn: they run here.
    const parsed = !isGuest ? splitCommandLine(textToSend) : null;
    const typedCommand = parsed ? findCommand(parsed.name, commands) : null;
    if (parsed && !typedCommand) {
      // Unknown `/word`: a 400-quality message under the input, text left in
      // place — never sent to the model as plain text.
      setCommandError(`No command called '/${parsed.name}'. Try /help.`);
      return;
    }
    if (typedCommand && typedCommand.kind === 'client') {
      setCommandError(null);
      await runClientCommand(typedCommand, parsed!.rest);
      return;
    }

    const userMessage: ChatMessage = {
      id: Date.now(),
      role: 'user',
      content: textToSend,
      metadata: { intent: intentToSend },
      created_at: new Date().toISOString(),
      // A user message costs nothing, which `ChatMessage` spells as zeroes and
      // a blank `cost_source` — the cost strip renders nothing at all for it.
      // Written out rather than left off: the optimistic row is the same type
      // the server's row is, and a partial one would only differ until reload.
      model_id: '',
      input_tokens: 0,
      output_tokens: 0,
      cached_read_tokens: 0,
      cached_write_tokens: 0,
      cost_usd: '0',
      cost_source: '',
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    resetStream();
    resetPlan();
    setIsReasoningExpanded(false);
    setIsLiveCodeExpanded(true);
    setIsLiveSourcesExpanded(true);
    setIsLiveMediaExpanded(true);

    const meta: RunMeta = { optimisticId: userMessage.id as number, intent: intentToSend };

    try {
      let currentSessionId = conversationId;

      if (isGuest) {
        if (currentSessionId) {
          try {
            const existing = await chatService.guest.getSession(currentSessionId);
            setCurrentSession(existing);
          } catch (err: unknown) {
            const status = (err as { response?: { status?: number } })?.response?.status;
            const msg = err instanceof Error ? err.message : String(err);
            if (status === 404 || msg.includes('404') || msg.toLowerCase().includes('not found')) {
              currentSessionId = undefined;
              setConversationId(undefined);
              setCurrentSession(null);
            } else {
              throw err;
            }
          }
        }
        if (!currentSessionId) {
          const newSession = await chatService.guest.createSession(textToSend.slice(0, 30) + '...');
          meta.createdSession = true;
          currentSessionId = newSession.id;
          setConversationId(newSession.id);
          setCurrentSession(newSession);
        }
        const sessionId = currentSessionId;
        startChatRun(
          sessionId,
          (onEvent, signal) =>
            chatService.guest.sendMessageStream(sessionId, textToSend, onEvent, signal),
          meta,
        );
      } else {
        if (currentSessionId) {
          try {
            const existing = await chatService.getSession(currentSessionId);
            setCurrentSession(existing);
          } catch (err: unknown) {
            const status = (err as { response?: { status?: number } })?.response?.status;
            const msg = err instanceof Error ? err.message : String(err);
            if (status === 404 || msg.includes('404') || msg.toLowerCase().includes('not found')) {
              currentSessionId = undefined;
              setConversationId(undefined);
              setCurrentSession(null);
            } else {
              throw err;
            }
          }
        }
        if (!currentSessionId) {
          const newSession = await chatService.createSession({
            title: textToSend.slice(0, 30) + '...',
            llm_provider: llmProvider,
            llm_model: llmModel,
            system_prompt: ""
          });
          meta.createdSession = true;
          currentSessionId = newSession.id;
          setConversationId(newSession.id);
          setCurrentSession(newSession);
          queryClient.setQueryData<ChatSessionSummary[]>(['chatSessions'], (old = []) => [newSession, ...old]);
          if (showHistory) loadHistory();
        }

        const reference = activeReference ? { message_id: activeReference.messageId, snippet: activeReference.textSnippet } : undefined;
        const sessionId = currentSessionId;

        // A picked or typed turn/action command rides as structured input —
        // the backend resolves it (chips carry ids, so a chosen name is never
        // re-parsed). Client commands were handled above and never reach here.
        const commandPayload = pickedCommand
          ? buildCommandPayload(pickedCommand, commandChips, commandArgText || textToSend)
          : typedCommand
            ? { name: typedCommand.name, args: {}, text: parsed!.rest }
            : undefined;

        // Started, not awaited: the run owns the stream from here. Frames reach
        // this component through the subscription effect, which is also what
        // re-attaches after a page switch.
        startChatRun(
          sessionId,
          (onEvent, signal) =>
            chatService.sendMessageStream(
              sessionId,
              textToSend,
              intentToSend,
              onEvent,
              reference,
              signal,
              llmProvider,
              llmModel,
              undefined,
              undefined,
              effortToSend,
              commandPayload ? { command: commandPayload } : undefined
            ),
          meta,
        );
        // A sent command is consumed: the transcript chip comes from the
        // server's `metadata.command`, not from composer state.
        setPickedCommand(null);
        setCommandChips([]);
        setCommandArgText('');
        setPaletteOpen(false);
        setCommandError(null);
      }
    } catch (err) {
      // Only session creation can throw here; stream failures surface as a
      // run status frame instead.
      setIsLoading(false);
      clearStreamStatus();
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Failed to start this chat'}`,
        created_at: new Date().toISOString(),
        metadata: {}
      } as ChatMessage]);
    }
  };

  /**
   * Stops the turn. The server owns the work now, so this has to ask it to
   * cancel — closing the stream locally would leave the agent running. The
   * closing `done` frame carries whatever was written, saved as a partial
   * answer, so the stream ends itself and the transcript keeps the text.
   */
  const stopGeneration = async () => {
    if (!conversationId) return;
    setIsLoading(false);
    clearStreamStatus();
    try {
      await chatService.stopStream(conversationId);
      toast.info('Generation stopped');
    } catch (err) {
      // Nothing running server-side (or it is unreachable) — drop the local
      // reader so the UI does not sit on a stream that will never finish.
      abortChatRun(conversationId);
      console.error('Failed to stop generation', err);
    }
  };

  // The empty-state hero, and only the hero. It used to be "no messages yet",
  // which was also true while a transcript was being fetched and while the
  // first answer was streaming, so the hero rendered underneath both.
  const isInitialState = messages.length === 0 && !isLoading && !isRestoring;
  // Cold cache: nothing to paint but the request is out. With a cache hit the
  // transcript is already up and this never renders.
  // A turn already running is better news than a placeholder, so it wins.
  const showSkeleton = isRestoring && messages.length === 0 && !isLoading;

  // Note: the previous "Access Restricted / Configure Credentials" gate was
  // removed — the server-wide NVIDIA env key now backs the chat for any user
  // who hasn't set up a per-user credential.

  // Fresh chat puts the caret in the composer on devices with a fine pointer.
  // On a phone that would pop the keyboard over the hero, so it stays put.
  useEffect(() => {
    if (!isInitialState) return;
    if (typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches) return;
    textareaRef.current?.focus();
  }, [isInitialState]);

  return (
    <FilePreviewProvider>
    <div className="flex h-full w-full bg-background overflow-hidden relative">
      {/* No decorative wash. The three blurred orbs that used to sit here were
          off-palette (raw `purple-500`, not the `--agent` violet) and pushed a
         morphic look the Fluent tokens do not have. An answer surface
          reads better on a flat canvas — the content is the ornament. */}

      {/* Guest banner — encourage login without blocking chat. It carries its
          own in-flow menu button, so banner + header read as one top bar. */}
      {isGuest && <GuestBanner model={llmModel} />}

      {/* 1. History sidebar: an overlay drawer on phones, a column on desktop */}
      <ChatHistorySidebar
        open={showHistory}
        onClose={() => setShowHistory(false)}
        conversations={conversations}
        activeId={conversationId}
        runningKeys={runningKeys}
        onNewConversation={startNewConversation}
        onOpenConversation={loadConversation}
        onDeleteConversation={handleDeleteConversation}
      />

      {/* 2. Main Chat Area */}
      <div className="flex-1 flex flex-col h-full relative min-w-0 z-10 transition-colors duration-300">

        <ChatHeader
          isGuest={isGuest}
          historyOpen={showHistory}
          onOpenHistory={() => setShowHistory(true)}
          session={currentSession}
          onShowSettings={() => setShowSessionSettings(true)}
          onEditSettings={() => {
            setSystemPromptDraft(currentSession?.system_prompt || '');
            setShowSessionSettings(true);
          }}
        />

        {/* Per-chat settings: system prompt + memory. */}
        {showSessionSettings && currentSession && (
          <ChatSettingsDialog
            session={currentSession}
            isGuest={isGuest}
            promptDraft={systemPromptDraft}
            onPromptDraftChange={setSystemPromptDraft}
            saving={isSavingSettings}
            onSave={handleSaveSessionSettings}
            onClose={() => setShowSessionSettings(false)}
          />
        )}

        {/* Transcript + plan rail: the panel sits beside the scroll area on
            wide screens and collapses to a bottom sheet on phones. */}
        <div className="flex min-h-0 flex-1">
        {/* Dynamic Transition Area */}
        <div
          className={cn(
            "flex-1 min-w-0 overflow-y-auto px-4 md:px-6 transition-colors duration-1000 ease-in-out relative",
            // Initial state: truly center the hero (no asymmetric padding that
            // shoves it upward and leaves a dead zone above the composer).
            // Transcript: only enough head room to clear the sticky header —
            // the previous pt-8 sat on top of the 3rem turn rhythm below and
            // read as an unexplained empty band above the first message.
            isInitialState ? "flex items-center justify-center py-4" : "pt-3 pb-24"
          )}
          onMouseUp={syncSelection}
          onKeyUp={syncSelection}
        >
          <TextSelectionMenu
            position={selectionPos}
            onClose={dismissSelection}
            onCopy={() => {
              copySelection();
              toast.success('Text copied to clipboard');
            }}
            onReference={() => {
              if (referenceSelection()) textareaRef.current?.focus();
            }}
          />

          <div className={cn(
            "max-w-4xl mx-auto w-full relative",
            isInitialState ? "flex flex-col items-center" : "space-y-6"
          )}>
            {showSkeleton ? (
              <TranscriptSkeleton />
            ) : isInitialState ? (
              <div className="text-center space-y-6 mb-4 md:mb-12 animate-in fade-in duration-150">
                <div className="w-12 h-12 bg-agent-subtle border border-agent-line rounded-lg flex items-center justify-center mx-auto">
                  <BrainCircuit className="w-6 h-6 text-agent" />
                </div>
                <div className="space-y-2">
                  <h1 className="text-2xl md:text-3xl font-semibold text-foreground">
                    What should I take off your plate?
                  </h1>
                  <p className="text-muted-foreground text-base max-w-xl mx-auto leading-relaxed px-2">
                    Describe the job in plain words. I'll build the workflow, run it,
                    and check with you before anything leaves your account.
                  </p>
                </div>
                {/* Concrete starting points beat a blank box — each maps to a real
                    capability (scheduling, connectors, documents, triage). A fixed
                    grid keeps them from wrapping into a ragged pile. */}
                <div className="grid sm:grid-cols-2 gap-2 max-w-2xl mx-auto pt-2 text-left">
                  {[
                    { icon: Mail, label: 'Email me a digest of overdue invoices',
                      hint: 'Every Monday, 9am' },
                    { icon: FolderSearch, label: 'Find files nobody has opened in 3 years',
                      hint: 'Google Drive' },
                    { icon: FileText, label: 'Pull the line items out of this invoice',
                      hint: 'Upload a PDF' },
                    { icon: LifeBuoy, label: 'Draft first replies to support tickets',
                      hint: 'Needs your approval to send' },
                  ].map(({ icon: Icon, label, hint }) => (
                    <button
                      key={label}
                      onClick={() => setInput(label)}
                      className="flex items-start gap-3 px-3 py-2.5 bg-card hover:bg-accent border border-border rounded transition-colors"
                    >
                      <Icon className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-[13px] text-foreground leading-snug">{label}</span>
                        <span className="block text-[12px] text-muted-foreground mt-0.5">{hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              // Message List. One continuous thread: 24px on phones, 32px on
              // desktop. The old 48px rhythm plus the 40px separator padding
              // below stacked to ~88px of white between an answer's footer
              // and the next question, which read as separate pages.
              <div className="space-y-6 md:space-y-8">
                {messages.map((message, index) => (
                  <ChatMessageItem
                    /* Keyed by id, not index: rewind, edit and delete all
                       splice `messages`, and index keys re-mount the whole tail
                       — replaying the entrance animation on messages nobody
                       touched. Optimistic rows fall back to the index until
                       the `status` frame hands them their database id. */
                    key={String(message.id ?? `pending-${index}`)}
                    message={message}
                    index={index}
                    animate={message.id !== settledId}
                    deleting={deletingMsgId === message.id}
                    copied={copiedId === `msg-${index}`}
                    isPanelOpen={isPanelOpen}
                    togglePanel={togglePanel}
                    confirmBusy={confirmBusy}
                    onCopy={() => {
                      navigator.clipboard.writeText(message.content);
                      setCopiedId(`msg-${index}`);
                      setTimeout(() => setCopiedId(null), 2000);
                    }}
                    onDelete={handleDeleteMessage}
                    onRewrite={handleRewriteMessage}
                    onRewind={handleRewindAfterMessage}
                    onEdit={handleEditMessage}
                    onCommandConfirm={(name: string, args: Record<string, unknown>, confirm: Record<string, unknown>) => {
                      void runCommandConfirm(name, args, confirm);
                    }}
                  />
                ))}

                {isLoading && (() => {
                  /* One colour, not six. Every phase here is the agent working
                     unattended, and the token rule says that is violet — a
                     different hue per phase was decoration that implied a
                     distinction the states do not have. The icon shape already
                     says which phase it is. Sized to match the settled
                     "Answer" label so the row does not resize mid-stream. */
                  const phaseIcons: Record<string, React.ReactNode> = {
                    thinking: <BrainCircuit className="w-4 h-4 text-agent" />,
                    searching: <Search className="w-4 h-4 text-agent" />,
                    planning: <BrainCircuit className="w-4 h-4 text-agent" />,
                    reading: <Globe2 className="w-4 h-4 text-agent" />,
                    analyzing: <Globe2 className="w-4 h-4 text-agent" />,
                    generating: <Wand2 className="w-4 h-4 text-agent" />,
                    visualizing: <Wand2 className="w-4 h-4 text-agent" />,
                    motion_generating: <Video className="w-4 h-4 text-agent" />,
                  };

                  const statusMessage = live.status?.message || 'Thinking...';
                  /* Once the answer is coming out, the header is the answer's
                     header — same icon, no pulse — so it survives the settle
                     untouched. The phase icon is only useful while the phase is
                     still the thing happening. */
                  const answering = Boolean(live.content);
                  const statusIcon = answering
                    ? <BrainCircuit className="w-4 h-4 text-agent" />
                    : phaseIcons[live.status?.phase || 'thinking'] || phaseIcons.thinking;

                  /* Hoisted because it renders in one of two slots — above the
                     answer before any text arrives, below it afterwards. */
                  const statusPanel = (
                    <>
                      <div className="flex items-center justify-between gap-2.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[15px] font-semibold text-foreground/80 animate-pulse">{statusMessage}</span>
                          <ThinkingTimer active={isLoading} />
                        </div>
                        {live.thinking && (
                          <button
                            onClick={() => setIsReasoningExpanded(!isReasoningExpanded)}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/5 border border-primary/10 hover:bg-primary/10 transition-colors text-[10px] font-semibold  text-primary/60"
                          >
                            <BrainCircuit className="w-3 h-3" />
                            {isReasoningExpanded ? 'Hide reasoning' : 'View reasoning'}
                            <ChevronDown className={cn("w-3 h-3 transition-transform duration-300", isReasoningExpanded && "rotate-180")} />
                          </button>
                        )}
                      </div>

                      {live.thinking && isReasoningExpanded && (
                        <div className="mt-2 p-4 rounded-lg bg-muted/30 border border-border/40 animate-in fade-in slide-in-from-top-2 duration-300">
                          <div className="flex items-center gap-2 mb-3">
                            <BrainCircuit className="w-3.5 h-3.5 text-primary/60" />
                            <span className="text-[10px] font-semibold  text-muted-foreground/60">Internal processing</span>
                          </div>
                          <div className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground/80 italic font-medium leading-relaxed">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {live.thinking}
                            </ReactMarkdown>
                          </div>
                        </div>
                      )}
                    </>
                  );

                  return (
                    /* Rendered as the last child of the message list, not as
                       a sibling of it: the list carries the 3rem turn rhythm, so
                       a block outside it sat 24px closer and the answer visibly
                       rose as it settled. Same "Answer" label, same left edge,
                       no avatar — the in-flight turn now occupies exactly the
                       slot the settled one will take. */
                    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <div className="flex items-center gap-2 mb-3">
                        <span className={cn("flex items-center", !answering && "animate-pulse")}>{statusIcon}</span>
                        <span className="text-[13px] font-semibold text-foreground">Answer</span>
                      </div>
                      <div className="w-full space-y-3">
                        {/* Progress belongs above the answer only while there is
                            no answer yet. Once text is streaming it moves below,
                            so the first line of the reply sits directly under the
                            "Answer" label in both states — left above, it took
                            ~36px that vanished at settle and dropped the whole
                            answer upward at the exact moment it stopped moving. */}
                        {!live.content && statusPanel}

                        {/* Live Content Stream.

                            Same component and same wrapper classes as a settled
                            answer, deliberately. This was a bare <ReactMarkdown>
                            under different prose classes, so the instant a turn
                            finished the text it had spent the whole stream
                            rendering changed size, colour and leading, and bare
                            [1] refs turned into citation pills. Two renderers
                            for one string can only ever agree by coincidence.
                            No entrance animation either: this content persists
                            across the handoff, it does not arrive at it. */}
                        {live.content && (
                          <div className="prose prose-base dark:prose-invert max-w-none ai-chat-prose break-words min-w-0 text-[16px] leading-[1.75] text-foreground">
                            <MarkdownMessage content={streamedContent} sources={live.sources} />
                          </div>
                        )}

                        {live.content && statusPanel}

                        {/* The plan, updated live — this is what turns forty
                            tool calls into something a person can follow.
                            When the run dispatched a team, the transcript
                            shows a one-line pill that focuses the side panel
                            instead of repeating the list. */}
                        {live.todos.length > 0 && plan.tasks.length > 0 && (() => {
                          const { done, total } = planProgress(plan.tasks);
                          return (
                            <button
                              onClick={() => {
                                document.getElementById('plan-panel')
                                  ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                              }}
                              className="my-3 flex items-center gap-2 rounded-lg border border-primary/30 bg-muted/20 px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-muted/40"
                            >
                              <span className="font-medium text-foreground">Plan updated</span>
                              <span className="tabular-nums">({done}/{total})</span>
                              <span aria-hidden>→</span>
                            </button>
                          );
                        })()}

                        <FileCards files={live.files} />

                        {/* Artifacts as they arrive, before the turn is persisted. */}
                        {live.artifacts.map((art, i) => (
                          <HtmlArtifact key={`live-art-${i}`} artifact={art} />
                        ))}

                        {live.charts.map((chart, i) => (
                          <ChartArtifact key={`live-chart-${i}`} chart={chart} />
                        ))}

                        {/* The delegated run's card + command cards, live. */}
                        {live.agentRun?.execution_id && (
                          <CommandCard
                            card={{
                              type: 'agent_run',
                              agent_name: live.agentRun.agent_name,
                              execution_id: live.agentRun.execution_id,
                              status: live.agentRun.status,
                            }}
                            onNavigate={(path) => { window.location.href = path; }}
                          />
                        )}
                        {live.commandCard?.type && (
                          <CommandCard
                            card={live.commandCard}
                            busy={confirmBusy}
                            onConfirm={(confirm) => {
                              const cmd = pickedCommand;
                              if (cmd) void runCommandConfirm(cmd.name, {}, confirm);
                            }}
                            onNavigate={(path) => { window.location.href = path; }}
                          />
                        )}

                        {/* Live Activity Timeline */}
                        {live.activity.length > 0 && (
                          <div className="space-y-2 animate-in fade-in duration-300">
                            <div className="flex items-center gap-3 px-1 mb-2">
                              <BrainCircuit className="w-4 h-4 text-primary/60" />
                              <span className="text-sm font-semibold  text-muted-foreground/90">Agent timeline</span>
                              <div className="h-px flex-1 bg-border/30" />
                            </div>
                            <div className="space-y-2">
                               {live.activity.map((activity, i) => {
                                 const isThought = activity.type === 'thought';
                                 const thought = activity.thought;
                                 const isLongThought = thought && thought.length > 200;
                             
                                 return (
                                   <div 
                                      key={i}
                                      className="flex flex-col gap-2 animate-in fade-in slide-in-from-left-2 py-1 border-l-2 border-primary/5 pl-4 ml-3.5 last:border-0"
                                   >
                                      <div className="flex items-start gap-3.5 -ml-[30px]">
                                        {isThought ? (
                                          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 border border-primary/20 shadow-sm">
                                             <BrainCircuit className="w-3.5 h-3.5 text-primary/60" />
                                          </div>
                                        ) : (
                                          <span className="flex items-center justify-center w-7 h-7 rounded-md bg-amber-500/20 text-xs font-semibold text-amber-600 shrink-0 border border-border shadow-sm">
                                             {activity.iteration || '?'}
                                          </span>
                                        )}
                                    
                                        <div className="flex flex-col gap-1 min-w-0 flex-1">
                                          {isThought ? (
                                            <div className="flex items-center gap-2 pt-1">
                                              <span className="text-[11px] font-semibold  text-muted-foreground/50">Processing</span>
                                              <Loader2 className="w-2.5 h-2.5 animate-spin text-muted-foreground/20" />
                                            </div>
                                          ) : (
                                            <div className="flex items-center gap-3">
                                              <span className="font-mono font-bold text-primary text-[15px]">{activity.tool}</span>
                                              <Loader2 className="w-3 h-3 animate-spin text-primary/30" />
                                            </div>
                                          )}

                                          {/* `question` is ask_vision: the agent interrogating a vision
                                              model about an image it cannot see. Showing the question it
                                              asked is legible in a way "calling ask_vision..." is not. */}
                                          {!isThought && (argText(activity.args?.query) || argText(activity.args?.question)) && (
                                             <span className="truncate max-w-[40vw] sm:max-w-[340px] text-foreground/60 italic text-[13px] font-medium opacity-80">"{stripXmlTags(argText(activity.args?.query) || argText(activity.args?.question))}"</span>
                                          )}
                                      
                                          {thought && (
                                            <div className="mt-1.5 group/thought relative">
                                              <div className={cn(
                                                "text-[13.5px] text-muted-foreground/75 italic leading-relaxed border-l-2 border-primary/20 pl-3 transition-colors duration-300 ai-activity-markdown pb-1",
                                                isLongThought && openPanelId('activity') === null && "max-h-[80px] overflow-hidden mask-fade-bottom"
                                              )}>
                                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                  {thought}
                                                </ReactMarkdown>
                                              </div>
                                              {isLongThought && (
                                                <button 
                                                  onClick={() => togglePanel('activity', -i - 1)}
                                                  className="text-[10px] font-bold text-primary/40 hover:text-primary transition-colors flex items-center gap-1 mt-1"
                                                >
                                                  {isPanelOpen('activity', -i - 1) ? 'Show less' : 'Read more reasoning...'}
                                                </button>
                                              )}
                                            </div>
                                  )}
                                        </div>
                                      </div>
                                   </div>
                                 );
                               })}
                            </div>
                          </div>
                        )}

                        {/* Live Code Timeline */}
                        {live.codeExecutions.length > 0 && (
                          <div className="space-y-3 animate-in fade-in duration-300 mt-4">
                            <button 
                              onClick={() => setIsLiveCodeExpanded(!isLiveCodeExpanded)}
                              className="flex items-center gap-3 px-1 mb-2 w-full group"
                            >
                              <Code className="w-4 h-4 text-emerald-500/60 group-hover:text-emerald-500 transition-colors" />
                              <span className="text-sm font-semibold  text-muted-foreground/90">Code sandbox</span>
                              <div className="h-px flex-1 bg-border/20" />
                              <ChevronDown className={cn("w-4 h-4 text-muted-foreground/40 transition-transform duration-300", isLiveCodeExpanded && "rotate-180")} />
                            </button>
                        
                            {isLiveCodeExpanded && (
                              <div className="space-y-3">
                                {live.codeExecutions.map((exec, i) => (
                                  <div key={i} className="rounded-lg overflow-hidden border border-border bg-success-subtle animate-in slide-in-from-bottom-2 duration-300">
                                    <div className="px-4 py-2 bg-success-subtle flex items-center justify-between border-b border-emerald-500/10">
                                       <div className="flex items-center gap-2">
                                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                          <span className="text-[10px] font-semibold text-emerald-600 ">Active Execution {i+1}</span>
                                       </div>
                                    </div>
                                    <div className="p-4 space-y-3">
                                       <pre className="text-[13px] text-foreground/80 font-mono bg-card p-3 rounded-lg overflow-x-auto border border-white/5">
                                          <code>{exec.code}</code>
                                       </pre>
                                       {(exec.output || exec.result) && (
                                         <div className="space-y-1.5">
                                            <div className="flex items-center gap-2 px-1">
                                               <div className="h-px flex-1 bg-blue-500/10" />
                                               <span className="text-[9px] font-bold text-blue-500/60 uppercase">Console output</span>
                                               <div className="h-px flex-1 bg-blue-500/10" />
                                            </div>
                                            <pre className="text-[12px] text-blue-400/80 font-mono bg-zinc-950/30 p-3 rounded-lg overflow-x-auto border border-blue-500/5 whitespace-pre-wrap">
                                               <code>{exec.output || exec.result}</code>
                                            </pre>
                                         </div>
                                       )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Media Generation status (Visualize/Motion) */}
                        {(live.status?.phase === 'visualizing' || live.status?.phase === 'motion_generating') && (
                          <div className="mt-4 rounded-lg border border-border bg-muted aspect-video max-w-sm w-full flex flex-col items-center justify-center gap-3 text-center p-6">
                            <div className="flex items-center gap-2 text-muted-foreground">
                              {live.status.phase === 'visualizing' ? (
                                  <ImageIcon className="w-6 h-6" />
                              ) : (
                                  <Video className="w-6 h-6" />
                              )}
                              <span className="text-sm font-semibold text-foreground">
                                  {live.status.phase === 'visualizing' ? 'Generating image' : 'Generating video'}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Working on your media — this stays here when done.
                            </p>
                          </div>
                        )}

                        {/* Live Discoveries Row — Sources and Media */}
                        {(live.sources.length > 0 || live.images.length > 0 || live.videos.length > 0) && (
                          <div className="mt-4 flex flex-wrap gap-2 animate-in fade-in duration-300">
                            {live.sources.length > 0 && (
                              <button
                                onClick={() => setIsLiveSourcesExpanded(!isLiveSourcesExpanded)}
                                className={cn(
                                  "flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors border group",
                                  isLiveSourcesExpanded ? "bg-primary-subtle border-primary-line text-primary" : "bg-secondary border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                                )}
                              >
                                <Globe2 className="w-3.5 h-3.5" />
                                <span className="text-[12px] font-medium">{live.sources.length} Sources</span>
                                <ChevronDown className={cn("w-3 h-3 transition-transform duration-300", isLiveSourcesExpanded && "rotate-180")} />
                              </button>
                            )}

                            {(live.images.length > 0 || live.videos.length > 0) && (
                              <button
                                onClick={() => setIsLiveMediaExpanded(!isLiveMediaExpanded)}
                                className={cn(
                                  "flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors border group",
                                  isLiveMediaExpanded ? "bg-success-subtle border-emerald-500/30 text-emerald-600 shadow-sm" : "bg-muted/30 border-border/40 text-muted-foreground hover:bg-muted/50"
                                )}
                              >
                                <ImageIcon className={cn("w-3.5 h-3.5", isLiveMediaExpanded ? "text-emerald-600" : "text-muted-foreground/60 group-hover:text-emerald-500")} />
                                <span className="text-[12px] font-medium">{live.images.length + live.videos.length} Media</span>
                                <ChevronDown className={cn("w-3 h-3 transition-transform duration-300", isLiveMediaExpanded && "rotate-180")} />
                              </button>
                            )}
                          </div>
                        )}

                        {/* Live Expanded Areas */}
                        {live.sources.length > 0 && isLiveSourcesExpanded && (
                          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 px-1 animate-in slide-in-from-top-2 duration-300">
                            {live.sources.slice(0, 3).map((source, i) => (
                              <MediaPreview 
                                key={i}
                                url={source.url}
                                type="link"
                                title={source.title}
                                thumbnail={source.thumbnail}
                                className="opacity-80 hover:opacity-100 animate-in zoom-in-95 duration-300"
                              />
                            ))}
                            {live.sources.length > 3 && (
                              <div className="flex items-center justify-center rounded-lg border border-dashed border-border/40 bg-muted/20 text-[10px] font-bold text-muted-foreground/40 italic">
                                 +{live.sources.length - 3} more...
                              </div>
                            )}
                          </div>
                        )}

                        {(live.images.length > 0 || live.videos.length > 0) && isLiveMediaExpanded && (
                           <div className="mt-3 flex gap-3 overflow-x-auto pb-2 scrollbar-hide px-1 animate-in slide-in-from-top-2 duration-300">
                             {live.images.slice(0, 4).flatMap((img, i) => {
                               const url = img.image || img.url;
                               return url ? [(
                                 <MediaPreview
                                   key={`img-${i}`}
                                   url={url}
                                   type="image"
                                   className="w-32 h-20 shrink-0 shadow-sm"
                                 />
                               )] : [];
                             })}
                             {live.videos.slice(0, 4).flatMap((vid, i) => (
                               vid.url ? [(
                                 <MediaPreview
                                   key={`vid-${i}`}
                                   url={vid.url}
                                   type="video"
                                   className="w-32 h-20 shrink-0 shadow-sm"
                                 />
                               )] : []
                             ))}
                             {(live.images.length > 4 || live.videos.length > 4) && (
                               <div className="w-24 h-20 shrink-0 flex items-center justify-center rounded-lg bg-muted/20 border border-dashed border-border/40 text-[9px] font-semibold text-muted-foreground/30  text-center px-2">
                                  +{live.images.length + live.videos.length - 8} more
                               </div>
                             )}
                           </div>
                        )}

                        {/* Progress bar */}
                        {!live.activity.length && (
                          <div className="w-48 h-0.5 bg-muted/30 rounded-full overflow-hidden">
                            <div className="h-full bg-primary/40 rounded-full animate-indeterminate-slide" />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {isUploading && (
              <div className="flex gap-3 md:gap-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border border-border/40 shadow-md bg-muted text-muted-foreground">
                  <Settings2 className="w-5 h-5"/>
                </div>
                <div className="min-w-0 flex-1 max-w-[92%] md:max-w-[85%] space-y-3">
                  <div className="bg-muted/30 p-4 rounded-lg shadow-sm border border-border/40 inline-flex flex-col gap-3 min-w-[300px] max-w-sm w-full">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-lg bg-background border border-border/50 flex items-center justify-center shrink-0">
                        <Loader2 className="w-5 h-5 text-primary animate-spin" />
                      </div>
                      <div className="flex-1">
                        <h4 className="text-sm font-bold animate-pulse text-foreground/80">Uploading file...</h4>
                        <p className="text-xs text-muted-foreground font-medium mt-0.5">Processing document contents</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Approval: the assistant wants to run a tool that needs your OK */}
            {pendingToolCall && (
              <ToolApprovalCard
                call={pendingToolCall}
                onApprove={handleApproveTool}
                onDeny={handleDenyTool}
              />
            )}

            {/* A question the assistant (or one of its agents) asked */}
            {pendingQuestion && !pendingToolCall && (
              <QuestionCard
                key={pendingQuestion.call_id}
                spec={pendingQuestion}
                onSubmit={handleAnswerQuestion}
                onSkip={handleSkipQuestion}
                busy={isLoading}
              />
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

          {(plan.tasks.length > 0 || plan.leases.length > 0 || plan.changes.length > 0) && (
            // `contents` so the anchor id does not disturb the flex row —
            // the rail and the phone sheet both live inside PlanPanel.
            <div id="plan-panel" className="contents">
              <PlanPanel
                todos={live.todos}
                todoHistory={live.todoHistory}
                tasks={plan.tasks}
                leases={plan.leases}
                changes={plan.changes}
              />
            </div>
          )}
        </div>

        {/* Dynamic Navigation/Input Area */}
        <footer className={cn(
          // pb uses the safe-area inset so the composer toolbar clears the
          // phone gesture bar (needs viewport-fit=cover in index.html).
          "shrink-0 transition-colors duration-1000 ease-in-out px-4",
          isInitialState
            ? "pb-[max(1.5rem,env(safe-area-inset-bottom))] md:pb-16"
            : "pb-[max(1.25rem,env(safe-area-inset-bottom))] md:pb-6 pt-2"
        )}>
          <div className="max-w-4xl mx-auto space-y-4">
            
            <div className="relative group/input">

              {/* The plan, pinned above the composer so it never scrolls
                  away. A team run shows it in the side panel instead. */}
              {plan.tasks.length === 0 && dockPlan.history.length > 0 && (
                <PlanDock history={dockPlan.history} actions={dockPlan.actions}
                  live={dockPlan.live} />
              )}

              {/* Continue Exploring — above the chatbox */}
              {!isInitialState && !isLoading && (() => {
                const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
                const followUps = lastAssistant?.metadata?.follow_ups;
                if (!followUps || followUps.length === 0) return null;
                return (
                  <div className="mb-3 animate-in fade-in slide-in-from-bottom-4 duration-500 bg-card/60 border border-border/50 rounded-lg overflow-hidden">
                    <button 
                      onClick={() => setIsFollowUpsExpanded(!isFollowUpsExpanded)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <Lightbulb className="w-3.5 h-3.5 text-amber-500/50" />
                        <span className="text-[10px] font-semibold  text-muted-foreground/60">Continue exploring</span>
                      </div>
                      <ChevronDown className={cn(
                        "w-4 h-4 text-muted-foreground/50 transition-transform duration-300",
                        isFollowUpsExpanded ? "rotate-180" : ""
                      )} />
                    </button>
                    
                    <div className={cn(
                      "grid transition-colors duration-300 ease-in-out",
                      isFollowUpsExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                    )}>
                      <div className="overflow-hidden">
                        <div className="flex flex-wrap gap-2 p-3 pt-0">
                          {followUps.map((q: string, i: number) => (
                            <button
                              key={i}
                              onClick={() => handleSend(q)}
                              // Staggered entrance: three chips appearing at once
                              // read as a block of UI to skip past, where a quick
                              // cascade reads as suggestions worth a glance.
                              style={{ animationDelay: `${i * 70}ms`, animationFillMode: 'backwards' }}
                              className="group flex flex-1 min-w-[200px] items-center gap-2.5 px-4 py-2.5 bg-background
                                         border border-border/50 rounded-lg shadow-sm text-left
                                         text-muted-foreground hover:text-foreground
                                         hover:bg-primary/5 hover:border-primary/20 hover:shadow-md
                                         transition-colors duration-200 ease-out active:scale-[0.98]
                                         animate-in fade-in slide-in-from-bottom-2"
                            >
                              <Zap className="w-3.5 h-3.5 shrink-0 opacity-30 transition-colors duration-200 group-hover:opacity-100 group-hover:text-primary group-hover:scale-110" />
                              <span className="text-[13px] font-medium leading-snug">{q}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* An upload the model could not read. Deliberately persistent
                  rather than a toast: the fix is to change model, and the user
                  needs the message to still be on screen while they do it. */}
              {blockedAttachments && (
                <div className="mb-2 flex items-start gap-2.5 rounded-lg border border-border bg-warning-subtle
                                px-3.5 py-2.5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <FileIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                  <p className="flex-1 text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
                    {blockedAttachments.message}
                  </p>
                  <button
                    onClick={() => dismissBlockedAttachments()}
                    aria-label="Dismiss"
                    className="shrink-0 rounded p-0.5 text-amber-600/60 transition-colors hover:bg-amber-500/20 hover:text-amber-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {/* Input Capsule — bigger, with pills inside */}
              <div className="relative z-10">

                 {/* Active Reference Pill */}
                 {activeReference && (
                   <div className="flex animate-in fade-in slide-in-from-bottom-2 duration-300 absolute bottom-full mb-3 left-4">
                     <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-success-subtle border border-border rounded-lg group">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[10px] font-semibold  text-emerald-600 shrink-0">Reference</span>
                          <div className="w-px h-3 bg-emerald-500/30 shrink-0" />
                          <span className="text-xs font-medium text-emerald-700/80 truncate max-w-[300px] italic">"{activeReference.textSnippet}"</span>
                        </div>
                        <button 
                          onClick={() => clearReference()}
                          className="p-1 hover:bg-emerald-500/20 rounded-md transition-colors shrink-0 text-emerald-600/60 hover:text-emerald-600"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                     </div>
                   </div>
                 )}


                {/* Flat card, not a glowing capsule. The blurred primary wash
                    that used to bloom behind this on focus was the loudest
                    thing on the page; a border that turns primary plus the
                    standard focus ring says "focused" in the same language as
                    every other input in the app. */}
                <div className="relative flex flex-col bg-card border border-border rounded-lg shadow-sm transition-colors duration-150 focus-within:border-primary focus-within:ring-1 focus-within:ring-ring">
                  {/* The `/` palette: fuzzy match, ↑/↓, Enter/Tab, Esc. */}
                  {!isGuest && (
                    <CommandPalette
                      open={paletteOpen && !isLoading}
                      commands={commands}
                      query={(splitCommandLine(input)?.name ?? '').replace(/^\//, '') || (input.replace(/^\s+/, '').startsWith('/') ? input.replace(/^\s+\//, '').replace(/^\//, '').split(/\s/)[0] ?? '' : '')}
                      onPick={(command) => {
                        setPickedCommand(command);
                        setCommandChips([]);
                        setCommandArgText('');
                        // Leave the task text in the box after the name; the
                        // payload carries the structured command, the text
                        // carries what the user typed to say. Prose typed
                        // before opening the palette (e.g. via the Commands
                        // button) is kept as the task, never discarded.
                        setInput(prefillCommandInput(input, command.name));
                        setPaletteOpen(false);
                        textareaRef.current?.focus();
                      }}
                      onClose={() => setPaletteOpen(false)}
                    />
                  )}
                  {/* Mode picker — Ask · Auto · Plan. Auto is amber on purpose:
                      a mode that acts without asking must not look like the
                      default. Hidden for guests, who run one pinned mode. */}
                  {!isGuest && (
                    <div className="flex items-center gap-1 px-4 pt-2.5" role="group" aria-label="Chat mode">
                      {([
                        { key: 'ask' as const, label: 'Ask', hint: 'Approve side effects (Shift+Tab to cycle)' },
                        { key: 'auto' as const, label: 'Auto', hint: 'Clear matches run; the rest still ask' },
                        { key: 'plan' as const, label: 'Plan', hint: 'Look, don’t touch — no mutating tools' },
                      ]).map(m => (
                        <button
                          key={m.key}
                          onClick={() => void setMode(m.key)}
                          title={m.hint}
                          className={cn(
                            "flex items-center gap-1 h-6 px-2.5 rounded-md text-[10px] font-bold border",
                            "transition-colors duration-200 ease-out active:scale-95",
                            autonomy === m.key
                              ? m.key === 'auto'
                                ? 'bg-amber-500/15 border-amber-500/50 text-amber-600 dark:text-amber-400'
                                : m.key === 'plan'
                                  ? 'bg-purple-500/15 border-purple-500/40 text-purple-500'
                                  : 'bg-primary/10 border-primary/30 text-primary'
                              : "border-transparent text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/40",
                          )}
                        >
                          {m.key === 'ask' && <Shield className="w-3 h-3" />}
                          {m.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* Textarea row */}
                  <div className="p-4 pb-0">
                    {/* Picked command + chips: the structured input, shown as
                        chips carrying ids — never re-resolved names. */}
                    {pickedCommand && (
                      <div className="mb-2 flex flex-wrap items-center gap-1.5 px-2">
                        <span className="inline-flex min-h-[28px] items-center rounded-md bg-primary/10 px-2 py-1 font-mono text-[12px] font-bold text-primary">
                          /{pickedCommand.name}
                        </span>
                        {commandChips.map((chip) => (
                          <span
                            key={`${chip.arg}:${chip.id}`}
                            className="inline-flex min-h-[28px] items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-[12px] font-medium text-foreground"
                          >
                            {chip.label}
                            <button
                              onClick={() => setCommandChips((prev) => prev.filter((c) => c !== chip))}
                              aria-label={`Remove ${chip.label}`}
                              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                        <button
                          onClick={() => {
                            setPickedCommand(null);
                            setCommandChips([]);
                            setCommandArgText('');
                            setPaletteOpen(false);
                          }}
                          aria-label="Clear command"
                          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                    {/* A typed command that failed to parse: 400 under the
                        input, text left in place — never a model turn. */}
                    {commandError && (
                      <div className="mb-2 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2">
                        <p className="flex-1 text-[12px] text-destructive">{commandError}</p>
                        <button
                          onClick={() => setCommandError(null)}
                          aria-label="Dismiss"
                          className="shrink-0 rounded p-0.5 text-destructive/60 hover:bg-destructive/10"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                    <textarea
                      id="chat-input-textarea"
                      name="chat-input"
                      ref={textareaRef}
                      value={input}
                      onChange={(e) => {
                        const next = e.target.value;
                        setInput(next);
                        // `/` at the start opens the palette; anywhere else
                        // is plain text (a path mid-sentence never triggers).
                        if (!isGuest && !isLoading) {
                          const atStart = next.replace(/^\s+/, '').startsWith('/');
                          setPaletteOpen(atStart && !pickedCommand);
                          if (atStart) setCommandError(null);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          // With the palette open, Enter picks the command.
                          if (paletteOpen) return;
                          e.preventDefault();
                          handleSend();
                        }
                        // Shift+Tab cycles Ask → Auto → Plan without leaving the keyboard.
                        if (e.key === 'Tab' && e.shiftKey && !isGuest) {
                          e.preventDefault();
                          cycleMode();
                        }
                        if (e.key === 'Escape' && paletteOpen) {
                          e.preventDefault();
                          setPaletteOpen(false);
                        }
                      }}
                      onPaste={(e) => {
                        const items = e.clipboardData?.items;
                        if (!items) return;
                        for (let i = 0; i < items.length; i++) {
                          if (items[i].kind === 'file') {
                            const file = items[i].getAsFile();
                            if (file) {
                              e.preventDefault();
                              processFile(file);
                              return;
                            }
                          }
                        }
                      }}
                      placeholder={activeIntent !== 'normal' ? `Type your ${activeIntent} query...` : "Ask anything..."}
                      className="w-full min-h-[56px] max-h-[200px] px-2 py-2 bg-transparent border-none focus:ring-0 focus:outline-none resize-none text-[17px] font-medium placeholder:text-muted-foreground/50 scrollbar-none leading-[1.7] tracking-[-0.01em]"
                      rows={2}
                    />
                  </div>

                  {/* Bottom toolbar — pills + voice + model + send, all inside the chatbox */}
                  <div className="flex items-center justify-between px-2 sm:px-3 pb-3 pt-1 gap-1.5 sm:gap-2">
                    {/* Left: intent pills */}
                    <div className="flex items-center gap-1.5 min-w-0 flex-1 basis-0">
                      <div className="flex items-center gap-1.5 min-w-0 max-w-full overflow-x-auto scrollbar-none scroll-rail pr-1">
                        {/* Slash commands, without typing `/`. Typing a
                            leading slash is undiscoverable — on a phone
                            keyboard it is two taps away behind the symbols
                            page — so this opens the same palette the slash
                            opens. Hidden for guests, who have no commands. */}
                        {!isGuest && (
                          <button
                            onClick={() => {
                              if (isLoading) return;
                              setCommandError(null);
                              setPaletteOpen((open) => !open);
                              textareaRef.current?.focus();
                            }}
                            disabled={isLoading}
                            aria-label="Open slash commands"
                            aria-expanded={paletteOpen}
                            title="Slash commands ( / )"
                            className={cn(
                              "flex items-center gap-1.5 h-8 px-3 rounded-lg text-[10px] font-bold shrink-0 border",
                              "transition-colors duration-200 ease-out active:scale-95",
                              "disabled:opacity-40",
                              paletteOpen
                                ? 'bg-primary/10 border-primary/30 text-primary'
                                : "border-transparent text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/40",
                            )}
                          >
                            <Slash className="w-3.5 h-3.5" />
                            {/* Label stays on phones too, like Search/Research:
                                an icon alone says nothing about what tapping
                                it opens. The row scrolls if space runs out. */}
                            <span className="inline">
                               Commands
                            </span>
                          </button>
                        )}
                        {[
                          // Coding / Files / Workflow removed along with the
                          // server-side tools that backed them. A pill that sets
                          // an intent the backend no longer honours is worse than
                          // no pill: it silently does nothing.
                          { key: 'search' as const, icon: <Search className="w-3.5 h-3.5" />, label: 'Search', color: 'blue' },
                          { key: 'research' as const, icon: <Globe2 className="w-3.5 h-3.5" />, label: 'Research', color: 'purple' },
                        ].map(tool => (
                          <button
                            key={tool.key}
                            onClick={() => toggleIntent(tool.key)}
                            className={cn(
                              "flex items-center gap-1.5 h-8 px-3 rounded-lg text-[10px] font-bold shrink-0 border",
                              "transition-colors duration-200 ease-out active:scale-95",
                              activeIntent === tool.key
                                ? tool.color === 'blue' ? 'bg-blue-500/15 border-blue-500/40 text-blue-500'
                                : 'bg-purple-500/15 border-purple-500/40 text-purple-500'
                              : "border-transparent text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/40",
                              isLocked && tool.key === lockedIntent && activeIntent !== lockedIntent && "border-dashed border-muted-foreground/30 opacity-60"
                            )}
                          >
                            {tool.icon}
                            {/* Labels stay on phones too: two pills fit, and
                                an icon alone says nothing about what tapping
                                it changes. The row scrolls if a third returns. */}
                            <span className="inline">
                               {tool.label}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Right: model + voice + send. shrink-0 so the send
                        button is never squeezed off screen; min-w-0 plus the
                        viewport caps below so queued/dropped badges and the
                        model label truncate instead of colliding on phones. */}
                    <div className="flex items-center gap-1 sm:gap-1.5 min-w-0 shrink-0">
                      {/* Model selector. Guests have nothing to select: the
                          backend serves them one pinned model and ignores any
                          model a client names, so they get a label rather than
                          a dropdown whose choices would change nothing. */}
                      {isGuest ? (
                        <div
                          className="flex items-center gap-2 h-8 px-3 rounded-lg border border-transparent text-[10px] font-bold text-muted-foreground/50"
                          title="Guest mode runs on NVIDIA NIM — log in to choose a model"
                        >
                          <Zap size={14} className="text-muted-foreground/50 shrink-0" />
                          <span className="inline max-w-[22vw] sm:max-w-[140px] truncate">
                            {prettyModel(llmModel)}
                          </span>
                        </div>
                      ) : (
                      <div className="relative min-w-0" ref={dropdownRef}>
                        <button
                          onClick={() => setShowModelDropdown(!showModelDropdown)}
                          className={cn(
                            "flex items-center gap-1.5 sm:gap-2 h-8 px-2 sm:px-3 rounded-lg transition-colors text-[10px] font-bold border min-w-0 max-w-[38vw] sm:max-w-none",
                            showModelDropdown
                              ? "bg-primary/10 border-primary/30 text-primary"
                              : "border-transparent text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/40"
                          )}
                        >
                          <span className="text-sm leading-none flex items-center">
                            {dynamicProviders.find(p => p.slug === llmProvider)?.icon ? (
                              <span>{dynamicProviders.find(p => p.slug === llmProvider)?.icon}</span>
                            ) : (
                              <Bot size={14} className="shrink-0" />
                            )}
                          </span>
                          <span className="inline max-w-[22vw] sm:max-w-[120px] truncate">
                            {dynamicProviders.find(p => p.slug === llmProvider)?.models.find(m => m.value === llmModel)?.name || 'Select model'}
                          </span>
                          {/* Only when it is doing something. A badge reading
                              "Default" on every model would be noise, and one
                              shown for a model with no effort control would be
                              a claim about a setting that is not applied. */}
                          {effortSupported && llmEffort && (
                            <span className="inline px-1.5 py-0.5 rounded text-[9px] font-bold bg-primary/10 text-primary shrink-0">
                              {EFFORT_LABELS[llmEffort] ?? llmEffort}
                            </span>
                          )}
                          <ChevronDown className={cn("w-3 h-3 transition-transform duration-200", showModelDropdown && "rotate-180")} />
                        </button>

                        {showModelDropdown && (
                          <>
                            {/* Backdrop */}
                            <div className="fixed inset-0 z-[9998]" onClick={() => setShowModelDropdown(false)} />
                            
                            <div className="absolute bottom-[calc(100%+8px)] right-0 w-[300px] max-w-[calc(100vw-2rem)] bg-card border border-border rounded-lg shadow-lg z-[9999] backdrop-blur-2xl overflow-hidden animate-in slide-in-from-bottom-3 fade-in duration-200">
                              
                              {/* Provider Grid */}
                              <div className="p-3 border-b border-border/30">
                                <label className="text-[11px] font-semibold text-muted-foreground mb-2 block px-1">AI provider</label>
                                <div className="grid grid-cols-4 gap-1.5">
                                  {dynamicProviders.map(p => (
                                    <button
                                      key={p.slug}
                                      onClick={() => {
                                        setLlmProvider(p.slug);
                                        if (p.models.length > 0 && llmProvider !== p.slug) {
                                          saveLLMSettings(p.slug, p.models[0].value);
                                        }
                                      }}
                                      className={cn(
                                        "flex flex-col items-center gap-1 p-2 rounded-lg border text-center transition-colors",
                                        llmProvider === p.slug
                                          ? "bg-primary/10 border-primary/30 text-primary shadow-sm ring-1 ring-primary/10"
                                          : "border-transparent hover:bg-muted/50 text-muted-foreground hover:text-foreground",
                                        !p.has_credentials && p.slug !== 'ollama' && "opacity-40"
                                      )}
                                    >
                                      <span className="text-lg leading-none">{p.icon}</span>
                                      <span className="text-[8px] font-bold truncate w-full">{p.name}</span>
                                    </button>
                                  ))}
                                </div>
                              </div>

                              {/* Search */}
                              <div className="px-3 pt-2.5 pb-1.5">
                                <div className="relative">
                                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/30" />
                                  <input
                                    id="model-search-input"
                                    name="model-search"
                                    type="text"
                                    placeholder="Search models..."
                                    value={modelSearchQuery}
                                    onChange={(e) => setModelSearchQuery(e.target.value)}
                                    className="w-full bg-muted/30 border border-border/20 pl-7 pr-3 py-1.5 rounded-lg text-[11px] focus:ring-1 focus:ring-primary/30 outline-none placeholder:text-muted-foreground/30"
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                </div>
                              </div>

                              {/* Model List */}
                              <div className="max-h-[220px] overflow-y-auto px-2 pb-2 space-y-0.5 scrollbar-thin scrollbar-thumb-border">
                                {dynamicProviders.find(p => p.slug === llmProvider)?.models
                                  .filter(m => {
                                    const q = modelSearchQuery.toLowerCase().trim();
                                    if (!q) return true;
                                    return m.name.toLowerCase().includes(q) || m.value.toLowerCase().includes(q) || (q === 'free' && m.is_free);
                                  })
                                  .map(m => (
                                    <button
                                      key={m.value}
                                      onClick={() => {
                                        saveLLMSettings(llmProvider, m.value);
                                        setShowModelDropdown(false);
                                      }}
                                      className={cn(
                                        "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors text-[12px]",
                                        llmModel === m.value
                                          ? "bg-primary text-primary-foreground shadow-md shadow-primary/20 font-bold"
                                          : "hover:bg-muted/50 text-foreground/70 font-medium"
                                      )}
                                    >
                                      <span className="flex-1 min-w-0">
                                        <span className="truncate block">{m.name}</span>
                                        {/* Training-data notice, sourced from
                                            the catalogue row's description
                                            (seeded in `populate_models.py`),
                                            not hard-coded here: every free
                                            Zen model retains or trains on
                                            data, and an agent with mailbox
                                            access could send one your Gmail.
                                            Shown only for opencode free
                                            models — other providers' rows
                                            keep their one-line layout. */}
                                        {llmProvider === 'opencode' && m.is_free && m.description ? (
                                          <span className="block truncate text-[10px] font-normal opacity-70">
                                            {m.description}
                                          </span>
                                        ) : null}
                                      </span>
                                      {m.is_free && (
                                        <span className={cn(
                                          "text-[7px] font-semibold  px-1.5 py-0.5 rounded shrink-0",
                                          llmModel === m.value
                                            ? "bg-primary-foreground/20 text-primary-foreground"
                                            : "bg-success-subtle text-emerald-500 border border-border"
                                        )}>Free</span>
                                      )}
                                    </button>
                                  ))}
                                {(() => {
                                  const filtered = (dynamicProviders.find(p => p.slug === llmProvider)?.models || [])
                                    .filter(m => {
                                      const q = modelSearchQuery.toLowerCase().trim();
                                      if (!q) return true;
                                      return m.name.toLowerCase().includes(q) || m.value.toLowerCase().includes(q) || (q === 'free' && m.is_free);
                                    });
                                  return filtered.length === 0 ? (
                                    <div className="py-6 text-center text-[10px] text-muted-foreground/40 font-medium italic">
                                      No models match "{modelSearchQuery}"
                                    </div>
                                  ) : null;
                                })()}
                              </div>

                              {/* Zen models need the user's own key (no
                                  platform key by design, ToS), so a keyless
                                  user gets a way forward, not just a dimmed
                                  grid. The Credentials page lists the
                                  `opencode` type once seeded; it takes no
                                  pre-selection param, so this is a plain
                                  link. */}
                              {(() => {
                                const current = dynamicProviders.find(p => p.slug === llmProvider);
                                if (!current || current.has_credentials || current.slug !== 'opencode') return null;
                                return (
                                  <div className="px-3 pb-1">
                                    <button
                                      type="button"
                                      onClick={() => { setShowModelDropdown(false); navigate('/credentials'); }}
                                      className="w-full text-center text-[11px] text-primary hover:underline font-medium py-1.5"
                                    >
                                      Add your OpenCode Zen key to use these models
                                    </button>
                                  </div>
                                );
                              })()}

                              {/* Renders nothing when this model has no effort
                                  control, which is most of the catalogue. */}
                              <EffortPicker
                                available={effortLevels}
                                value={llmEffort}
                                onChange={saveEffort}
                              />
                            </div>
                          </>
                        )}
                      </div>
                      )}

                      {/* What is waiting for the running turn. Shown next to
                          the button that queued it, because the message has
                          left the composer and the user needs to see it went
                          somewhere. `dropped` appears only on overflow — a
                          steer someone believes was accepted and that vanished
                          is the failure the mailbox exists to prevent. */}
                      {queuedSteers > 0 && (
                        <span
                          className="mr-1 shrink-0 max-w-[24vw] truncate rounded-full bg-primary/10 px-2 py-0.5 text-[11px]
                                     font-medium tabular-nums text-primary"
                          title="Delivered at the agent's next tool boundary"
                        >
                          {queuedSteers} queued
                        </span>
                      )}
                      {droppedSteers > 0 && (
                        <span
                          className="mr-1 shrink-0 max-w-[24vw] truncate rounded-full bg-warning-subtle px-2 py-0.5 text-[11px]
                                     font-medium tabular-nums text-amber-600 dark:text-amber-400"
                          title="The mailbox was full; the oldest messages were dropped"
                        >
                          {droppedSteers} dropped
                        </span>
                      )}

                      {/* Voice button. Hidden on very narrow phones where it
                          collides with the model picker and send button. */}
                      <button
                        className="hidden min-[380px]:flex w-8 h-8 rounded-full items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-muted/50 transition-colors shrink-0"
                        title="Voice input"
                      >
                        <Mic className="w-4 h-4" />
                      </button>

                      {/* While a turn runs the button means two different
                          things, decided by whether there is text to send:
                          with text it queues a steer, empty it stops the run.
                          Expressed here rather than as a new SendButton state
                          because four other call sites share that component
                          and none of them can steer. */}
                      <SendButton
                        onClick={() => handleSend()}
                        onStop={input.trim() ? undefined : stopGeneration}
                        busy={isLoading && !input.trim()}
                        disabled={!input.trim()}
                        title={
                          isLoading && input.trim()
                            ? 'Send to the running turn'
                            : undefined
                        }
                      />
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </footer>
      </div>
    </div>
    </FilePreviewProvider>
  );
}
