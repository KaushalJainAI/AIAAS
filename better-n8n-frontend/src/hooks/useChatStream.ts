/**
 * In-flight state for one streamed assistant turn.
 *
 * These eleven fields were eleven `useState` slices in `StandaloneChat`, mutated
 * by a switch over SSE event types and then cleared field-by-field in three
 * different places. Two of those reset blocks had already drifted out of sync
 * with each other. As a reducer the transitions are declared once and `reset` is
 * a single action, so a new live field cannot be half-wired.
 *
 * Cross-cutting effects of a stream event — appending to the transcript, the
 * loading flag, session intent — stay with the component; this hook owns only
 * the state that lives and dies with the turn.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { ChartSpec, FileCardData, TodoItem, HtmlArtifact as HtmlArtifactData } from '../api/chat';
import type { ChatMediaItem, CodeExecutionEntry } from '../api/chat';
import { toQuestionSpec, type QuestionSpec } from '../lib/question';
import { appendRevision } from '../lib/planView';

/**
 * One frame off the SSE wire. The payload shape varies per `type` and is not
 * described by any shared schema, so fields are read defensively rather than
 * modelled as a discriminated union that would drift from the backend.
 *
 * The index type is `unknown`, not `any`. That is what forces every read below
 * through `str()` / `arr()`, and it closed a real defect: `state.content +
 * event.content` on a frame that omitted `content` appended the literal string
 * "undefined" to the user's answer, and nothing typed as `any` would ever have
 * complained.
 */
export type StreamEvent = { type: string } & Record<string, unknown>;

/** A frame field as a string, or '' — never the text "undefined". */
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * A frame field as an array. The cast is the one unavoidable assertion in this
 * file: the wire carries no schema, so `Array.isArray` is the only check
 * available and the element type is the caller's expectation, not a guarantee.
 */
const arr = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

/** A frame field as a plain object, for tool arguments. */
const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** A frame field as a number, or undefined when absent or malformed. */
const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

export interface StreamActivity {
  type: 'tool' | 'thought';
  tool?: string;
  args?: Record<string, unknown>;
  iteration?: number;
  thought?: string;
  /** The plan step in progress when the call was made (`agent.py::_plan_calls`). */
  step?: string;
}

/**
 * One attachment the chosen model could not accept. Carries its id so the
 * agent can be told which file it is; see `history.describe_for_model`.
 */
export interface BlockedAttachment {
  id?: number;
  name?: string;
  reason?: string;
  [key: string]: unknown;
}

export interface StreamSource {
  title: string;
  url: string;
  snippet?: string;
  thumbnail?: string;
  favicon?: string;
}

export interface PendingToolCall {
  tool: string;
  args: Record<string, unknown>;
  call_id: string;
  /**
   * What the assistant is asking to do, rendered by the backend
   * (`chat.tools.describe`). Optional because a turn streamed by a server that
   * predates it carries none, and the card falls back to the tool name.
   */
  detail?: ToolCallDetail | null;
}

/** A delegated agent run started by `/agent`, while it is going. */
export interface LiveAgentRun {
  agent_id: number;
  agent_name: string;
  execution_id: string;
  status: string;
}

/** A command card: mission, status, cost, memory, findings, confirm sheet. */
export interface LiveCommandCard {
  type: string;
  [key: string]: unknown;
}

/** One tool call as a person reads it. Built server-side, never in a renderer. */
export interface ToolCallDetail {
  title: string;
  sentence: string;
  server: string;
  tool: string;
  fields: { label: string; value: string }[];
}

export interface ChatStreamState {
  status: { phase: string; message: string } | null;
  activity: StreamActivity[];
  sources: StreamSource[];
  images: ChatMediaItem[];
  videos: ChatMediaItem[];
  thinking: string;
  content: string;
  /**
   * Reserved: no current backend event populates this, so the code-execution
   * panel that reads it stays collapsed. Kept so the field does not have to be
   * re-threaded when the backend starts emitting it.
   */
  codeExecutions: CodeExecutionEntry[];
  artifacts: HtmlArtifactData[];
  charts: ChartSpec[];
  todos: TodoItem[];
  /** Every distinct revision of the plan this turn, oldest first. */
  todoHistory: TodoItem[][];
  files: FileCardData[];
  blockedAttachments: { message: string; items: BlockedAttachment[] } | null;
  pendingToolCall: PendingToolCall | null;
  /** An `ask_user` question the run paused on, drawn as a question card. */
  pendingQuestion: QuestionSpec | null;
  /** `/agent` delegation while it runs: the run card. Replaced wholesale. */
  agentRun: LiveAgentRun | null;
  /** The latest command card (mission, status, cost, findings, confirm). */
  commandCard: LiveCommandCard | null;
}

const EMPTY: ChatStreamState = {
  status: null,
  activity: [],
  sources: [],
  images: [],
  videos: [],
  thinking: '',
  content: '',
  codeExecutions: [],
  artifacts: [],
  charts: [],
  todos: [],
  todoHistory: [],
  files: [],
  blockedAttachments: null,
  pendingToolCall: null,
  pendingQuestion: null,
  agentRun: null,
  commandCard: null,
};

type Action =
  | { type: 'event'; event: StreamEvent }
  | { type: 'reset' }
  | { type: 'events'; events: StreamEvent[] }
  | { type: 'clearStatus' }
  | { type: 'clearPendingToolCall' }
  | { type: 'clearPendingQuestion' }
  | { type: 'dismissBlockedAttachments' };

/** Consecutive `thought` traces collapse into one entry rather than stacking. */
function appendActivity(activity: StreamActivity[], event: StreamEvent): StreamActivity[] {
  if (event.sub_type === 'thought') {
    const last = activity[activity.length - 1];
    if (last?.type === 'thought') {
      return [...activity.slice(0, -1), { ...last, thought: str(event.content) }];
    }
    return [...activity, { type: 'thought', thought: str(event.content) }];
  }
  return [
    ...activity,
    {
      type: 'tool',
      tool: str(event.tool),
      args: obj(event.args),
      iteration: num(event.iteration),
      thought: str(event.thought),
      ...(typeof event.step === 'string' && event.step ? { step: event.step } : {}),
    },
  ];
}

function reduceEvent(state: ChatStreamState, event: StreamEvent): ChatStreamState {
  switch (event.type) {
    case 'status':
      return { ...state, status: { phase: str(event.phase), message: str(event.message) } };
    case 'thinking_chunk':
      return { ...state, thinking: state.thinking + str(event.content) };
    case 'content_chunk':
      return { ...state, content: state.content + str(event.content) };
    case 'content_reset':
      // What streamed was a preamble to a tool call ("let me search for..."),
      // not the answer. Drop it so the real answer starts from a clean buffer.
      return { ...state, content: '' };
    case 'agent_trace':
      return { ...state, activity: appendActivity(state.activity, event) };
    case 'sources_update':
      return { ...state, sources: arr<StreamSource>(event.sources) };
    case 'images_update':
      return { ...state, images: arr<ChatMediaItem>(event.images) };
    case 'videos_update':
      return { ...state, videos: arr<ChatMediaItem>(event.videos) };
    case 'html_artifact':
      return {
        ...state,
        artifacts: [
          ...state.artifacts,
          {
            title: str(event.title),
            html: str(event.html),
            width: num(event.width),
            height: num(event.height),
          },
        ],
      };
    case 'todos_update':
      // Replaced wholesale, never merged: `update_todos` replaces the whole
      // list every time, so applying this as a delta would reconstruct a state
      // the server never sent.
    {
      const todos = arr<TodoItem>(event.todos);
      return { ...state, todos, todoHistory: appendRevision(state.todoHistory, todos) };
    }
    case 'files_update':
      // Whole list, like todos: a second write to one file updates its entry
      // on the server, so appending here would show it twice.
      return { ...state, files: arr<FileCardData>(event.files) };
    case 'chart':
      // The whole spec is appended as sent. Charts are not merged or deduped:
      // a turn that draws two charts meant two charts, and the backend has
      // already validated each one.
      return {
        ...state,
        charts: [...state.charts, event as unknown as ChartSpec],
      };
    case 'attachments_blocked':
      // Persistent, not a transient toast: the user needs to still see this
      // while they go and change the model, which is the action it asks for.
      return {
        ...state,
        blockedAttachments: {
          message: str(event.message),
          items: arr<BlockedAttachment>(event.items),
        },
      };
    case 'ask_permission':
      return {
        ...state,
        pendingToolCall: {
          tool: str(event.tool),
          args: obj(event.args),
          call_id: str(event.call_id),
          detail: (event.detail as ToolCallDetail | undefined) ?? null,
        },
      };
    case 'ask_question':
      return { ...state, pendingQuestion: toQuestionSpec(event) };
    case 'agent_run': {
      const run = (event.agent_run ?? event) as Record<string, unknown>;
      return {
        ...state,
        agentRun: {
          agent_id: Number(run['agent_id'] ?? 0) || 0,
          agent_name: str(run['agent_name']),
          execution_id: str(run['execution_id']),
          status: str(run['status']) || 'running',
        },
      };
    }
    case 'command_card':
      return {
        ...state,
        commandCard: (event.card ?? event) as LiveCommandCard,
      };
    case 'done':
      // The turn is over, so everything transient goes. Two survive: a
      // blocked-attachment notice describes the turn that just finished, and an
      // outstanding approval card is dismissed by whoever answers it.
      return {
        ...EMPTY,
        blockedAttachments: state.blockedAttachments,
        pendingToolCall: state.pendingToolCall,
        // A question is answered by the person, like an approval, so it
        // outlives the turn that asked it.
        pendingQuestion: state.pendingQuestion,
        // The run card and the command card describe the turn that just
        // finished, like the blocked-attachment notice — a reload reads them
        // from the persisted message, but the live view keeps them too.
        agentRun: state.agentRun,
        commandCard: state.commandCard,
      };
    case 'error':
      return { ...state, status: null };
    default:
      return state;
  }
}

function reducer(state: ChatStreamState, action: Action): ChatStreamState {
  switch (action.type) {
    case 'event':
      return reduceEvent(state, action.event);
    case 'events':
      return action.events.reduce(reduceEvent, state);
    case 'reset':
      return EMPTY;
    case 'clearStatus':
      return { ...state, status: null };
    case 'clearPendingToolCall':
      return { ...state, pendingToolCall: null };
    case 'clearPendingQuestion':
      return { ...state, pendingQuestion: null };
    case 'dismissBlockedAttachments':
      return { ...state, blockedAttachments: null };
  }
}

/**
 * Token frames. A provider streams one per token, often each in its own network
 * read, and every one used to be its own dispatch: a re-render of the whole
 * chat page per token, with the live answer's markdown re-parsed each time.
 * These are folded once per animation frame instead, which is as often as the
 * screen can show them anyway.
 */
const COALESCED = new Set(['content_chunk', 'thinking_chunk']);

const scheduleFrame = (callback: () => void): number =>
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(callback)
    : (setTimeout(callback, 16) as unknown as number);

const cancelFrame = (handle: number): void => {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
  else clearTimeout(handle);
};

export function useChatStream() {
  const [live, dispatch] = useReducer(reducer, EMPTY);
  const pending = useRef<StreamEvent[]>([]);
  const frame = useRef<number | null>(null);

  /** Applies buffered token frames now, ahead of whatever comes next. */
  const flush = useCallback(() => {
    if (frame.current !== null) {
      cancelFrame(frame.current);
      frame.current = null;
    }
    if (pending.current.length === 0) return;
    const events = pending.current;
    pending.current = [];
    dispatch({ type: 'events', events });
  }, []);

  useEffect(() => () => {
    if (frame.current !== null) cancelFrame(frame.current);
  }, []);

  const applyEvent = useCallback((event: StreamEvent) => {
    if (COALESCED.has(event.type)) {
      pending.current.push(event);
      if (frame.current === null) frame.current = scheduleFrame(flush);
      return;
    }
    // Order is the fold's contract: buffered tokens land before any other
    // frame, so a `content_reset` or `done` never sees a buffer from before it
    // arrive after it.
    flush();
    dispatch({ type: 'event', event });
  }, [flush]);

  const reset = useCallback(() => {
    if (frame.current !== null) {
      cancelFrame(frame.current);
      frame.current = null;
    }
    // Tokens from the turn being discarded must not land in the next one.
    pending.current = [];
    dispatch({ type: 'reset' });
  }, []);
  const clearStatus = useCallback(() => dispatch({ type: 'clearStatus' }), []);
  const clearPendingToolCall = useCallback(() => dispatch({ type: 'clearPendingToolCall' }), []);
  const clearPendingQuestion = useCallback(() => dispatch({ type: 'clearPendingQuestion' }), []);
  const dismissBlockedAttachments = useCallback(
    () => dispatch({ type: 'dismissBlockedAttachments' }),
    [],
  );

  return useMemo(
    () => ({
      live, applyEvent, reset, clearStatus, clearPendingToolCall, clearPendingQuestion,
      dismissBlockedAttachments,
    }),
    [live, applyEvent, reset, clearStatus, clearPendingToolCall, clearPendingQuestion,
      dismissBlockedAttachments],
  );
}
