/**
 * Turns a plain-language description into knob changes.
 *
 * This is the local stand-in for the generating agent in the design note. It is
 * deliberately rule-based and deterministic: no API call, no latency, and you
 * can read exactly why a knob moved. When the backend gains an endpoint that
 * returns an AgentConfig patch, swap `propose()` for that call — the shape it
 * returns here is the shape the UI already consumes.
 */
import type { AgentConfig, ConnectorChoice } from '../types/agentConfig';

export interface Change {
  /** Dotted path into AgentConfig, e.g. "tools.codeExecution". */
  path: string;
  label: string;
  value: unknown;
  why: string;
}

export interface Proposal {
  reply: string;
  changes: Change[];
}

const has = (t: string, ...words: string[]) => words.some((w) => t.includes(w));

/** The connections available to match against, as the builder knows them.
 *  Distinct from the stored `ConnectorChoice`: this is what the picker offers,
 *  that is what an agent saved. */
export interface ConnectorOption {
  id: number;
  label: string;
  /** The stable presentation key from the backend, e.g. `gmail`. */
  iconSlug?: string;
}

/* Which words should reach for which connector, keyed by `icon_slug`.
 *
 * Keyed on the slug rather than on the label because the label is user-facing
 * copy served from the database — "Gmail" today, "Google Mail" after an edit —
 * while the slug is the same stable key the icon map and the OAuth scope map
 * already key on. A connector with no entry here is simply never proposed,
 * which is the right failure: a user's own MCP server has no keywords anyone
 * could have guessed, and proposing the wrong one is worse than proposing none. */
const CONNECTOR_KEYWORDS: Record<string, string[]> = {
  gmail: ['gmail', 'email', 'inbox', 'mail'],
  'google-drive': ['drive', 'g-drive', 'gdrive'],
  'google-sheets': ['sheet', 'spreadsheet', 'excel'],
  'google-calendar': ['calendar', 'meeting', 'schedule a', 'availability'],
  'google-docs': ['google doc', 'gdoc'],
  slack: ['slack'],
  notion: ['notion'],
};

export function propose(
  input: string,
  cfg: AgentConfig,
  available: ConnectorOption[] = [],
): Proposal {
  const t = input.toLowerCase();
  const changes: Change[] = [];
  const add = (path: string, label: string, value: unknown, why: string) => {
    changes.push({ path, label, value, why });
  };

  /* --- what it works on ----------------------------------------------------
   *
   * Proposed only from what the user has actually connected. Suggesting a
   * connection they do not have would put an id in the config that the backend
   * rejects on save, so the account's own catalogue is the candidate list. */
  // A stored connection is either a bare id or `{id, mode, tools}`. The rule
  // table only ever *adds* one, so it keeps whatever entry is already there and
  // appends bare ids — narrowing a connection to read-only is a judgement this
  // keyword matcher has no business making.
  const chosen = new Map<number, ConnectorChoice>(
    cfg.connectors.map((c) => [typeof c === 'number' ? c : c.id, c]),
  );
  for (const choice of available) {
    const words = CONNECTOR_KEYWORDS[choice.iconSlug ?? ''];
    if (words && has(t, ...words) && !chosen.has(choice.id)) {
      chosen.set(choice.id, choice.id);
    }
  }
  if (chosen.size !== cfg.connectors.length) {
    add('connectors', 'Connections',
        [...chosen.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c),
        'Named a source it has to reach.');
  }

  // --- how it should be invoked --------------------------------------------
  if (has(t, 'every day', 'daily', 'every monday', 'weekly', 'every week',
             'schedule', 'each morning', 'hourly', 'keep', 'monitor', 'watch')) {
    // No `trigger` to set any more: an agent with a schedule *is* a standing
    // job, and the schedule below is the whole statement.
    const cron =
      has(t, 'monday') ? '0 9 * * 1'
      : has(t, 'hourly') ? '0 * * * *'
      : has(t, 'weekly', 'every week') ? '0 9 * * 1'
      : '0 9 * * *';
    if (cfg.schedule !== cron) add('schedule', 'Schedule', cron, 'Derived from the cadence you described.');
    // Proposed together with the schedule, never separately: a scheduled agent
    // without this is refused at every firing, and the save is rejected for
    // exactly that reason — so proposing one without the other would hand the
    // user a configuration they cannot save.
    if (!cfg.allowUnattended) {
      add('allowUnattended', 'Unattended', true,
          'A schedule only fires if the agent may run with nobody watching.');
    }
  }

  // --- tools ----------------------------------------------------------------
  const tools = { ...cfg.tools };
  if (has(t, 'calculate', 'python', 'compute', 'analyse', 'analyze', 'reconcile',
             'csv', 'spreadsheet', 'total', 'sum')) tools.codeExecution = true;
  if (has(t, 'search the web', 'look up', 'research', 'find online', 'web')) tools.webSearch = true;
  if (has(t, 'scrape', 'website', 'web page', 'url')) tools.scrape = true;
  if (has(t, 'file', 'pdf', 'document', 'upload', 'invoice')) tools.fileOps = true;
  if (has(t, 'deck', 'slides', 'presentation', 'powerpoint', 'pptx', 'excel', 'xlsx',
             'workbook', 'word doc', 'docx')) tools.office = true;
  if (has(t, 'image', 'illustration', 'picture', 'cover art')) tools.media = true;
  if (has(t, 'publish', 'share a link', 'public page')) tools.publish = true;
  if (has(t, 'knowledge base', 'our docs', 'company doc', 'policy', 'sop')) tools.rag = true;
  if (has(t, 'shell', 'command line', 'terminal', 'bash')) tools.shell = true;
  for (const k of Object.keys(tools) as (keyof typeof tools)[]) {
    if (tools[k] !== cfg.tools[k]) {
      add(`tools.${k}`, `Tool: ${k}`, tools[k], 'Implied by the work you described.');
    }
  }

  // --- autonomy -------------------------------------------------------------
  // Anything that leaves the account defaults to asking first; only say
  // "unattended" when the user explicitly asks for it.
  if (has(t, 'without asking', 'unattended', 'automatically', 'no approval', "don't ask")) {
    if (cfg.autonomy !== 'full') {
      add('autonomy', 'Autonomy', 'full', 'You asked for it to run without you.');
    }
  } else if (has(t, 'send', 'email', 'post', 'delete', 'pay', 'publish', 'reply')) {
    if (cfg.autonomy === 'full') {
      add('autonomy', 'Autonomy', 'ask', 'It can act outside your account, so it should ask first.');
    }
  }
  if (has(t, 'review every', 'check every step', 'high stakes', 'approve each')) {
    add('autonomy', 'Autonomy', 'review', 'You asked to see every step.');
  }

  // --- temperature ----------------------------------------------------------
  if (has(t, 'extract', 'exact', 'precise', 'accurate', 'classif', 'parse', 'validate')) {
    if (cfg.temperature > 0.1) {
      add('temperature', 'Temperature', 0, 'Extraction and classification want determinism.');
    }
  } else if (has(t, 'draft', 'write', 'creative', 'brainstorm', 'compose', 'tone')) {
    if (cfg.temperature < 0.6) {
      add('temperature', 'Temperature', 0.7, 'Drafting reads better with some variation.');
    }
  }

  // --- run budget -----------------------------------------------------------
  // Bulk work needs *time*, which is the resource a run actually holds. It used
  // to propose more memory and vCPUs; neither was ever enforced, so the
  // proposal was advice that could not work.
  if (has(t, 'large', 'thousands', 'bulk', 'heavy', 'big file', 'millions')) {
    if (cfg.maxRunSeconds < 45 * 60) {
      add('maxRunSeconds', 'Time limit', 45 * 60, 'Bulk work needs longer to finish.');
    }
  }
  if (has(t, 'quick', 'fast', 'brief', 'short')) {
    if (cfg.maxRunSeconds > 5 * 60) {
      add('maxRunSeconds', 'Time limit', 5 * 60, 'You asked for something quick.');
    }
  }
  if (has(t, 'cheap', 'low cost', 'budget', 'minimal')) {
    if (cfg.spendCapRupees > 200) add('spendCapRupees', 'Spend cap', 200, 'You asked to keep it cheap.');
  }

  // --- environment ----------------------------------------------------------
  if (has(t, 'time of day', 'timezone', 'business hours', 'location', 'office hours')) {
    if (!cfg.useEnvironment) add('useEnvironment', 'Environment', true, 'It needs to know time or place.');
  }

  // --- name and brief -------------------------------------------------------
  if (!cfg.brief.trim()) {
    add('brief', 'Brief', input.trim(), 'Captured from your description.');
  }
  if (!cfg.name.trim()) {
    const guess =
      has(t, 'invoice', 'payable', 'vendor', 'gst') ? 'Finance agent'
      : has(t, 'ticket', 'support', 'customer') ? 'Support agent'
      : has(t, 'drive', 'file', 'cleanup', 'archive') ? 'Ops agent'
      : has(t, 'data', 'csv', 'analys') ? 'Data agent'
      : 'New agent';
    add('name', 'Name', guess, 'Placeholder — rename it whenever.');
  }

  const reply = changes.length
    ? `I set ${changes.length} ${changes.length === 1 ? 'knob' : 'knobs'}. Each one is highlighted on the right with why — override anything that looks wrong.`
    : "I couldn't tell which knobs that should move. Try naming what it reads, what it does with it, and whether it may act without you.";

  return { reply, changes };
}

/** Applies a proposal to a config, returning a new object. */
export function applyChanges(cfg: AgentConfig, changes: Change[]): AgentConfig {
  const next: AgentConfig = structuredClone(cfg);
  for (const c of changes) {
    const [head, tail] = c.path.split('.');
    if (tail) {
      (next as unknown as Record<string, Record<string, unknown>>)[head][tail] = c.value;
    } else {
      (next as unknown as Record<string, unknown>)[head] = c.value;
    }
  }
  return next;
}
