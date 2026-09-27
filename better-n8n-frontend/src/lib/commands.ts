/**
 * Slash commands: parsing, fuzzy match, chip serialisation (§18.3).
 *
 * Pure and vitest-covered: no imports from components, hooks or api. The
 * server is the authority on listing, completion and validation
 * (`GET /api/chat/commands/`, `/complete/`, `TurnRequest.command`); this
 * module answers only what the composer needs synchronously — is this a
 * command line, which command does it name, how should the palette rank.
 *
 * Rules pinned here (mirroring `chat/commands/resolve.py`):
 * - Only a leading `/` (after whitespace) opens a command. A `/` anywhere
 *   else is plain text: a path like `/Chat/notes.md` in a sentence must
 *   never trigger it.
 * - Fuzzy match ranks on name + summary; Enter/Tab picks, Esc closes.
 * - A resolved entity (agent, skill, file, connection) becomes a chip
 *   carrying its id, so the request never re-resolves a name already chosen.
 */

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
  /** Shown only when the requirement is met; the server filters the list. */
  requires?: string | null;
  guest?: boolean;
}

/** One picked entity: the label the user saw and the id the server resolves. */
export interface CommandChip {
  arg: string;
  id: string;
  label: string;
}

export interface ParsedCommandLine {
  name: string;
  rest: string;
}

/**
 * Split a leading `/name ...` line. Returns null for anything that is not a
 * command line — including a `/` mid-sentence.
 */
export function splitCommandLine(content: string): ParsedCommandLine | null {
  const stripped = (content ?? '').replace(/^\s+/, '');
  if (!stripped.startsWith('/')) return null;
  const after = stripped.slice(1);
  if (!after.trim()) return null;
  const space = after.search(/\s/);
  if (space === -1) return { name: after.trim().toLowerCase(), rest: '' };
  return {
    name: after.slice(0, space).trim().toLowerCase(),
    rest: after.slice(space + 1).trim(),
  };
}

export function isCommandLine(content: string): boolean {
  return splitCommandLine(content) !== null;
}

function scoreCandidate(
  query: string,
  command: CommandDef,
): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const name = command.name.toLowerCase();
  const summary = (command.summary ?? '').toLowerCase();
  const aliases = (command.aliases ?? []).map((a) => a.toLowerCase());
  if (name === q || aliases.includes(q)) return 100;
  if (name.startsWith(q)) return 80;
  if (aliases.some((a) => a.startsWith(q))) return 70;
  if (name.includes(q)) return 60;
  // Subsequence match on the name (e.g. "cr" matches "code-review").
  let at = 0;
  let matched = 0;
  for (const ch of q) {
    const found = name.indexOf(ch, at);
    if (found === -1) break;
    at = found + 1;
    matched += 1;
  }
  if (matched === q.length && q.length > 1) return 40;
  if (summary.includes(q)) return 20;
  return -1;
}

/** Palette ranking: fuzzy match on name + summary, best first. */
export function rankCommands(
  query: string,
  commands: CommandDef[],
): CommandDef[] {
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return [...commands];
  return commands
    .map((command) => ({ command, score: scoreCandidate(q, command) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.command);
}

/** Resolve a typed name against the catalogue, including aliases. */
export function findCommand(
  name: string,
  commands: CommandDef[],
): CommandDef | null {
  const key = (name ?? '').trim().toLowerCase().replace(/^\//, '');
  if (!key) return null;
  for (const command of commands) {
    if (command.name.toLowerCase() === key) return command;
    if ((command.aliases ?? []).some((a) => a.toLowerCase() === key)) {
      return command;
    }
  }
  return null;
}

/**
 * Build the composer text after a palette pick (`/name <task>`).
 *
 * The task text is whatever the user had already typed, so opening the
 * palette from the Commands button never discards prose: a partial `/par`
 * filter is replaced, but plain text (`summarise this`) is kept as the
 * task following the picked command. A bare `/` or empty box yields just
 * the command prefix.
 */
export function prefillCommandInput(input: string, name: string): string {
  const trimmed = (input ?? '').trim();
  if (!trimmed || trimmed === '/') return `/${name} `;
  const parsed = splitCommandLine(input);
  const rest = parsed ? parsed.rest : trimmed;
  return rest ? `/${name} ${rest}` : `/${name} `;
}

/**
 * Serialise chips into the `TurnRequest.command` payload. Chips carry ids so
 * the backend never re-resolves a name the user already chose.
 */
export function buildCommandPayload(
  command: CommandDef,
  chips: CommandChip[],
  text: string,
): { name: string; args: Record<string, unknown>; text: string } {
  const args: Record<string, unknown> = {};
  for (const chip of chips) {
    args[chip.arg] = chip.id;
  }
  return { name: command.name, args, text };
}

/** Render a resolved command as a transcript chip ("/agent Reporter"). */
export function chipLabel(
  command: string,
  args: Record<string, unknown>,
  labels?: Record<string, string>,
): string {
  const name = (command ?? '').replace(/^\//, '');
  const first = Object.values(args ?? {})[0];
  const label = first != null && String(first).trim()
    ? (labels?.[String(first)] ?? String(first))
    : '';
  return label ? `/${name} ${label}` : `/${name}`;
}

/** Durations for `/pause` (`90m`, `2h`, `3d`, bare minutes). Null = invalid. */
export function parseDurationSeconds(text: string): number | null {
  const raw = (text ?? '').trim().toLowerCase();
  if (!raw) return null;
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  const last = raw[raw.length - 1];
  if (last in multipliers && /^\d+$/.test(raw.slice(0, -1).trim())) {
    return parseInt(raw.slice(0, -1).trim(), 10) * multipliers[last];
  }
  if (/^\d+$/.test(raw)) return parseInt(raw, 10) * 60;
  return null;
}
