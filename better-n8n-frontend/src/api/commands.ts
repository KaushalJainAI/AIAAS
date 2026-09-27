/**
 * Slash-command catalogue + completion + action runs (§18.7).
 *
 * The server is the authority: `GET /api/chat/commands/` lists what this
 * user can run (filtered like tools — an engine at `none` hides the command
 * rather than showing one that refuses), and `/complete/` returns candidates
 * computed with the same predicate validation uses. This service is transport
 * only; ranking and parsing live in `lib/commands.ts` (pure, vitest-covered).
 */
import apiClient from './client';
import type { CommandChip, CommandDef } from '../lib/commands';

const commandsService = {
  /** Commands this user can run, for the palette and `/help`. */
  async list(): Promise<CommandDef[]> {
    const { data } = await apiClient.get<{ commands: CommandDef[] }>(
      '/chat/commands/',
    );
    return Array.isArray(data?.commands) ? data.commands : [];
  },

  /** Run an action-kind command server-side and return its card. */
  async run(
    name: string,
    args: Record<string, unknown> = {},
    chips: Record<string, string> = {},
    confirm: Record<string, unknown> = {},
  ): Promise<{
    command: string;
    card?: Record<string, unknown>;
    message?: string;
    args?: Record<string, unknown>;
    needs_confirm?: boolean;
  }> {
    const { data } = await apiClient.post('/chat/commands/run/', {
      name,
      args,
      chips,
      confirm,
    });
    return data;
  },

  /** Carry out a confirm-sheet decision (mission start, schedule arm, ...). */
  async confirm(
    name: string,
    args: Record<string, unknown> = {},
    confirm: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const { data } = await apiClient.post('/chat/commands/confirm/', {
      name,
      args,
      confirm,
    });
    return data;
  },
};

export type { CommandChip, CommandDef };
export default commandsService;
