/**
 * Every knob that defines an agent.
 *
 * The premise from the design note: an agent is a configuration, not code. If
 * all of it is data, a generating agent can write it — which is what the chat
 * pane in the builder does. So this shape is the contract between the knob
 * board, the chat, and (eventually) the backend.
 */

/** Derived from whether the agent has a schedule; read-only on the wire. */
export type TriggerMode = 'goal' | 'maintenance';
export type Autonomy = 'plan' | 'review' | 'ask' | 'auto' | 'full';
export type FileAccess = 'none' | 'readonly' | 'scoped' | 'read_all_write_own' | 'full';
/** Lifecycle. `archived` exists on the server and is not offered as a save. */
export type AgentStatus = 'draft' | 'active' | 'paused' | 'archived';
/** The closed registry in `agents/contracts.py`. Blank is prose. */
export type OutputContract = '' | 'research' | 'extraction';

/**
 * How much of one connection an agent may use.
 *
 * `all` is everything that connection offers — which is what choosing it used
 * to mean, and still means for every agent saved before the mode existed.
 * `read` is derived per turn from the tool's own name, so it survives a
 * catalogue change; `selected` names tools, and is only offered once the live
 * tool list has loaded.
 */
export type ConnectorMode = 'all' | 'read' | 'selected';

/** Per-tool rule. Unset (absent key) means inherit: grants, `toolScope`
 *  and the autonomy level decide, which is what every agent saved before
 *  this means. */
export type ToolPermissionMode = 'allow' | 'ask' | 'deny';

/** A bare id is the legacy shape and means `all`. */
export type ConnectorChoice =
  | number
  | { id: number; mode: ConnectorMode; tools: string[] };

export interface AgentConfig {
  // Identity
  name: string;
  brief: string;
  /**
   * One line saying what this agent is *for*.
   *
   * Not decoration: `search_agents` reads it, so it is what another agent sees
   * when deciding which one to delegate a job to. It was on the model from the
   * start and never on the wire, so every agent built here was blank to the
   * parent trying to choose.
   */
  description: string;
  /** Short labels for grouping; also matched by agent search. */
  tags: string[];
  /** draft | active | paused | archived. Paused and archived stop schedules and delegation without deleting. */
  status: AgentStatus;

  // Model
  provider: string;
  model: string;
  /** 0 = deterministic, 1 = loose. Extraction wants low, drafting wants high. */
  temperature: number;
  /**
   * How hard the model thinks before answering: `''` (the model's own
   * default), `'none'`, `'minimal'`, `'low'`, `'medium'` or `'high'`.
   *
   * Which of those the chosen model actually offers comes from
   * `AIModel.effort_levels`; a model with no effort control ignores this
   * entirely. `''` is the default so an agent saved before this field existed
   * runs exactly as it did.
   */
  effort: string;

  // Sandbox
  //
  // `workdir` and `venv` were removed (2026-09-03) alongside `cpu`/`memoryMb`
  // before them: stored, validated, round-tripped and read by nothing. The
  // sandbox is a fixed image, and where an agent's files live is `fileAccess`
  // plus the virtual filesystem.
  fileAccess: FileAccess;

  // Tools
  tools: {
    codeExecution: boolean;
    shell: boolean;
    webSearch: boolean;
    scrape: boolean;
    fileOps: boolean;
    /** Create decks, workbooks and Word documents in its folder. Needs a
     *  `fileAccess` other than none, like `fileOps`, to have somewhere to save. */
    office: boolean;
    /** Generate images, billed to the user's OpenRouter account. Saved into
     *  its folder, so it needs a `fileAccess` other than none. */
    media: boolean;
    /** Publish hosted pages shareable by link. Outward-facing: above `link`
     *  visibility it pauses for a human. */
    publish: boolean;
    /** A real browser: read JavaScript pages, and act on `browserDomains`. */
    browser: boolean;
    rag: boolean;
    /** The user's own configured MCP servers. Off by default: these reach
     *  real systems under the user's credentials. */
    mcp: boolean;
    /** Transcribe recordings; speak text into audio files. Needs file access. */
    voice: boolean;
    /** Send documents out for e-signature. Pauses before anything goes out. */
    esign: boolean;
    /** Read, draft and send on Slack, WhatsApp, Teams and SMS. */
    talk: boolean;
    /** Query SQL databases; write only where allowed. */
    data: boolean;
    /** Call HTTP APIs through one generic caller. */
    api: boolean;
    /** Run commands and long jobs on the workspace machine. */
    compute: boolean;
    /** May it hand work to the user's other agents. Scoped by `delegatesTo`:
     *  an agent that can delegate to one with wider tools has those tools by
     *  proxy, so the grant alone was never the whole answer. */
    subAgents: boolean;
  };

  // Context the agent is given
  /** Which connections this agent may reach: `MCPServer` ids from
   *  `/mcp/servers/`, not slugs. The second axis to the `mcp` tool grant —
   *  that says whether connectors are reachable at all, this says which ones.
   *
   *  Empty means "any the user has", which is what every agent saved before
   *  this was enforced carries: the field existed here long before the runtime
   *  read it, so treating an empty list as "no connectors" would silently strip
   *  the toolbox of every agent that never made a choice. */
  connectors: ConnectorChoice[];
  knowledgeBases: number[];
  /**
   * Which of the user's other agents this one may delegate to.
   *
   * The second axis to the `subAgents` grant, and the last one to get one:
   * `search_agents` and `run_agent` filtered on owner alone, so an agent that
   * could delegate could run every agent on the account — including ones with
   * grants it had been refused. Empty means any of them.
   */
  delegatesTo: number[];
  /** Sites `browser_act` may click and type on (hostnames; subdomains
   *  included). Empty: it may browse but never act. */
  browserDomains: string[];
  /** Vault logins `browser_act` may fill. Empty: none. */
  browserLogins: string[];
  /** Who unattended runs may message. Unattended sends outside it are refused. */
  recipients: string[];
  /** Database rows this agent's runs may touch. Empty means none. */
  dataConnections: number[];
  /** HTTP APIs this agent's runs may reach. Empty means none. */
  apiConnections: Array<number | { id: number; mode: 'read' | 'all' }>;
  /** Extra hosts databases may reach. */
  dbHosts: string[];
  /** Extra hosts APIs may reach. */
  apiHosts: string[];
  /** Extra hosts the workspace may reach. */
  workspaceEgress: string[];
  /** Code projects this agent's runs may touch. Empty means none. */
  codeProjects: number[];
  /** Exactly which built-in tools this agent may use. Empty: every tool its
   *  grants unlock — which is what every agent saved before this means. */
  toolScope: string[];
  /** Per-tool allow/ask/deny, keyed by built-in tool name. Empty: the grants,
   *  `toolScope` and the autonomy level decide alone. `allow` runs without
   *  asking, `ask` pauses even where autonomy would not, `deny` withholds
   *  the tool entirely — and none of them can reach past a grant that is
   *  off. Connector tools are governed by `connectors`, not here. */
  toolPermissions: Record<string, ToolPermissionMode>;
  /** Skill ids, not titles — a title is not a stable reference. */
  skills: number[];
  useEnvironment: boolean;   // time / place

  /**
   * What the answer has to come back as, from the closed registry the runtime
   * validates against. Blank is prose. Read by `contracts.resolve` since the
   * agent model landed; settable only since 2026-09-03.
   */
  outputContract: OutputContract;
  /**
   * How many pieces of a delegated list this agent works on at once. Null is
   * one at a time — only meaningful for an agent others delegate to.
   */
  fanoutParallel: number | null;

  // Invocation
  /** Read-only: derived from whether a schedule is set. */
  trigger?: TriggerMode;
  /**
   * The agent's own schedule, as cron. One field, and therefore one schedule:
   * it round-trips the single `origin='builder'` Trigger row and deliberately
   * cannot see the others, because a field that overwrites on every save must
   * not be pointed at a list. Extra schedules are made on the Schedules page.
   */
  schedule: string;
  /**
   * The IANA zone `schedule` is read in. Defaults to UTC on the server so an
   * agent saved by an older client keeps firing at the instant it always did.
   */
  scheduleTimezone: string;
  /**
   * Read-only: how many *other* schedules this agent has. Present so the
   * builder can say the field is not the whole picture rather than implying
   * it is.
   */
  extraSchedules?: number;
  /**
   * Whether anything other than the user may start a run — a schedule, a
   * webhook, or a parent agent delegating. Off by default, and the runtime
   * checks it again on every unattended call, so a schedule set without this
   * is refused at every firing rather than merely ignored.
   */
  allowUnattended: boolean;

  // Guardrails
  autonomy: Autonomy;
  notifyOnHitl: boolean;
  spendCapRupees: number;
  /**
   * Wall-clock ceiling on a single run, in seconds. Stored in seconds because
   * that is the unit the runtime compares against; the builder shows minutes.
   *
   * This replaced the `cpu` and `memoryMb` fields, which were stored, sent, and
   * read by nothing — the backend runs user code on a thread inside its own
   * process, where there is no cgroup to enforce either. Time is the resource a
   * run genuinely holds, so it is the one with a knob.
   */
  maxRunSeconds: number;
  // `egress` was removed (2026-09-03). It was read in one place — to add a
  // sentence to the system prompt — and its other two values could never have
  // been honoured: the sandbox is a sidecar container on an internal-only
  // network. The prompt now says "no network access" unconditionally, which is
  // the true statement.

  // Context lifecycle
  /**
   * Which model folds this agent's earlier steps when its context window fills.
   * Empty means the platform default — a small NVIDIA model the platform holds
   * a key for, so the fold works without the user connecting anything. Set both
   * or neither: a model without its provider cannot be routed.
   */
  summaryModel: string;
  summaryProvider: string;
  recursiveContext: boolean;
  compaction: boolean;
  indexing: boolean;
}

export const DEFAULT_AGENT: AgentConfig = {
  name: '',
  brief: '',
  description: '',
  tags: [],
  status: 'draft',

  provider: 'openrouter',
  model: '',
  // `medium` is the shipped standard, matching the chat composer and the
  // profile default. A model with no effort control ignores it, and an agent
  // saved before the field existed still reads back `''` — this is the value a
  // *new* agent starts at, not a retrofit onto existing ones.
  temperature: 0.2,
  effort: 'medium',

  // Default to the cautious end of every dial. An agent that turns out to need
  // more can be widened deliberately; one that starts wide is never narrowed.
  fileAccess: 'scoped',

  tools: {
    codeExecution: false,
    shell: false,
    webSearch: true,
    scrape: false,
    fileOps: false,
    office: false,
    media: false,
    publish: false,
    browser: false,
    rag: true,
    mcp: false,
    voice: false,
    esign: false,
    talk: false,
    data: false,
    api: false,
    compute: false,
    subAgents: false,
  },

  connectors: [],
  knowledgeBases: [],
  skills: [],
  delegatesTo: [],
  browserDomains: [],
  browserLogins: [],
  recipients: [],
  dataConnections: [],
  apiConnections: [],
  dbHosts: [],
  apiHosts: [],
  workspaceEgress: [],
  codeProjects: [],
  toolScope: [],
  toolPermissions: {},
  useEnvironment: false,

  outputContract: '',
  fanoutParallel: null,

  schedule: '',
  scheduleTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  allowUnattended: false,

  autonomy: 'ask',
  notifyOnHitl: true,
  spendCapRupees: 500,
  maxRunSeconds: 15 * 60,

  summaryModel: '',
  summaryProvider: '',
  recursiveContext: true,
  compaction: true,
  indexing: true,
};

// Derived rather than chosen: an agent with a schedule is a standing job, and
// that is the whole of what the retired `trigger` field meant.
export const TRIGGER_COPY: Record<TriggerMode, { label: string; hint: string }> = {
  goal: { label: 'On request', hint: 'Runs when you ask it to do a specific thing.' },
  maintenance: { label: 'Scheduled', hint: 'Runs on its schedule to keep something true.' },
};

export const STATUS_COPY: Record<AgentStatus, { label: string; hint: string }> = {
  // A label, not a switch: 42 of 55 agents in dev are drafts only because it
  // is the default, so enforcing it would silently stop most of them. See
  // docs/AGENT_CONFIG_IMPROVEMENT_PLAN.md item 8.
  draft: { label: 'Draft', hint: 'Still being set up. Runs exactly like Active — this is a label for you, not a switch.' },
  active: { label: 'Active', hint: 'Runs on its schedule, and other agents may delegate to it.' },
  paused: { label: 'Paused', hint: 'Schedules stop firing and no agent may delegate to it. Nothing is lost.' },
  archived: { label: 'Archived', hint: 'Filed away: hidden from the list, never run automatically. Restore it any time.' },
};

// The closed registry in `agents/contracts.py`. Closed because the UI renders
// these shapes — a free-form schema would let an agent declare one nothing can
// display, which is a promise the product cannot keep.
export const CONTRACT_COPY: Record<OutputContract, { label: string; hint: string }> = {
  '': { label: 'Prose', hint: 'A written answer. The default.' },
  research: {
    label: 'Research',
    hint: 'Findings, plus the queries it ran and every source it used.',
  },
  extraction: {
    label: 'Extracted rows',
    hint: 'Records as a table, plus the field names and what it could not find.',
  },
};

export const CONNECTOR_MODE_COPY: Record<ConnectorMode, { label: string; hint: string }> = {
  all: { label: 'Everything', hint: 'Every tool this connection offers, including the ones that send and delete.' },
  read: { label: 'Read only', hint: 'Only tools that look things up. Judged per run, so new tools are covered too.' },
  selected: { label: 'Chosen tools', hint: 'Only the tools you pick. Anything added later stays out.' },
};

// Key order is the order the radio list renders in, and it runs strictest to
// loosest — the same order as `AUTONOMY_LADDER` in the runtime, which is the
// authority on what each level actually gates.
//
// `plan` and `auto` are the two rungs that make this a ladder rather than a
// switch. Without `plan` the only way to find out what an agent will do is to
// let it do it; without `auto` the choice is between approving every recycled
// file write and approving nothing, and a user facing that picks "runs
// unattended" once and stops reading the prompts entirely.
export const AUTONOMY_COPY: Record<Autonomy, { label: string; hint: string }> = {
  plan: { label: 'Plan only', hint: 'Can look and report, never change anything. Nothing to approve.' },
  review: { label: 'Every step reviewed', hint: 'You approve each step. Slow, for high-stakes work.' },
  ask: { label: 'Asks before side effects', hint: 'Pauses before anything leaves your account.' },
  auto: { label: 'Asks only about the permanent', hint: 'Runs file changes you can undo; still stops before anything you cannot.' },
  full: { label: 'Runs unattended', hint: 'No approval gate at all, including tools using your credentials.' },
};



// Describes the virtual filesystem in `Backend/inference/vfs.py`, which is a
// view over the user's own document tree — not a disk. Files an agent writes
// show up in My Files like any upload, and deletes go to the recycle bin.
// Key order is the order the radio list renders in, and it is deliberate: least
// reach first. Note the progression is not a single line — `scoped` reads less
// than `readonly` but writes more — which is exactly why the fourth option
// exists. Values must match `FILE_ACCESS` in `Backend/agents/views/agents.py`;
// an option this app offers that the serializer does not accept is a 400 on save.
export const FILE_ACCESS_COPY: Record<FileAccess, { label: string; hint: string }> = {
  none: { label: 'None', hint: 'No file tools at all — it is not offered them.' },
  readonly: { label: 'Read only', hint: 'Can read all your files. Cannot change anything.' },
  scoped: { label: 'Own folder', hint: 'Read and write, but only inside its own folder in Agents/. It cannot see the rest of your files.' },
  read_all_write_own: {
    label: 'Read all, write own folder',
    hint: 'Can read all your files, but only writes inside its own folder in Agents/. Usually the one you want.',
  },
  full: { label: 'All your files', hint: 'Read and write anywhere in your files. Rarely justified.' },
};
