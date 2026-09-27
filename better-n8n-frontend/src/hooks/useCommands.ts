/**
 * One slash-command catalogue for the session.
 *
 * Fetched once per session and refetched when Connections or the builder
 * change (either can hide or reveal commands: an engine at `none` hides its
 * commands, a new agent/skill/project/connection adds a completion
 * candidate). The palette ranks locally from this list; completion and
 * validation stay server-side.
 */
import { useQuery } from '@tanstack/react-query';
import commandsService from '../api/commands';
import type { CommandDef } from '../lib/commands';

export const COMMANDS_QUERY_KEY = ['commands'];

export function useCommands(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const query = useQuery({
    queryKey: COMMANDS_QUERY_KEY,
    queryFn: () => commandsService.list(),
    staleTime: 5 * 60 * 1000,
    enabled,
  });

  return {
    commands: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export type { CommandDef };
