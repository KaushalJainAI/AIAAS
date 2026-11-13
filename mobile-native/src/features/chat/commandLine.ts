/**
 * Slash commands: parsing, ranking and chip serialisation. Port of
 * better-n8n-frontend/src/lib/commands.ts, kept pure so the composer can ask
 * synchronous questions (is this a command line, which one, how to rank).
 * The server stays the authority on listing, completion and validation.
 *
 * Rules, mirroring chat/commands/resolve.py: only a leading `/` (after
 * whitespace) opens a command. A `/` mid-sentence is plain text, so a path
 * like `/Chat/notes.md` never triggers anything.
 */
import type { CommandChip, CommandDef } from './types';

export interface ParsedCommandLine {
  name: string;
  rest: string;
}

/** Splits a leading `/name rest` line. Null for anything that is not a command line. */
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

function scoreCandidate(query: string, command: CommandDef): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const name = command.name.toLowerCase();
  const summary = (command.summary ?? '').toLowerCase();
  const aliases = (command.aliases ?? []).map((a) => a.toLowerCase());
  if (name === q || aliases.includes(q)) return 100;
  if (name.startsWith(q)) return 80;
  if (aliases.some((a) => a.startsWith(q))) return 70;
  if (name.includes(q)) return 60;
  // Subsequence match on the name ("cr" finds "code-review").
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

/** Palette ranking: fuzzy match on name and summary, best first. */
export function rankCommands(query: string, commands: CommandDef[]): CommandDef[] {
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return [...commands];
  return commands
    .map((command) => ({ command, score: scoreCandidate(q, command) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.command);
}

/** Resolves a typed name against the catalogue, aliases included. */
export function findCommand(name: string, commands: CommandDef[]): CommandDef | null {
  const key = (name ?? '').trim().toLowerCase().replace(/^\//, '');
  if (!key) return null;
  for (const command of commands) {
    if (command.name.toLowerCase() === key) return command;
    if ((command.aliases ?? []).some((a) => a.toLowerCase() === key)) return command;
  }
  return null;
}

/** The text a chosen command leaves in the box: `/name`, plus its chip label when one was picked. */
export function commandPrefix(command: CommandDef, chip?: CommandChip | null): string {
  return chip ? `/${command.name} ${chip.label}` : `/${command.name}`;
}

/**
 * The task text after a command and its chip: whatever the person typed past
 * the prefix. When the prefix was edited away, the whole box is the task.
 */
export function taskAfterPrefix(input: string, command: CommandDef, chip?: CommandChip | null): string {
  const prefix = commandPrefix(command, chip);
  return input.startsWith(prefix) ? input.slice(prefix.length).trim() : input.trim();
}

/** `TurnRequest.command` payload. Chips carry ids, so the server never re-resolves a chosen name. */
export function buildCommandPayload(
  command: CommandDef,
  chip: CommandChip | null,
  text: string,
): { name: string; args: Record<string, unknown>; text: string } {
  const args: Record<string, unknown> = {};
  if (chip) args[chip.arg] = chip.id;
  return { name: command.name, args, text };
}

/** Durations for `/pause` (`90m`, `2h`, `3d`, bare minutes). Null when invalid. */
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

/** Argument kinds the server can complete from `/chat/commands/complete/`. */
const COMPLETABLE = new Set(['agent', 'skill', 'model', 'effort', 'file', 'project', 'connection', 'mission']);

/** The first required argument the server completes, if the command takes one. */
export function completableArg(command: CommandDef): { name: string; kind: string } | null {
  const arg = (command.args ?? []).find((a) => COMPLETABLE.has(a.kind) && a.required);
  return arg ? { name: arg.name, kind: arg.kind } : null;
}
