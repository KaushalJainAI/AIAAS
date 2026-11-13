/**
 * One streamed assistant turn on the phone.
 *
 * `reduceFrame` is the pure fold of stream frames into the live state (exported
 * so it can be read and tested without a network or a screen). `useChatTurn`
 * owns the network side: it opens or re-attaches a turn, batches token frames,
 * writes finished messages into the react-query cache, and exposes the actions
 * a screen needs (send, approve, reject, answer, steer, stop).
 *
 * Every frame the web chat draws is folded here: status, thinking, the answer,
 * plan, sources, images, charts, HTML previews, file cards, worker plans, team
 * solutions, blocked attachments, approvals, questions, agent and command
 * cards. Keep-alives and unknown frames are ignored on purpose.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import { ApiError } from '../../api/client';
import { StreamRequestError, type SseEvent } from '../../api/sse';
import { followTurn } from './followTurn';
import {
  activeRunIds,
  attachTurnStream,
  chatKeys,
  sendTurnStream,
  steerTurn,
  stopTurn,
} from './chatApi';
import {
  arr,
  parseApproval,
  parseArtifacts,
  parseBlocked,
  parseChart,
  parseCommandCard,
  parseFiles,
  parseImages,
  parseQuestion,
  parseSolutions,
  parseSources,
  parseTodos,
  str,
  obj,
} from './frames';
import type {
  AgentRunCardData,
  BlockedAttachment,
  ChartSpec,
  ChatImage,
  ChatMessage,
  ChatSessionDetail,
  ChatSource,
  CommandCardData,
  FileCard,
  HtmlArtifact,
  PendingApproval,
  PendingQuestion,
  SolutionUsed,
  SteerResult,
  TodoItem,
  WorkerPlan,
} from './types';

// --- pure state fold ----------------------------------------------------------

export interface TurnState {
  /** A turn is running on the server (sent here or re-attached). */
  active: boolean;
  /** The user's message, shown before the server has saved it. */
  pendingUser: string | null;
  status: string | null;
  thinking: string;
  content: string;
  todos: TodoItem[];
  approval: PendingApproval | null;
  question: PendingQuestion | null;
  sources: ChatSource[];
  images: ChatImage[];
  files: FileCard[];
  charts: ChartSpec[];
  htmlArtifacts: HtmlArtifact[];
  workerPlans: WorkerPlan[];
  solutions: SolutionUsed[];
  blocked: { message: string; items: BlockedAttachment[] } | null;
  agentRun: AgentRunCardData | null;
  commandCard: CommandCardData | null;
  error: string | null;
}

export const idleTurn: TurnState = {
  active: false,
  pendingUser: null,
  status: null,
  thinking: '',
  content: '',
  todos: [],
  approval: null,
  question: null,
  sources: [],
  images: [],
  files: [],
  charts: [],
  htmlArtifacts: [],
  workerPlans: [],
  solutions: [],
  blocked: null,
  agentRun: null,
  commandCard: null,
  error: null,
};

export type TurnAction =
  | { type: 'start'; userText: string | null }
  | { type: 'frames'; events: SseEvent[] }
  | { type: 'event'; event: SseEvent }
  | { type: 'finished' }
  | { type: 'failed'; message: string }
  | { type: 'reset' }
  | { type: 'dismissBlocked' };

/** Folds one frame into the state. Unknown frames return the state unchanged. */
export function reduceFrame(state: TurnState, event: SseEvent): TurnState {
  switch (event.type) {
    case 'status':
      return { ...state, status: str(event.message) || null };
    case 'thinking_chunk':
      return { ...state, thinking: state.thinking + str(event.content) };
    case 'content_chunk':
      return { ...state, content: state.content + str(event.content) };
    case 'content_reset':
      // The streamed text was a preamble to a tool call, not the answer.
      return { ...state, content: '' };
    case 'todos_update':
      // Whole list every time: update_todos replaces the list, so never merge.
      return { ...state, todos: parseTodos(event.todos) };
    case 'sources_update':
      return { ...state, sources: parseSources(event.sources) };
    case 'images_update':
      return { ...state, images: parseImages(event.images) };
    case 'files_update':
      // Whole list: a second write to one file updates its entry on the server.
      return { ...state, files: parseFiles(event.files) };
    case 'chart': {
      // The spec is appended as sent: two charts in a turn meant two charts.
      const chart = parseChart(event);
      return chart ? { ...state, charts: [...state.charts, chart] } : state;
    }
    case 'html_artifact': {
      const [artifact] = parseArtifacts([event]);
      return artifact ? { ...state, htmlArtifacts: [...state.htmlArtifacts, artifact] } : state;
    }
    case 'worker_plan': {
      // Whole list per worker, replaced by execution id, like todos.
      const id = str(event.execution_id);
      const todos = parseTodos(event.todos);
      if (!id || todos.length === 0) return state;
      const next: WorkerPlan = { execution_id: id, agent_name: str(event.agent_name) || 'Agent', todos };
      const at = state.workerPlans.findIndex((p) => p.execution_id === id);
      return {
        ...state,
        workerPlans: at < 0 ? [...state.workerPlans, next] : state.workerPlans.map((p, i) => (i === at ? next : p)),
      };
    }
    case 'solutions_update':
      return { ...state, solutions: parseSolutions(event.solutions) };
    case 'attachments_blocked':
      // Stays until dismissed: the person needs it while they change the model.
      return { ...state, blocked: { message: str(event.message), items: parseBlocked(event.items) } };
    case 'agent_run': {
      const run = obj(event.agent_run ?? event);
      const executionId = str(run.execution_id);
      if (!executionId) return state;
      return {
        ...state,
        agentRun: { agent_name: str(run.agent_name) || 'Agent', execution_id: executionId, status: str(run.status) || 'running' },
      };
    }
    case 'command_card': {
      const card = parseCommandCard(event.card ?? event);
      return card ? { ...state, commandCard: card } : state;
    }
    case 'ask_permission': {
      const approval = parseApproval(event);
      return approval ? { ...state, approval } : state;
    }
    case 'ask_question': {
      const question = parseQuestion(event);
      return question ? { ...state, question } : state;
    }
    case 'error':
      return {
        ...state,
        active: false,
        pendingUser: null,
        status: null,
        error: str(event.message) || 'Something went wrong.',
      };
    case 'done':
      // The turn is over. Its answer is saved, so the live extras give way to
      // the saved message. An approval, a question, a blocked-attachment notice
      // and the run and command cards outlive the turn: the person still needs them.
      return {
        ...idleTurn,
        approval: state.approval,
        question: state.question,
        blocked: state.blocked,
        agentRun: state.agentRun,
        commandCard: state.commandCard,
      };
    default:
      return state;
  }
}

export function reduceTurn(state: TurnState, action: TurnAction): TurnState {
  switch (action.type) {
    case 'start':
      return { ...idleTurn, active: true, pendingUser: action.userText };
    case 'frames':
      return action.events.reduce(reduceFrame, state);
    case 'event':
      return reduceFrame(state, action.event);
    case 'finished':
      return { ...state, active: false, pendingUser: null, status: null };
    case 'failed':
      return { ...state, active: false, pendingUser: null, status: null, error: action.message };
    case 'reset':
      return idleTurn;
    case 'dismissBlocked':
      return { ...state, blocked: null };
  }
}

/** Whether the live turn has anything to draw. Used to decide if it takes a row in the transcript. */
export function hasLiveContent(state: TurnState): boolean {
  return (
    state.active ||
    state.content !== '' ||
    state.thinking !== '' ||
    state.todos.length > 0 ||
    state.sources.length > 0 ||
    state.images.length > 0 ||
    state.files.length > 0 ||
    state.charts.length > 0 ||
    state.htmlArtifacts.length > 0 ||
    state.workerPlans.length > 0 ||
    state.solutions.length > 0 ||
    state.blocked !== null ||
    state.agentRun !== null ||
    state.commandCard !== null ||
    state.approval !== null ||
    state.question !== null ||
    state.error !== null
  );
}

// --- the hook -----------------------------------------------------------------

/** Token frames are folded in batches this often, not one dispatch each. */
const FRAME_MS = 16;
const COALESCED = new Set(['content_chunk', 'thinking_chunk']);

export interface TurnOptions {
  /** The run read these steers too late: the text goes back into the composer. */
  onSteersReturned?: (texts: string[]) => void;
  /** The server refused the request before a turn started. Show why; the text goes back. */
  onRefused?: (error: Error, userText: string | null) => void;
}

/** Extra fields a send carries: a slash command the server resolves. */
export interface SendExtras {
  command?: { name: string; args: Record<string, unknown>; text: string };
}

type Job =
  | { kind: 'send'; body: Record<string, unknown>; userText: string | null }
  | { kind: 'attach' };

/** Adds messages to a transcript unless already present (replays repeat frames). */
function withMessages(messages: ChatMessage[], incoming: unknown[]): ChatMessage[] {
  let next = messages;
  for (const item of incoming) {
    const m = item as ChatMessage | null | undefined;
    if (!m || typeof m.id !== 'number') continue;
    if (!next.some((existing) => existing.id === m.id)) next = [...next, m];
  }
  return next;
}

function isRefusal(err: unknown): boolean {
  return err instanceof StreamRequestError || err instanceof ApiError;
}

export function useChatTurn(sessionId: string, options: TurnOptions = {}) {
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(reduceTurn, idleTurn);

  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const controllerRef = useRef<AbortController | null>(null);
  const queued = useRef<SseEvent[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (queued.current.length === 0) return;
    const events = queued.current;
    queued.current = [];
    dispatch({ type: 'frames', events });
  }, []);

  /** Writes a finished turn into the cached transcript, then reconciles with the server. */
  const applyDone = useCallback(
    (event: SseEvent) => {
      const incoming = [event.user_message, event.ai_response].filter((m) => m != null);
      if (incoming.length > 0) {
        queryClient.setQueryData<ChatSessionDetail>(chatKeys.session(sessionId), (old) =>
          old ? { ...old, messages: withMessages(old.messages, incoming) } : old,
        );
      }
      void queryClient.invalidateQueries({ queryKey: chatKeys.session(sessionId) });
      void queryClient.invalidateQueries({ queryKey: chatKeys.sessions });
    },
    [queryClient, sessionId],
  );

  const handleFrame = useCallback(
    (event: SseEvent, live: boolean) => {
      if (COALESCED.has(event.type)) {
        queued.current.push(event);
        timer.current ??= setTimeout(flush, FRAME_MS);
        return;
      }
      // Buffered tokens land before any other frame, so order is preserved.
      flush();
      if (event.type === 'done') applyDone(event);
      // A replayed frame must not put the same text back in the box twice.
      if (event.type === 'steers_returned' && live) {
        const texts = arr(event.messages).flatMap((m) => (typeof m === 'string' && m.trim() ? [m] : []));
        if (texts.length > 0) optionsRef.current.onSteersReturned?.(texts);
      }
      dispatch({ type: 'event', event });
    },
    [applyDone, flush],
  );

  const run = useCallback(
    async (job: Job) => {
      controllerRef.current?.abort();
      // Tokens still buffered from the stream being replaced must not land in this turn.
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      queued.current = [];

      const controller = new AbortController();
      controllerRef.current = controller;
      const { signal } = controller;
      const live = job.kind === 'send';
      // A frame that arrives after its stream was replaced is stale: drop it.
      const onEvent = (event: SseEvent) => {
        if (!signal.aborted) handleFrame(event, live);
      };

      dispatch({ type: 'start', userText: job.kind === 'send' ? job.userText : null });
      try {
        await followTurn({
          open: (forward) =>
            job.kind === 'send'
              ? sendTurnStream(sessionId, job.body, forward, signal)
              : attachTurnStream(sessionId, 0, forward, signal),
          attach: (forward, from) => attachTurnStream(sessionId, from, forward, signal),
          isRunning: async () => (await activeRunIds()).includes(sessionId),
          onEvent,
          signal,
        });
        if (!signal.aborted) {
          dispatch({ type: 'finished' });
          void queryClient.invalidateQueries({ queryKey: chatKeys.session(sessionId) });
        }
      } catch (err) {
        if (signal.aborted) return;
        const error = err instanceof Error ? err : new Error('Could not reach the server.');
        dispatch({ type: 'failed', message: error.message || 'Could not reach the server.' });
        if (isRefusal(err)) {
          optionsRef.current.onRefused?.(error, job.kind === 'send' ? job.userText : null);
        }
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    },
    [handleFrame, queryClient, sessionId],
  );

  // Re-attach on open if the server still has a turn running for this chat.
  useEffect(() => {
    let cancelled = false;
    activeRunIds()
      .then((ids) => {
        if (!cancelled && ids.includes(sessionId) && !controllerRef.current) {
          void run({ kind: 'attach' });
        }
      })
      .catch(() => {
        // Re-attaching is recovery, not a precondition for reading the chat.
      });
    return () => {
      cancelled = true;
      controllerRef.current?.abort();
      controllerRef.current = null;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      queued.current = [];
    };
  }, [sessionId, run]);

  const send = useCallback(
    (text: string, extras: SendExtras = {}) =>
      run({
        kind: 'send',
        userText: text,
        body: { content: text, ...(extras.command ? { command: extras.command } : {}) },
      }),
    [run],
  );

  const approve = useCallback(
    (callId: string) =>
      run({
        kind: 'send',
        userText: null,
        body: { content: '', approve_tool_call: callId, approval_scope: 'once' },
      }),
    [run],
  );

  /** Declines a paused call. A reason of 'skipped' is how a question is skipped. */
  const reject = useCallback(
    (callId: string, reason?: string) =>
      run({
        kind: 'send',
        userText: null,
        body: { content: '', reject_tool_call: callId, ...(reason ? { reject_reason: reason } : {}) },
      }),
    [run],
  );

  const answer = useCallback(
    (callId: string, value: string | number | string[]) =>
      run({
        kind: 'send',
        userText: null,
        body: { content: '', answer_tool_call: callId, answer: value },
      }),
    [run],
  );

  /** Queues a message for the running turn. Rejects with a 404 if the turn already finished. */
  const steer = useCallback((text: string): Promise<SteerResult> => steerTurn(sessionId, text), [sessionId]);

  /** Stops the running turn. The done frame that follows settles the screen. */
  const stop = useCallback(async () => {
    try {
      await stopTurn(sessionId);
    } catch {
      // Nothing was running server-side. Drop the local reader and re-read the chat.
      controllerRef.current?.abort();
      controllerRef.current = null;
      dispatch({ type: 'reset' });
      void queryClient.invalidateQueries({ queryKey: chatKeys.session(sessionId) });
    }
  }, [queryClient, sessionId]);

  const dismissBlocked = useCallback(() => dispatch({ type: 'dismissBlocked' }), []);

  return useMemo(
    () => ({ state, send, approve, reject, answer, steer, stop, dismissBlocked }),
    [state, send, approve, reject, answer, steer, stop, dismissBlocked],
  );
}

export type ChatTurn = ReturnType<typeof useChatTurn>;
