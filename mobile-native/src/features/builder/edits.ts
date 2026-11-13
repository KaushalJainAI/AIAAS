/**
 * Pure transforms over an agent's configuration: the edits a screen makes while a
 * person is typing or tapping. No I/O, no React. Each one mirrors the helper of the
 * same role in better-n8n-frontend/src/pages/AgentBuilder.tsx or
 * src/lib/toolPermissions.ts, including the choices that keep two equal
 * configurations storing the same bytes.
 */
import type { ToolsCatalogue } from '../tools/types';
import { DEFAULT_AGENT, RUN_LIMIT_MAX_MINUTES, RUN_LIMIT_MIN_MINUTES } from './config';
import type {
  Agent,
  AgentConfig,
  ConnectorChoice,
  ConnectorMode,
  ToolGrants,
  ToolPermissionMode,
} from './types';

/* ---------- the connector union ----------
 *
 * A stored connection is either a bare id (every agent saved before the mode
 * existed) or `{id, mode, tools}`. These keep that difference in one place, and
 * keep the bare form when nothing narrower was chosen.
 */

export const connectorId = (choice: ConnectorChoice): number =>
  typeof choice === 'number' ? choice : choice.id;

export const connectorMode = (choice: ConnectorChoice): ConnectorMode =>
  typeof choice === 'number' ? 'all' : choice.mode;

/** Set how much of one connection the agent may use. `all` collapses to the bare id. */
export function setConnectorMode(
  choices: ConnectorChoice[],
  id: number,
  mode: ConnectorMode,
): ConnectorChoice[] {
  return choices.map((choice) => {
    if (connectorId(choice) !== id) return choice;
    // `all` with no named tools is the bare form: one spelling per meaning.
    if (mode === 'all') return id;
    const tools = typeof choice === 'number' ? [] : choice.tools;
    return { id, mode, tools };
  });
}

/** Set the named tools of one `selected` connection. */
export function setConnectorTools(
  choices: ConnectorChoice[],
  id: number,
  tools: string[],
): ConnectorChoice[] {
  return choices.map((choice) =>
    connectorId(choice) === id ? { id, mode: 'selected' as const, tools } : choice);
}

/**
 * Apply a multi-select's id list, keeping the mode already chosen for each
 * connection that stays selected. Ids that are not numbers are dropped.
 */
export function reconcileConnectors(current: ConnectorChoice[], selectedIds: string[]): ConnectorChoice[] {
  const byId = new Map(current.map((c) => [connectorId(c), c]));
  return selectedIds
    .map(Number)
    .filter((id) => !Number.isNaN(id))
    .map((id) => byId.get(id) ?? id);
}

/* ---------- tags ---------- */

/** Trim and collapse internal whitespace, as the tag input does before it stores a tag. */
export function normaliseTag(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/**
 * Add a tag unless it is blank or already present, ignoring case. The server
 * de-duplicates the same way on save, so a tag that would come back missing is
 * never shown as accepted.
 */
export function addTag(tags: string[], raw: string): string[] {
  const tag = normaliseTag(raw);
  if (!tag) return tags;
  if (tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return tags;
  return [...tags, tag];
}

/* ---------- browser domains ---------- */

/** A comma-separated host list, trimmed, with blanks dropped. Subdomains are implied by the server. */
export function parseDomainList(text: string): string[] {
  return text.split(',').map((d) => d.trim()).filter(Boolean);
}

/* ---------- run limit ---------- */

/**
 * The run limit is typed in minutes and stored in seconds. A value outside
 * 1..120 minutes is clamped, and anything not a number is read as the minimum.
 */
export function runLimitSeconds(minutes: number): number {
  const clamped = Number.isFinite(minutes)
    ? Math.max(RUN_LIMIT_MIN_MINUTES, Math.min(RUN_LIMIT_MAX_MINUTES, minutes))
    : RUN_LIMIT_MIN_MINUTES;
  return clamped * 60;
}

/** The run limit in whole minutes, for display. */
export function runLimitMinutes(seconds: number): number {
  return Math.round(seconds / 60);
}

/* ---------- per-tool rules ---------- */

/**
 * Toggle one tool's rule. Picking the active mode clears it back to inherit
 * (unset), so there are three buttons and four states with no separate reset.
 */
export function toggleToolPermission(
  current: Record<string, ToolPermissionMode> | undefined,
  tool: string,
  mode: ToolPermissionMode,
): Record<string, ToolPermissionMode> {
  const next = { ...(current ?? {}) };
  if (next[tool] === mode) delete next[tool];
  else next[tool] = mode;
  return next;
}

/**
 * Drop rules for tools the grants no longer unlock. Applied at save, not on
 * toggle, so switching a group off and back on within one edit keeps the rules.
 */
export function pruneToolPermissions(
  current: Record<string, ToolPermissionMode> | undefined,
  grantedToolIds: string[],
): Record<string, ToolPermissionMode> {
  const granted = new Set(grantedToolIds);
  const next: Record<string, ToolPermissionMode> = {};
  for (const [tool, mode] of Object.entries(current ?? {})) {
    if (granted.has(tool)) next[tool] = mode;
  }
  return next;
}

/** How many rules actually narrow a granted tool. The knob's hint. */
export function countToolPermissions(
  current: Record<string, ToolPermissionMode> | undefined,
  grantedToolIds: string[],
): number {
  const granted = new Set(grantedToolIds);
  return Object.keys(current ?? {}).filter((t) => granted.has(t)).length;
}

/**
 * The tools the switches on the board unlock, read from the tool catalogue so the
 * picker can never offer a name the runtime does not grant. Always-on and
 * unserved tools are left out, as the web does.
 */
export function grantedToolsFor(
  catalogue: ToolsCatalogue | null | undefined,
  grants: ToolGrants,
): { id: string; label: string; hint: string }[] {
  const categories = (catalogue?.categories ?? []).filter(
    (c) => c.grantBacked && grants[c.key as keyof ToolGrants],
  );
  return categories.flatMap((c) =>
    c.tools
      .filter((t) => !t.alwaysAvailable && !t.unserved)
      .map((t) => ({
        id: t.name,
        label: t.displayName,
        hint: `${c.label} · ${t.description.split('. ')[0]}`,
      })),
  );
}

/* ---------- delegation ---------- */

/**
 * Why another agent cannot be delegated to, or null if it can. A delegated run is
 * unattended, so the runtime refuses a target that is paused or not cleared to
 * run on its own. Said where the choice is made, not in a run log.
 */
export function delegationBlocker(agent: { status?: string; allowUnattended?: boolean }): string | null {
  if (agent.status === 'paused') return 'Paused — delegation to it is refused.';
  if (!agent.allowUnattended) return 'Not cleared to run automatically — delegation to it is refused.';
  return null;
}

/* ---------- the board as a whole ---------- */

/** A saved agent, filled over the defaults: the board's starting point. Mirrors the web's `{...DEFAULT_AGENT, ...existing}`. */
export function configFromAgent(agent: Agent | AgentConfig): AgentConfig {
  return { ...DEFAULT_AGENT, ...agent } as AgentConfig;
}

/**
 * Whether the board differs from what is saved. A run uses the saved configuration,
 * so leaving with unsaved edits should say so. Compares the same canonical
 * serialisation the web uses.
 */
export function isDirty(existing: Agent | null | undefined, cfg: AgentConfig): boolean {
  if (!existing) return false;
  return JSON.stringify({ ...DEFAULT_AGENT, ...existing }) !== JSON.stringify(cfg);
}
