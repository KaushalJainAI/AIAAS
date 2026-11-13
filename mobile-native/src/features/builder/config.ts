/**
 * Agent configuration constants: the defaults a new agent starts from, the closed
 * sets the server validates against, and the copy that labels each one.
 *
 * Copied from better-n8n-frontend/src/types/agentConfig.ts (DEFAULT_AGENT, the
 * *_COPY maps), src/lib/toolPermissions.ts (TOOL_PERMISSION_COPY) and
 * src/hooks/useChatModelSelection.ts and useEffortSelection.ts (the platform
 * default provider, model and effort labels).
 *
 * The closed-set arrays are the order the radio lists render in, strictest first.
 * `FILE_ACCESS` must match `FILE_ACCESS` in `Backend/agents/views/agents.py`: a
 * value this app offers that the serializer does not accept is a 400 on save.
 */
import type {
  AgentConfig,
  AgentStatus,
  Autonomy,
  ConnectorMode,
  FileAccess,
  OutputContract,
  ToolGrants,
  ToolPermissionMode,
  TriggerMode,
} from './types';

/** The platform's default provider and model for a signed-in user with no choice saved. */
export const DEFAULT_PROVIDER = 'openrouter';
export const DEFAULT_MODEL = 'openrouter/free';

/** Effort rungs the picker offers, and what each is called. `''` is the model's own default. */
export const EFFORT_LABELS: Record<string, string> = {
  '': 'Default',
  none: 'Instant',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export const AUTONOMY_LEVELS = ['plan', 'review', 'ask', 'auto', 'full'] as const satisfies readonly Autonomy[];
export const FILE_ACCESS_LEVELS = ['none', 'readonly', 'scoped', 'read_all_write_own', 'full'] as const satisfies readonly FileAccess[];
export const AGENT_STATUSES = ['draft', 'active', 'paused', 'archived'] as const satisfies readonly AgentStatus[];
export const OUTPUT_CONTRACTS = ['', 'research', 'extraction'] as const satisfies readonly OutputContract[];
export const CONNECTOR_MODES = ['all', 'read', 'selected'] as const satisfies readonly ConnectorMode[];
export const TOOL_PERMISSION_MODES = ['allow', 'ask', 'deny'] as const satisfies readonly ToolPermissionMode[];
export const TRIGGER_MODES = ['goal', 'maintenance'] as const satisfies readonly TriggerMode[];

/** Fan-out widths the builder offers. `null` is one at a time. */
export const FANOUT_CHOICES: readonly (number | null)[] = [null, 2, 4, 8];

/** Run-limit presets, in minutes. The builder clamps a typed value to 1..120. */
export const RUN_LIMIT_PRESETS_MINUTES: readonly number[] = [5, 15, 30, 60];
export const RUN_LIMIT_MIN_MINUTES = 1;
export const RUN_LIMIT_MAX_MINUTES = 120;

/** Temperature bounds the stepper offers. */
export const TEMPERATURE_MIN = 0;
export const TEMPERATURE_MAX = 2;

/**
 * A new agent starts at the cautious end of every dial. An agent that needs more
 * can be widened deliberately; one that starts wide is never narrowed.
 */
export const DEFAULT_AGENT: AgentConfig = {
  name: '',
  brief: '',
  description: '',
  tags: [],
  status: 'draft',

  provider: 'openrouter',
  model: '',
  // `medium` is the shipped standard. A model with no effort control ignores it.
  temperature: 0.2,
  effort: 'medium',

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
    decisions: false,
    subAgents: false,
  },

  connectors: [],
  knowledgeBases: [],
  skills: [],
  delegatesTo: [],
  orgId: null,
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

export const TRIGGER_COPY: Record<TriggerMode, { label: string; hint: string }> = {
  goal: { label: 'On request', hint: 'Runs when you ask it to do a specific thing.' },
  maintenance: { label: 'Scheduled', hint: 'Runs on its schedule to keep something true.' },
};

export const STATUS_COPY: Record<AgentStatus, { label: string; hint: string }> = {
  // A label, not a switch: enforcing it would silently stop most draft agents.
  draft: { label: 'Draft', hint: 'Still being set up. Runs exactly like Active. This is a label for you, not a switch.' },
  active: { label: 'Active', hint: 'Runs on its schedule, and other agents may delegate to it.' },
  paused: { label: 'Paused', hint: 'Schedules stop firing and no agent may delegate to it. Nothing is lost.' },
  archived: { label: 'Archived', hint: 'Filed away: hidden from the list, never run automatically. Restore it any time.' },
};

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

export const AUTONOMY_COPY: Record<Autonomy, { label: string; hint: string }> = {
  plan: { label: 'Plan only', hint: 'Can look and report, never change anything. Nothing to approve.' },
  review: { label: 'Review every step', hint: 'You approve each step. Slow, for high-stakes work.' },
  ask: { label: 'Ask before changes', hint: 'Pauses before anything leaves your account.' },
  auto: { label: 'Ask before irreversible', hint: 'Runs file changes you can undo; still stops before anything you cannot.' },
  full: { label: 'Never ask', hint: 'No approval gate at all, including tools using your credentials.' },
};

export const FILE_ACCESS_COPY: Record<FileAccess, { label: string; hint: string }> = {
  none: { label: 'None', hint: 'No file tools at all. It is not offered them.' },
  readonly: { label: 'Read only', hint: 'Can read all your files. Cannot change anything.' },
  scoped: { label: 'Own folder', hint: 'Read and write, but only inside its own folder in Agents/. It cannot see the rest of your files.' },
  read_all_write_own: {
    label: 'Read all, write own folder',
    hint: 'Can read all your files, but only writes inside its own folder in Agents/. Usually the one you want.',
  },
  full: { label: 'All your files', hint: 'Read and write anywhere in your files. Rarely justified.' },
};

export const TOOL_PERMISSION_COPY: Record<ToolPermissionMode, { label: string; hint: string }> = {
  allow: { label: 'Allow', hint: 'Run without asking, even where autonomy would pause.' },
  ask: { label: 'Ask', hint: 'Pause for approval, even where autonomy would not.' },
  deny: { label: 'Deny', hint: 'Never offered and refused if named.' },
};

/**
 * The builder screens. Each holds a group of fields, so a save the server rejects
 * can bring the screen that holds the refused field into view. Keys are the
 * AgentConfig names the serializer reports errors under.
 */
export type AgentSection =
  | 'identity'
  | 'instructions'
  | 'model'
  | 'grants'
  | 'toolRules'
  | 'connections'
  | 'knowledge'
  | 'delegation'
  | 'files'
  | 'autonomy'
  | 'guardrails'
  | 'output'
  | 'schedule'
  | 'context';

export const FIELD_SECTION: Partial<Record<keyof AgentConfig, AgentSection>> = {
  name: 'identity', description: 'identity', tags: 'identity', status: 'identity',
  brief: 'instructions',
  provider: 'model', model: 'model', effort: 'model', temperature: 'model',
  tools: 'grants', browserDomains: 'grants',
  toolScope: 'toolRules', toolPermissions: 'toolRules',
  connectors: 'connections',
  knowledgeBases: 'knowledge', skills: 'knowledge', orgId: 'knowledge',
  delegatesTo: 'delegation',
  fileAccess: 'files',
  autonomy: 'autonomy',
  allowUnattended: 'guardrails', notifyOnHitl: 'guardrails',
  spendCapRupees: 'guardrails', maxRunSeconds: 'guardrails',
  outputContract: 'output', fanoutParallel: 'output',
  compaction: 'context', recursiveContext: 'context', summaryModel: 'context',
  summaryProvider: 'context', indexing: 'context', useEnvironment: 'context',
  schedule: 'schedule', scheduleTimezone: 'schedule',
};

/** The grant switches, in the order the web builder lists them, with the copy it shows. */
export const GRANT_ITEMS: readonly { key: keyof ToolGrants; label: string; hint: string }[] = [
  { key: 'codeExecution', label: 'Run Python', hint: 'Sandboxed interpreter for calculation and parsing.' },
  { key: 'shell', label: 'Code in projects', hint: 'Read, test, commit and open a PR, in the projects it is given.' },
  { key: 'webSearch', label: 'Web search', hint: 'Look things up it was not given.' },
  { key: 'scrape', label: 'Read web pages', hint: 'Fetch and extract from a URL.' },
  { key: 'fileOps', label: 'Read and write files', hint: 'Your own files, within the file access level.' },
  { key: 'office', label: 'Make decks, sheets and docs', hint: 'PowerPoint, Excel and Word files, saved where file access allows.' },
  { key: 'media', label: 'Generate images', hint: 'Billed to your OpenRouter account; saved where file access allows.' },
  { key: 'publish', label: 'Publish pages', hint: 'Share a report, page or file by link. Pauses before anything goes public.' },
  { key: 'browser', label: 'Use a browser', hint: 'Read JavaScript pages; click and type only on the sites listed.' },
  { key: 'rag', label: 'Knowledge base search', hint: 'Retrieve from your indexed documents.' },
  { key: 'decisions', label: 'Decisions', hint: 'Classify, route or rate with the decision model picked in Settings.' },
  { key: 'mcp', label: 'Connections (MCP)', hint: 'Tools from your connected plugins, using your connectors.' },
  { key: 'voice', label: 'Transcribe and speak', hint: 'Transcripts from recordings; audio files from text.' },
  { key: 'esign', label: 'E-signatures', hint: 'Send documents out for signature. Pauses before anything goes out.' },
  { key: 'talk', label: 'Messaging', hint: 'Read, draft and send on Slack, WhatsApp, Teams, SMS and Telegram.' },
  { key: 'data', label: 'Databases', hint: 'Query SQL databases; write only where allowed.' },
  { key: 'api', label: 'API calls', hint: 'Call HTTP APIs through one generic caller.' },
  { key: 'compute', label: 'Compute', hint: 'Run commands and long jobs on your workspace machine.' },
  { key: 'subAgents', label: 'Delegate to other agents', hint: 'Hand whole tasks to agents you have built.' },
];

/** Fields the builder never sends on save: schedules belong to the Schedules screen. */
export const SCHEDULE_FIELDS = ['schedule', 'scheduleTimezone'] as const;

/** Fields the server computes. Stripped before a duplicate is created. */
export const READ_ONLY_AGENT_FIELDS = [
  'id', 'runs', 'unattended', 'spend', 'created_at', 'updated_at',
  'extraSchedules', 'trigger', 'schedule', 'scheduleTimezone',
] as const;
