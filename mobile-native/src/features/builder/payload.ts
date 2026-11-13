/**
 * Building what the builder sends, and checking it first.
 *
 * Mirrors the save, duplicate, wizard and seeding logic of
 * better-n8n-frontend/src/pages/AgentBuilder.tsx and AgentCreateWizard.tsx.
 * Everything here is pure: the screens hand in the state, and get back the
 * request body or the list of problems.
 */
import {
  AGENT_STATUSES,
  AUTONOMY_LEVELS,
  DEFAULT_AGENT,
  FIELD_SECTION,
  FILE_ACCESS_LEVELS,
  OUTPUT_CONTRACTS,
  READ_ONLY_AGENT_FIELDS,
  SCHEDULE_FIELDS,
  type AgentSection,
} from './config';
import { pruneToolPermissions } from './edits';
import type {
  AccountDefaults,
  AgentConfig,
  AgentInput,
  AIModel,
  AIProvider,
} from './types';

/* ---------- seeding a new board ---------- */

/**
 * What a new agent starts from: the account's own choices in Settings. Temperature
 * and timezone were stored there and never reached a new agent. The zone falls
 * back to the device's when Settings still holds the untouched `UTC`.
 */
export function accountDefaults(user: AccountDefaults): Partial<AgentConfig> {
  return {
    provider: user.llm_provider || DEFAULT_AGENT.provider,
    model: user.llm_model || DEFAULT_AGENT.model,
    effort: user.llm_effort ?? DEFAULT_AGENT.effort,
    temperature: user.default_temperature ?? DEFAULT_AGENT.temperature,
    scheduleTimezone: user.timezone && user.timezone !== 'UTC'
      ? user.timezone
      : DEFAULT_AGENT.scheduleTimezone,
  };
}

/**
 * Apply the account defaults to a blank board, but only while it is still
 * untouched. Once anything has been changed, the board is left alone.
 */
export function seedNewAgent(cfg: AgentConfig, user: AccountDefaults): AgentConfig {
  if (cfg.provider !== DEFAULT_AGENT.provider || cfg.model !== '' || cfg.effort !== DEFAULT_AGENT.effort) {
    return cfg;
  }
  return { ...cfg, ...accountDefaults(user) };
}

/** The board's contents when reset: the saved agent, or a blank board on the account defaults. */
export function resetBoard(existing: AgentConfig | null, user: AccountDefaults): AgentConfig {
  if (existing) return { ...DEFAULT_AGENT, ...existing };
  return { ...DEFAULT_AGENT, ...accountDefaults(user) };
}

/* ---------- provider and model in force ---------- */

/**
 * The provider the pickers show. A blank model means "the account default": the
 * stored provider next to it is just the serializer's default, not a choice, so
 * both resolve from the profile together. An explicit model keeps its own provider.
 */
export function displayProviderFor(cfg: AgentConfig, userDefaultProvider: string): string {
  return cfg.model ? (cfg.provider || userDefaultProvider) : userDefaultProvider;
}

/** The provider entry the model picker lists, falling back to the account default, then the first. */
export function activeProviderFor(
  providers: AIProvider[],
  displayProvider: string,
  userDefaultProvider: string,
): AIProvider | undefined {
  return providers.find((p) => p.slug === displayProvider)
    ?? providers.find((p) => p.slug === userDefaultProvider)
    ?? providers[0];
}

/**
 * The model actually in force: what was chosen, else the account default, else the
 * provider's first once the catalogue arrives. Derived, never written back, so a
 * saved model is not overwritten by a catalogue default.
 */
export function effectiveModelFor(
  cfg: AgentConfig,
  userDefaultModel: string,
  activeProvider: AIProvider | undefined,
): string {
  return cfg.model || userDefaultModel || activeProvider?.models?.[0]?.value || '';
}

/** Which effort rungs the model in force offers. `[]` hides the control. */
export function effortLevelsFor(activeProvider: AIProvider | undefined, effectiveModel: string): string[] {
  const model: AIModel | undefined = activeProvider?.models?.find((mo) => mo.value === effectiveModel);
  return model?.effort_levels ?? [];
}

/**
 * The summarising-model choice. Both or neither: a model with no provider cannot be
 * routed, so choosing the platform default clears both fields.
 */
export function summaryChoice(
  value: string,
  providers: AIProvider[],
): { summaryModel: string; summaryProvider: string } {
  if (!value) return { summaryModel: '', summaryProvider: '' };
  const owner = providers.find((p) => p.models?.some((m) => m.value === value));
  return { summaryModel: value, summaryProvider: owner?.slug ?? '' };
}

/* ---------- save ---------- */

/**
 * The body a save sends. Schedules are never sent: they live on rows the Schedules
 * screen owns, and the server reconciles only keys it receives, so leaving them
 * out leaves every schedule alone. The provider and model sent are the pair the
 * pickers show, and per-tool rules for tools the grants no longer unlock are
 * pruned.
 */
export function buildSavePayload(
  cfg: AgentConfig,
  opts: { displayProvider: string; effectiveModel: string; grantedToolIds: string[] },
): AgentInput {
  const payload: Record<string, unknown> = {
    ...cfg,
    provider: opts.displayProvider,
    model: opts.effectiveModel,
    toolPermissions: pruneToolPermissions(cfg.toolPermissions, opts.grantedToolIds),
  };
  for (const key of SCHEDULE_FIELDS) delete payload[key];
  return payload as AgentInput;
}

/**
 * A copy of an agent: its configuration without its schedule, its run history, or
 * any server-computed field, named "<name> (copy)" and started as a draft. Two
 * agents firing the same job on the same clock is never what "duplicate" meant.
 */
export function duplicatePayload(source: Partial<AgentConfig>, currentName: string): AgentInput {
  const copy: Record<string, unknown> = { ...DEFAULT_AGENT, ...source };
  for (const key of READ_ONLY_AGENT_FIELDS) delete copy[key];
  return { ...copy, name: `${currentName} (copy)`, status: 'draft' } as AgentInput;
}

/* ---------- checks before a save ---------- */

export interface AgentProblem {
  /** The config field the problem is about. */
  field: keyof AgentConfig;
  /** The builder section that holds the field, so it can be brought on screen. */
  section: AgentSection;
  message: string;
}

/** Run limits the builder allows, in seconds: 1 to 120 minutes. */
const MIN_RUN_SECONDS = 60;
const MAX_RUN_SECONDS = 120 * 60;

/**
 * Checks the board can make before it sends anything. The server validates the
 * same rules and answers 400 with a field name; this catches the ones a person
 * can fix without a round trip. Anything not listed here is left to the server.
 */
export function validateAgentDraft(cfg: AgentConfig): AgentProblem[] {
  const problems: AgentProblem[] = [];
  const add = (field: keyof AgentConfig, message: string) =>
    problems.push({ field, section: FIELD_SECTION[field] ?? 'identity', message });

  if (!cfg.name.trim()) add('name', 'Give the agent a name first.');

  if (!Number.isFinite(cfg.temperature) || cfg.temperature < 0 || cfg.temperature > 2) {
    add('temperature', 'Temperature must be between 0 and 2.');
  }
  if (!Number.isFinite(cfg.maxRunSeconds) || cfg.maxRunSeconds < MIN_RUN_SECONDS || cfg.maxRunSeconds > MAX_RUN_SECONDS) {
    add('maxRunSeconds', 'The run limit must be between 1 and 120 minutes.');
  }
  if (!Number.isFinite(cfg.spendCapRupees) || cfg.spendCapRupees < 0) {
    add('spendCapRupees', 'The spend cap cannot be negative.');
  }
  if ((cfg.summaryModel !== '') !== (cfg.summaryProvider !== '')) {
    add('summaryModel', 'Set both the summarizing model and its provider, or neither.');
  }
  if (cfg.fanoutParallel !== null && (!Number.isInteger(cfg.fanoutParallel) || cfg.fanoutParallel < 1)) {
    add('fanoutParallel', 'Fan-out width must be a whole number, or one at a time.');
  }
  if (!(AUTONOMY_LEVELS as readonly string[]).includes(cfg.autonomy)) {
    add('autonomy', 'Pick one of the safety levels.');
  }
  if (!(FILE_ACCESS_LEVELS as readonly string[]).includes(cfg.fileAccess)) {
    add('fileAccess', 'Pick one of the file access levels.');
  }
  if (!(AGENT_STATUSES as readonly string[]).includes(cfg.status)) {
    add('status', 'Pick one of the statuses.');
  }
  if (!(OUTPUT_CONTRACTS as readonly string[]).includes(cfg.outputContract)) {
    add('outputContract', 'Pick one of the result shapes.');
  }
  return problems;
}

/* ---------- the creation wizard ---------- */

/**
 * The body the wizard creates with. Mirrors the web: the name the person typed
 * is the fallback, and the proposal's own `config` is spread after it, so a
 * proposal that names the agent wins. Both are approved on screen before this runs.
 */
export function wizardCreateBody(
  description: string,
  answers: Record<string, string>,
  proposalConfig: Partial<AgentConfig> | null | undefined,
): AgentInput {
  const proposedName = (proposalConfig as { name?: string } | null | undefined)?.name;
  return {
    name: String(answers.name || proposedName || description.slice(0, 60)),
    ...(proposalConfig ?? {}),
  } as AgentInput;
}

/** The starter eval kinds the wizard offers once an agent exists. */
export const STARTER_EVAL_TEMPLATES = ['research', 'analyst', 'files', 'support', 'code'] as const;
