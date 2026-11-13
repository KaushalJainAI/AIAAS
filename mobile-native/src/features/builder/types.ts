/**
 * Agent configuration: every knob that defines an agent, and the wire shapes the
 * builder reads and writes.
 *
 * Copied from better-n8n-frontend/src/types/agentConfig.ts (AgentConfig and its
 * closed sets), src/api/agents.ts (Agent, AgentInput, AgentRunStarted),
 * src/api/logs.ts (AgentRevision, RevisionDiff, RevisionSummary-shaped entries,
 * CursorPage), src/api/nodeService.ts (AIProvider, AIModel, CatalogueMeta,
 * FallbackModel) and the wizard response types from agents.ts.
 *
 * The wire shape *is* AgentConfig: the backend speaks the same camelCase, so there
 * is no mapping layer to drift.
 */

/** Derived from whether the agent has a schedule. Read-only on the wire. */
export type TriggerMode = 'goal' | 'maintenance';
export type Autonomy = 'plan' | 'review' | 'ask' | 'auto' | 'full';
export type FileAccess = 'none' | 'readonly' | 'scoped' | 'read_all_write_own' | 'full';
/** Lifecycle. `archived` exists on the server and is not offered as a save from the wizard. */
export type AgentStatus = 'draft' | 'active' | 'paused' | 'archived';
/** The closed registry in `agents/contracts.py`. Blank is prose. */
export type OutputContract = '' | 'research' | 'extraction';

/**
 * How much of one connection an agent may use. `all` is everything the connection
 * offers. `read` is derived per turn from the tool's own name. `selected` names
 * tools, and is only offered once the live tool list has loaded.
 */
export type ConnectorMode = 'all' | 'read' | 'selected';

/** Per-tool rule. Absent key means inherit. */
export type ToolPermissionMode = 'allow' | 'ask' | 'deny';

/** A bare id is the legacy shape and means `all`. */
export type ConnectorChoice =
  | number
  | { id: number; mode: ConnectorMode; tools: string[] };

/** The tool grants, one boolean each. Keys match `agents/grants.py::GRANT_TOOLS`. */
export interface ToolGrants {
  codeExecution: boolean;
  shell: boolean;
  webSearch: boolean;
  scrape: boolean;
  fileOps: boolean;
  /** Create decks, workbooks and Word documents in its folder. */
  office: boolean;
  /** Generate images, billed to the user's OpenRouter account. */
  media: boolean;
  /** Publish hosted pages shareable by link. */
  publish: boolean;
  /** A real browser: read JavaScript pages, and act on `browserDomains`. */
  browser: boolean;
  rag: boolean;
  /** The user's own configured MCP servers. Off by default. */
  mcp: boolean;
  /** Transcribe recordings; speak text into audio files. */
  voice: boolean;
  /** Send documents out for e-signature. */
  esign: boolean;
  /** Read, draft and send on Slack, WhatsApp, Teams and SMS. */
  talk: boolean;
  /** Query SQL databases; write only where allowed. */
  data: boolean;
  /** Call HTTP APIs through one generic caller. */
  api: boolean;
  /** Run commands and long jobs on the workspace machine. */
  compute: boolean;
  /** May it hand work to the user's other agents. */
  subAgents: boolean;
}

export interface AgentConfig {
  // Identity
  name: string;
  brief: string;
  /** One line saying what this agent is for. `search_agents` reads it when choosing a delegate. */
  description: string;
  /** Short labels for grouping; also matched by agent search. */
  tags: string[];
  /** draft | active | paused | archived. */
  status: AgentStatus;

  // Model
  provider: string;
  model: string;
  /** 0 = deterministic, 1 = loose. */
  temperature: number;
  /**
   * How hard the model thinks: `''` (the model's own default), `'none'`,
   * `'minimal'`, `'low'`, `'medium'` or `'high'`. Which of those the chosen model
   * offers comes from `AIModel.effort_levels`.
   */
  effort: string;

  // Files
  fileAccess: FileAccess;

  // Tools
  tools: ToolGrants;

  // Context the agent is given
  /** Which connections this agent may reach: `MCPServer` ids. Empty means any the user has. */
  connectors: ConnectorChoice[];
  knowledgeBases: number[];
  /** Which of the user's other agents this one may delegate to. Empty means any. */
  delegatesTo: number[];
  /** The organisation whose team solutions this agent's unattended runs may search. Null is personal. */
  orgId: number | null;
  /** Sites `browser_act` may click and type on. Empty: it may browse but never act. */
  browserDomains: string[];
  /** Vault logins `browser_act` may fill. Empty: none. */
  browserLogins: string[];
  /** Who unattended runs may message. */
  recipients: string[];
  /** Database rows this agent's runs may touch. */
  dataConnections: number[];
  /** HTTP APIs this agent's runs may reach. */
  apiConnections: (number | { id: number; mode: 'read' | 'all' })[];
  dbHosts: string[];
  apiHosts: string[];
  workspaceEgress: string[];
  codeProjects: number[];
  /** Exactly which built-in tools this agent may use. Empty means every tool its grants unlock. */
  toolScope: string[];
  /** Per-tool allow/ask/deny, keyed by built-in tool name. Absent means inherit. */
  toolPermissions: Record<string, ToolPermissionMode>;
  /** Skill ids, not titles. */
  skills: number[];
  useEnvironment: boolean;

  /** What the answer has to come back as. */
  outputContract: OutputContract;
  /** How many pieces of a delegated list this agent works on at once. Null is one at a time. */
  fanoutParallel: number | null;

  // Invocation
  /** Read-only: derived from whether a schedule is set. */
  trigger?: TriggerMode;
  /**
   * The agent's own schedule, as cron. One field, and therefore one schedule. It
   * round-trips the single `origin='builder'` Trigger row. The builder never sends
   * it on save: schedules are owned by the Schedules screen.
   */
  schedule: string;
  /** The IANA zone `schedule` is read in. Also never sent on save. */
  scheduleTimezone: string;
  /** Read-only: how many *other* schedules this agent has. */
  extraSchedules?: number;
  /** Whether anything other than the user may start a run. */
  allowUnattended: boolean;

  // Guardrails
  autonomy: Autonomy;
  notifyOnHitl: boolean;
  spendCapRupees: number;
  /** Wall-clock ceiling on a single run, in seconds. The builder shows minutes. */
  maxRunSeconds: number;

  // Context lifecycle
  /** Which model folds this agent's earlier steps. Empty means the platform default. Set both or neither. */
  summaryModel: string;
  summaryProvider: string;
  recursiveContext: boolean;
  compaction: boolean;
  indexing: boolean;
}

/** An agent as the server returns it: the config, plus what actually happened. */
export interface Agent extends AgentConfig {
  id: number;
  /** Counted from the execution log, not stored. */
  runs: number;
  /** Runs that raised no approval request, i.e. nobody had to be involved. */
  unattended: number;
  /** Credits spent across those runs. */
  spend: number;
  /** Which catalogue entry this was installed from, or null for an agent built by hand. Read-only. */
  template_slug?: string | null;
  /** `retired` when the configured model's catalogue row is inactive. */
  model_status?: 'ok' | 'retired';
  created_at: string;
  updated_at: string;
}

/** What the server accepts on create. Everything read-only is stripped by the caller. */
export type AgentInput = Partial<AgentConfig> & Pick<AgentConfig, 'name'>;

/** What starting a run returns: an id to watch, not an answer. */
export interface AgentRunStarted {
  execution_id: string;
  status: string;
  unserved_grants: string[];
}

/** Keyset-paged list. Only the uncursored first page carries a total. */
export interface CursorPage<T> {
  results: T[];
  count: number | null;
  limit: number;
  next_cursor: string | null;
  has_more: boolean;
}

/** Where a revision came from. */
export type RevisionSource = 'create' | 'update' | 'backfill' | 'restore';

/** `{field: {from, to}}` for every field a revision changed. */
export interface RevisionDiff {
  [field: string]: { from: unknown; to: unknown };
}

/** One change to an agent's configuration, newest first in the history. */
export interface AgentRevision {
  id: number;
  number: number;
  summary: string;
  source: RevisionSource;
  diff: RevisionDiff;
  changed_by: string | null;
  /** Runs that executed under this revision. Has it been tried enough to judge? */
  run_count: number;
  created_at: string;
}

/* ---------- creation wizard (`/orchestrator/agents/wizard/`) ---------- */

export interface WizardQuestion {
  id: string;
  text: string;
  why: string;
  multi: boolean;
  options?: string[];
}

export interface WizardQuestionsResult {
  questions: WizardQuestion[];
  memory_hints: string[];
}

export interface WizardProposal {
  config: Partial<AgentConfig>;
  explanations: string[];
  warnings: string[];
  eval_suggestion: { message: string };
}

/* ---------- model catalogue (`/llm/models/`) ---------- */

export interface AIModel {
  name: string;
  value: string;
  is_free: boolean;
  description: string;
  /** Whether this account can run it right now: a key for its provider, or a free model on a platform key. */
  available?: boolean;
  /**
   * Reasoning-effort rungs this model offers, cheapest first. `[]` is a real
   * answer: this model has no effort control.
   */
  effort_levels: string[];
  /** The rung used when nobody chooses. `''` means the provider's own default. */
  default_effort: string;
  /** Convenience for `effort_levels.length > 0`. */
  supports_effort: boolean;
}

export interface AIProvider {
  name: string;
  slug: string;
  description: string;
  icon: string;
  has_credentials: boolean;
  models: AIModel[];
}

/** The platform fallback model: what runs execute on when their configured model is retired. */
export interface FallbackModel {
  provider: string;
  model: string;
}

export interface CatalogueMeta {
  /** Last completed refresh, or null when none has ever run. */
  last_refresh: {
    at: string;
    by: string;
    added: number;
    updated: number;
    retired: { value: string; replaced_by: string }[];
    new_upstream: string[];
    affected_agents: unknown[];
  } | null;
  fallback: FallbackModel;
}

/** `GET /llm/models/`. */
export interface ModelCatalogue {
  providers: AIProvider[];
  meta?: CatalogueMeta;
}

/**
 * The part of the account profile the builder reads to seed a new agent: the
 * account's own choices in Settings. Passed in explicitly, so this file stays
 * independent of wherever the profile is held.
 */
export interface AccountDefaults {
  llm_provider?: string | null;
  llm_model?: string | null;
  llm_effort?: string | null;
  default_temperature?: number | null;
  /** The account's zone. The builder uses it unless it is the untouched `UTC`. */
  timezone?: string | null;
}
