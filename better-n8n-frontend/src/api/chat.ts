import apiClient from './client';
import { streamSse, type SseEvent } from './sse';

import type { CostSource } from './logs';
import type { Payer } from '../lib/cost';

export interface ChatSession {
  id: string;
  title: string;
  llm_provider: string;
  llm_model: string;
  /**
   * How hard the model is asked to think: '' (the model's own default),
   * 'none', 'minimal', 'low', 'medium' or 'high'. Which of those a given model
   * actually offers comes from `AIModel.effort_levels` on `/llm/models/` — a
   * level the model has no rung for is snapped server-side rather than
   * refused, so sending a stale one is safe, just not what was asked.
   */
  llm_effort: string;
  intent: string;
  system_prompt: string;
  /**
   * Gates *recall*, not retention. With this off the assistant answers from the
   * current message alone and loses the history-search tool — but nothing is
   * deleted, so switching it back on restores the full conversation.
   */
  memory_enabled: boolean;
  /**
   * How much this conversation asks before acting: 'ask' (approve side
   * effects), 'auto' (the reviewer may allow clear matches) or 'plan'
   * (mutating tools withheld). Absent on payloads from before the mode
   * picker, which behave as 'ask'.
   */
  autonomy?: string;
  created_at: string;
  updated_at: string;
  messages: ChatMessage[];
  /** Every token this conversation has consumed, across all its turns. */
  total_tokens_used: number;
  /**
   * What the conversation has cost so far, in USD, as a decimal string.
   *
   * Summed from the assistant messages rather than derived from
   * `total_tokens_used`: the model can be changed mid-conversation, so there
   * is no single rate that could be applied to a running token total.
   */
  total_cost_usd: string;
  /**
   * `billed` | `estimated` | `unpriced` (or `''` on a conversation that has
   * not answered yet). One unpriced turn makes the whole total `unpriced` —
   * see `lib/cost.ts`, and never render that as a number.
   */
  cost_source: CostSource | '';
  /** Whose money the total is — see `lib/cost.ts::Payer`. Absent on an older payload. */
  paid_by?: Payer;
}

/** A model-authored HTML snippet, already clamped server-side. */
export interface HtmlArtifact {
  title: string;
  html: string;
  /**
   * Optional: a frame may omit them, and `HtmlArtifact.tsx` already clamps
   * `Number(artifact.width)` to a default. Declaring them required meant the
   * reducer had to invent a number the renderer would then discard.
   */
  width?: number;
  height?: number;
}

/**
 * One step of the plan a run is working to. `blocked` is a real status so a run
 * can finish honestly — without it a model told not to stop with open work
 * marks things done to escape the loop.
 */
/** What the steer endpoint reports back about the run's mailbox. */
export interface SteerResult {
  steered: boolean;
  delivered: number;
  queued: number;
  dropped: number;
}

export interface TodoItem {
  text: string;
  status: 'open' | 'doing' | 'done' | 'blocked';
  /** Which worker owns this step, and which plan task it mirrors (coding lead). */
  owner?: string;
  task_id?: string;
  /** Why a step is blocked (or what it waits on). Shown under the item. */
  note?: string;
}

/** One point on a chart. `y` is null where the value is unknown, which the
 *  renderer draws as a gap — a missing measurement and a measured zero are
 *  different facts. */
export interface ChartPoint {
  x: string;
  y: number | null;
}

export interface ChartSeries {
  name: string;
  points: ChartPoint[];
}

/**
 * A chart the model described as data. The backend validates the spec and the
 * frontend owns every visual decision, which is why nothing here is a colour,
 * a size or a piece of markup — see `components/chat/ChartArtifact.tsx`.
 */
export interface ChartSpec {
  kind: 'bar' | 'column' | 'line' | 'area' | 'scatter' | 'pie';
  title: string;
  series: ChartSeries[];
  x_label?: string;
  y_label?: string;
  stacked?: boolean;
  note?: string;
}

/**
 * What an assistant message carries besides its text.
 *
 * This was `Record<string, any>`, which meant every read in the transcript —
 * `metadata.tool_trace.length`, `metadata.images`, `metadata.thinking` — was
 * unchecked, and a backend rename would surface as a blank panel rather than a
 * build failure. The fields below are exactly the ones the UI reads; the index
 * signature keeps forward compatibility with anything the backend adds that
 * nothing renders yet.
 */
export interface ChatSource {
  url: string;
  title?: string;
  snippet?: string;
  thumbnail?: string;
  favicon?: string;
  /** Two spellings arrive from different search backends; the UI reads both. */
  publisher?: string;
  source?: string;
}

export interface ToolTraceEntry {
  tool?: string;
  iteration?: number;
  summary?: string;
  thought?: string;
  args?: { query?: string; question?: string; [key: string]: unknown };
  /** The plan step in progress when this call was made. */
  step?: string;
  [key: string]: unknown;
}

export interface CodeExecutionEntry {
  iteration?: number;
  code?: string;
  output?: string;
  /** Older runs stored stdout under `result`; both spellings are rendered. */
  result?: string;
  error?: string;
  [key: string]: unknown;
}

export interface ChatMediaItem {
  url?: string;
  /** Image results name the file under `image`, page results under `url`. */
  image?: string;
  thumbnail?: string;
  title?: string;
  /** Where it came from; two spellings, as with `ChatSource`. */
  publisher?: string;
  source?: string;
  [key: string]: unknown;
}

/**
 * A file the turn wrote or edited — one entry per document, built by
 * `chat/turn/agent.py::_on_file`. `document_id` is what the card links by;
 * `path` is for display, and is what the model called it.
 */
export interface FileCardData {
  document_id: number;
  path: string;
  name: string;
  action: 'created' | 'updated' | 'appended' | 'edited';
  chars?: number | null;
  /** Before/after text of each edit, capped server-side. */
  edits?: { old: string; new: string; replacements?: number }[];
  /** Edits past the kept number, counted rather than stored. */
  edits_omitted?: number;
  /** Set for a rendered binary (`render_deck` & co.): its file type and size. */
  type?: 'pptx' | 'xlsx' | 'docx' | 'pdf' | 'image';
  bytes?: number | null;
}

export interface ChatMessageMetadata {
  sources?: ChatSource[];
  images?: ChatMediaItem[];
  videos?: ChatMediaItem[];
  thinking?: string;
  summary?: string;
  model?: string;
  tool_trace?: ToolTraceEntry[];
  code_executions?: CodeExecutionEntry[];
  has_code_execution?: boolean;
  has_extracted_text?: boolean;
  file_type?: string;
  html_artifacts?: HtmlArtifact[];
  charts?: ChartSpec[];
  todos?: TodoItem[];
  /** Every revision of the plan, oldest first (`todos.record_revision`). */
  todo_history?: { n?: number; todos?: TodoItem[] }[];
  files?: FileCardData[];
  follow_ups?: string[];
  [key: string]: unknown;
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata: ChatMessageMetadata;
  created_at: string;
  /**
   * What this one answer cost. Optional because they are absent in two honest
   * cases: an optimistic message this client just built and has not yet sent,
   * and a message stored before cost was recorded. From the server an
   * assistant row always carries them, and a user row carries zeroes with an
   * empty `cost_source` — which renders as nothing at all either way.
   */
  model_id?: string;
  input_tokens?: number;
  output_tokens?: number;
  cached_read_tokens?: number;
  cached_write_tokens?: number;
  cost_usd?: string;
  cost_source?: CostSource | '';
  paid_by?: Payer;
}

/** What `POST /chat/sessions/{id}/upload/` answers. */
export interface UploadResult {
  status?: string;
  document_id?: number;
  [key: string]: unknown;
}

/**
 * A session as the history list returns it: no transcript. The list used to
 * nest every message of every conversation to render a sidebar of titles; the
 * transcript now comes only from `getSession`, which is what opening a
 * conversation already calls.
 */
export type ChatSessionSummary = Omit<ChatSession, 'messages'>;

/**
 * The list is paginated at 20 and this used to read page one only, so a
 * user's 21st-oldest conversation could not be reached. Pages are small now
 * (no transcripts), but still bounded: this is a sidebar, not an export.
 */
const SESSION_LIST_MAX_PAGES = 10;

export const chatService = {
  async getSessions(): Promise<ChatSessionSummary[]> {
    const sessions: ChatSessionSummary[] = [];
    for (let page = 1; page <= SESSION_LIST_MAX_PAGES; page++) {
      // Paginated or bare, depending on the view: hence the two shapes rather
      // than `any`.
      const response = await apiClient.get<
        ChatSessionSummary[] | { results: ChatSessionSummary[]; next: string | null }
      >('/chat/sessions/', { params: { page } });
      const data = response.data;
      if (Array.isArray(data)) return data;
      sessions.push(...data.results);
      if (!data.next) break;
    }
    return sessions;
  },

  async getSession(id: string): Promise<ChatSession> {
    const response = await apiClient.get<ChatSession>(`/chat/sessions/${id}/`);
    return response.data;
  },

  async createSession(data: Partial<ChatSession>): Promise<ChatSession> {
    const response = await apiClient.post<ChatSession>('/chat/sessions/', data);
    return response.data;
  },

  async updateSession(id: string, data: Partial<ChatSession>): Promise<ChatSession> {
    const response = await apiClient.patch<ChatSession>(`/chat/sessions/${id}/`, data);
    return response.data;
  },

  async deleteSession(id: string): Promise<void> {
    await apiClient.delete(`/chat/sessions/${id}/`);
  },

  async deleteMessage(sessionId: string, messageId: number, rewind: boolean = false, rewindAfter: boolean = false): Promise<void> {
    const url = rewindAfter
      ? `/chat/sessions/${sessionId}/messages/${messageId}/?rewind_after=true`
      : rewind 
      ? `/chat/sessions/${sessionId}/messages/${messageId}/?rewind=true` 
      : `/chat/sessions/${sessionId}/messages/${messageId}/`;
    await apiClient.delete(url);
  },

  /**
   * Stream a message via SSE. Calls onEvent for each parsed event.
   * Event types: the `Event` enum in `Backend/chat/events.py` — status,
   * thinking_chunk, content_chunk, content_reset, agent_trace, sources_update,
   * images_update, videos_update, html_artifact, chart, todos_update, files_update,
   * attachments_blocked,
   * ask_permission, done, error.
   */
  async sendMessageStream(
    sessionId: string,
    content: string,
    intent: string | undefined,
    onEvent: (event: SseEvent) => void,
    reference?: { message_id: number; snippet: string },
    signal?: AbortSignal,
    llmProvider?: string,
    llmModel?: string,
    approveToolCall?: string,
    /** Approve *and* stop asking about this tool. Only read alongside an approval. */
    rememberApproval?: boolean,
    /**
     * Reasoning effort. Appended last rather than placed beside `llmModel`
     * because this list is positional and moving anything would silently
     * reassign every existing call's arguments.
     *
     * `undefined` means "say nothing", so the session's stored level stands.
     * `''` is an explicit request for the model's default and is what clears a
     * stored level — which is why the check below is on `!== undefined` and
     * not on truthiness.
     */
    llmEffort?: string,
    /**
     * Everything added after the positional list stopped being readable.
     * One object rather than three more slots, because the note above is
     * right — appending to a positional list is how a later edit silently
     * reassigns every existing call's arguments.
     */
    extras?: {
      /** 'once' | 'session' | 'always'. Supersedes `rememberApproval`. */
      approvalScope?: string;
      /** Decline a paused call and let the turn carry on without it. */
      rejectToolCall?: string;
      rejectReason?: string;
      /** A slash command: `{ name, args, text }`. Chips carry ids. */
      command?: { name: string; args?: Record<string, unknown>; text?: string };
      /** Regenerate this answer with the same command attached. */
      regenerateOf?: number;
      /** Answer an `ask_user` question card: its call id and the value. */
      answerToolCall?: string;
      answer?: string | number | string[];
    },
  ): Promise<void> {
    const body: Record<string, unknown> = { content };
    if (intent && intent !== 'normal') body.intent = intent;
    if (reference) body.reference = reference;
    if (llmProvider) body.llm_provider = llmProvider;
    if (llmModel) body.llm_model = llmModel;
    if (llmEffort !== undefined) body.llm_effort = llmEffort;
    if (approveToolCall) body.approve_tool_call = approveToolCall;
    if (approveToolCall && rememberApproval) body.remember_approval = true;
    if (approveToolCall && extras?.approvalScope) {
      body.approval_scope = extras.approvalScope;
    }
    if (extras?.rejectToolCall) {
      body.reject_tool_call = extras.rejectToolCall;
      if (extras.rejectReason) body.reject_reason = extras.rejectReason;
    }
    // A slash command the palette resolved. The backend re-resolves it —
    // chips carry ids so a chosen name is never re-parsed — and a failure
    // is a 400 under the input, never a model turn.
    if (extras?.command) body.command = extras.command;
    if (extras?.regenerateOf != null) body.regenerate_of = extras.regenerateOf;
    if (extras?.answerToolCall) {
      body.answer_tool_call = extras.answerToolCall;
      body.answer = extras.answer;
    }

    return streamSse({
      path: `/chat/sessions/${sessionId}/message/stream/`,
      body,
      onEvent,
      signal,
    });
  },

  /**
   * Re-attach to a turn that is still running on the server.
   *
   * The turn outlives the request that started it, so after a reload (or any
   * navigation that killed the original `fetch`) this replays every frame it
   * has emitted and then follows it live. A stream that closes without frames
   * means the turn already finished and the transcript has the answer.
   */
  async attachStream(
    sessionId: string,
    onEvent: (event: SseEvent) => void,
    signal?: AbortSignal,
    fromIndex = 0,
  ): Promise<void> {
    return streamSse({
      path: `/chat/sessions/${sessionId}/message/attach/`,
      body: { from: fromIndex },
      onEvent,
      signal,
    });
  },

  /**
   * Stop the running turn. The only thing that cancels server-side work —
   * dropping the connection no longer does. Whatever streamed so far is saved
   * as an `interrupted` answer.
   */
  async stopStream(sessionId: string): Promise<{ stopped: boolean; ai_response: ChatMessage | null }> {
    const response = await apiClient.post(`/chat/sessions/${sessionId}/message/stop/`);
    return response.data;
  },

  /**
   * Say something to a turn that is already running.
   *
   * Not a second message: two turns on one session would interleave into one
   * transcript. This lands in the run's mailbox and the graph picks it up at
   * its next tool boundary — same turn, same answer, no restart.
   *
   * Queued rather than last-write-wins, so sending three follow-ups while the
   * agent works delivers all three in order. `dropped` is non-zero only when
   * the mailbox overflowed, which is worth surfacing: an instruction the user
   * believes was accepted and that vanished is the failure the mailbox exists
   * to prevent.
   */
  async steer(sessionId: string, message: string): Promise<SteerResult> {
    const response = await apiClient.post<SteerResult>(
      `/chat/sessions/${sessionId}/message/steer/`, { message },
    );
    return response.data;
  },

  /**
   * Switch how much the running turn asks, mid-run. Rides the same mailbox
   * as a steer and stands for the rest of the run: 'ask' | 'auto' | 'review'.
   * 'plan' is refused (the toolbox is already built) — pick it before sending.
   */
  async setAutonomy(sessionId: string, level: string): Promise<{ autonomy: string }> {
    const response = await apiClient.post<{ autonomy: string }>(
      `/chat/sessions/${sessionId}/message/steer/`, { autonomy: level },
    );
    return response.data;
  },

  /** Session ids whose turn is still running server-side, for re-attaching. */
  async getActiveRuns(): Promise<string[]> {
    const response = await apiClient.get<{ active: string[] }>('/chat/runs/');
    return response.data.active ?? [];
  },

  async uploadFile(sessionId: string, file: File): Promise<UploadResult> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await apiClient.post(`/chat/sessions/${sessionId}/upload/`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  // --- Guest (unauthenticated) chat ---
  //
  // The backend pins guest chat to one provider and one model
  // (chat/guest/runtime.py), so nothing here sends one. The pair the UI shows
  // lives in hooks/useChatModelSelection.ts.
  guest: {
    async createSession(title: string = 'New Chat'): Promise<ChatSession> {
      const response = await apiClient.post<ChatSession>('/chat/guest/sessions/', { title });
      return response.data;
    },

    async getSession(id: string): Promise<ChatSession> {
      const response = await apiClient.get<ChatSession>(`/chat/guest/sessions/${id}/`);
      return response.data;
    },

    async sendMessageStream(
      sessionId: string,
      content: string,
      onEvent: (event: SseEvent) => void,
      signal?: AbortSignal,
    ): Promise<void> {
      return streamSse({
        path: `/chat/guest/sessions/${sessionId}/message/stream/`,
        body: { content },
        onEvent,
        signal,
        authenticated: false,
      });
    },
  },
};
