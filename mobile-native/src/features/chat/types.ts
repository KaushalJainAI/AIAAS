/**
 * Wire types for the chat endpoints, trimmed to what the phone reads.
 * Mirrors better-n8n-frontend/src/api/chat.ts and Backend/chat/turn/events.py.
 * Ids arrive as numbers from the list and as strings in routes; compare with
 * String(id) everywhere.
 */

export interface Page<T> {
  results: T[];
  next: string | null;
}

/** What `run_state` on the session list means. `waiting` = paused on a person. */
export type ChatRunState = 'running' | 'waiting' | 'idle';

export interface ChatSessionSummary {
  id: string | number;
  title: string;
  llm_model: string;
  total_cost_usd: string;
  created_at: string;
  updated_at: string;
  run_state?: ChatRunState;
  last_agent?: string | null;
}

export type TodoStatus = 'open' | 'doing' | 'done' | 'blocked';

export interface TodoItem {
  text: string;
  status: TodoStatus;
  owner?: string;
  note?: string;
}

/** A web source the answer cites. `url` is the only required field. */
export interface ChatSource {
  url: string;
  title?: string;
  snippet?: string;
  thumbnail?: string;
  publisher?: string;
}

/** An image the turn found or produced. Either `image` or `url` names it. */
export interface ChatImage {
  url?: string;
  image?: string;
  thumbnail?: string;
  title?: string;
}

/** A file the turn wrote or edited: one entry per document. */
export interface FileCard {
  document_id: number;
  path: string;
  name: string;
  action: 'created' | 'updated' | 'appended' | 'edited';
  type?: string;
  bytes?: number | null;
}

export interface ChartPoint {
  x: string;
  /** null is a gap: a missing measurement, not a zero. */
  y: number | null;
}

export interface ChartSeries {
  name: string;
  points: ChartPoint[];
}

export type ChartKind = 'bar' | 'column' | 'line' | 'area' | 'scatter' | 'pie';

/** A chart the model described as data. The phone owns every visual decision. */
export interface ChartSpec {
  kind: ChartKind;
  title: string;
  series: ChartSeries[];
  x_label?: string;
  y_label?: string;
  stacked?: boolean;
  note?: string;
}

/** A model-written HTML page, drawn in a locked-down WebView. */
export interface HtmlArtifact {
  title: string;
  html: string;
}

/** A team solution the turn read. "Checked", not "cited". */
export interface SolutionUsed {
  id: number;
  problem: string;
  solved_by: string;
  last_known_true: string | null;
  checks_needed: number;
  doubtful: boolean;
}

/** One attachment the chosen model could not take. */
export interface BlockedAttachment {
  id?: number;
  name?: string;
  reason?: string;
}

export interface WorkerPlan {
  execution_id: string;
  agent_name: string;
  todos: TodoItem[];
}

/** A delegated agent run, as its card shows it. */
export interface AgentRunCardData {
  agent_name: string;
  execution_id: string;
  status: string;
}

export interface ChatMessageMetadata {
  thinking?: string;
  todos?: TodoItem[];
  sources?: ChatSource[];
  images?: ChatImage[];
  charts?: ChartSpec[];
  html_artifacts?: HtmlArtifact[];
  files?: FileCard[];
  worker_plans?: Record<string, { agent_name?: string; todos?: TodoItem[] }>;
  solutions_used?: SolutionUsed[];
  model?: string;
  elapsed_ms?: number;
  steps?: number;
  agent_run?: { agent_name?: string; execution_id?: string; status?: string };
  [key: string]: unknown;
}

export interface ChatFeedback {
  rating: number;
  reason: string;
  comment: string;
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
  metadata: ChatMessageMetadata;
  cost_usd?: string;
  feedback?: ChatFeedback | null;
}

export interface ChatSessionDetail extends ChatSessionSummary {
  messages: ChatMessage[];
  /** `ask` | `auto` | `plan` | `full`. Absent on older payloads, which read as `ask`. */
  autonomy?: string;
  llm_provider?: string;
  llm_effort?: string;
  memory_enabled?: boolean;
  system_prompt?: string;
  org?: number | null;
  share_solutions?: boolean;
}

export interface SteerResult {
  steered: boolean;
  delivered: number;
  queued: number;
  dropped: number;
}

export interface ToolCallField {
  label: string;
  value: string;
}

/** An `ask_permission` frame, read into what the approval card shows. */
export interface PendingApproval {
  callId: string;
  tool: string;
  title: string;
  sentence: string;
  fields: ToolCallField[];
  actionLabel: string;
  effect?: 'read' | 'reversible' | 'irreversible';
  leavesWorkspace: boolean;
  firstContact: boolean;
}

export type QuestionKind = 'choice' | 'multi_choice' | 'number' | 'text';

/** An `ask_question` frame, read into what the question card shows. */
export interface PendingQuestion {
  callId: string;
  question: string;
  assumption?: string;
  kind: QuestionKind;
  options: string[];
  allowOther: boolean;
  min: number | null;
  max: number | null;
  unit: string;
}

export type QuestionAnswer = string | number | string[];

// --- slash commands -----------------------------------------------------------

export interface CommandArgDef {
  name: string;
  kind: string;
  required: boolean;
  hint?: string;
  default?: unknown;
}

export interface CommandDef {
  name: string;
  summary: string;
  kind: 'client' | 'action' | 'turn';
  group: string;
  aliases?: string[];
  args?: CommandArgDef[];
  requires?: string | null;
  guest?: boolean;
}

/** One picked entity: the label the user saw and the id the server resolves. */
export interface CommandChip {
  arg: string;
  id: string;
  label: string;
}

/** A completion candidate from `/chat/commands/complete/`. */
export interface CommandCandidate {
  value: string;
  label: string;
}

/** A card the server sends back for an action command or a confirm sheet. */
export interface CommandCardData {
  type: string;
  [key: string]: unknown;
}
