/* Cmd+K: what the command menu offers, and how it orders what someone types.
 *
 * Pure on purpose. `buildCommands` turns the lists the app already has into
 * rows, and `rankCommands` decides their order, so the rules are tested without
 * a DOM. The menu never fetches: recent chats and agents are read from the
 * react-query cache that the Ask and Agents pages fill (`readCachedSources`).
 * A cache miss means those rows are simply absent.
 */
import type { QueryClient } from '@tanstack/react-query';
import type { ChatSessionSummary } from '../api/chat';
import type { Agent } from '../api/agents';
import { navGroups } from './navigation';

export type CommandSection = 'Actions' | 'Go to' | 'Recent chats' | 'Agents';

/** Display order, and the tie-break when two matches rank the same. */
export const SECTION_ORDER: readonly CommandSection[] = ['Actions', 'Go to', 'Recent chats', 'Agents'];

/** The only sections an empty query shows. */
const EMPTY_QUERY_SECTIONS: readonly CommandSection[] = ['Actions', 'Go to'];

export interface CommandItem {
  id: string;
  section: CommandSection;
  label: string;
  /** Shown on the row, and searched after the label. */
  hint?: string;
  /** Searched after the hint, never shown. */
  keywords?: string[];
  /** Where Enter goes. */
  to: string;
  /** Location state for the target. New chat asks the composer for a fresh chat. */
  state?: { newChat: true };
}

/**
 * The Settings sections, in the order Settings shows them.
 *
 * Mirrors the `tabs` array inside `pages/Settings.tsx`, which is not exported.
 * `lib/__tests__/commandMenu.test.ts` reads that array and fails when these
 * ids or labels drift from it. The `organization` tab (it redirects to Team)
 * and the hidden `security` tab are left out on purpose.
 */
export const SETTINGS_SECTIONS: readonly { id: string; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'account', label: 'Account' },
  { id: 'orchestrator', label: 'Orchestrator' },
  { id: 'insights', label: 'Insights' },
  { id: 'billing', label: 'Billing' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'memory', label: 'Memory' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'api', label: 'API' },
];

/* The query keys the pages fill. The menu only reads them. */
/** Filled by `features/chat/components/StandaloneChat.tsx`. */
export const CHAT_SESSIONS_KEY = ['chatSessions'] as const;
/** Filled by `pages/Agents.tsx`. */
export const AGENTS_KEY = ['agents'] as const;

/** Caps on what one search reads from the cache. The lists are already bounded. */
export const CHAT_SEARCH_LIMIT = 100;
export const AGENT_SEARCH_LIMIT = 100;

export interface CachedSources {
  chats?: ChatSessionSummary[];
  agents?: Agent[];
}

/** What is already in the cache, never a request. */
export function readCachedSources(queryClient: QueryClient): CachedSources {
  return {
    chats: queryClient.getQueryData<ChatSessionSummary[]>(CHAT_SESSIONS_KEY),
    agents: queryClient.getQueryData<Agent[]>(AGENTS_KEY),
  };
}

/** Every row the menu can show, in section order. */
export function buildCommands({ chats = [], agents = [] }: CachedSources): CommandItem[] {
  const destinations = navGroups.flatMap((group) => group.items);

  const actions: CommandItem[] = [
    { id: 'action:new-chat', section: 'Actions', label: 'New chat', to: '/ai-chat', state: { newChat: true } },
    { id: 'action:new-agent', section: 'Actions', label: 'New agent', to: '/agents/new' },
    { id: 'action:upload', section: 'Actions', label: 'Upload files', to: '/documents' },
  ];

  const goTo: CommandItem[] = [
    ...destinations.map((item): CommandItem => ({
      id: `go:${item.path}`,
      section: 'Go to',
      label: item.label,
      to: item.path,
    })),
    { id: 'go:/profile', section: 'Go to', label: 'Profile', to: '/profile' },
    { id: 'go:/settings', section: 'Go to', label: 'Settings', to: '/settings' },
    // Every hub tab. Its hint names the hub, so "Files" reads as Library's Files.
    ...destinations.flatMap((item) =>
      (item.tabs ?? []).map((tab): CommandItem => ({
        id: `tab:${tab.path}`,
        section: 'Go to',
        label: tab.label,
        hint: item.label,
        to: tab.path,
      })),
    ),
    ...SETTINGS_SECTIONS.map((s): CommandItem => ({
      id: `settings:${s.id}`,
      section: 'Go to',
      label: s.label,
      hint: 'Settings',
      to: `/settings?tab=${s.id}`,
    })),
  ];

  const recentChats: CommandItem[] = chats.slice(0, CHAT_SEARCH_LIMIT).map((chat) => ({
    id: `chat:${chat.id}`,
    section: 'Recent chats',
    label: (chat.title || '').trim() || 'Untitled chat',
    to: `/ai-chat?session=${encodeURIComponent(chat.id)}`,
  }));

  // Archived agents are filed away, so they are not offered as a jump target.
  const agentRows: CommandItem[] = agents
    .filter((agent) => agent.status !== 'archived')
    .slice(0, AGENT_SEARCH_LIMIT)
    .map((agent) => ({
      id: `agent:${agent.id}`,
      section: 'Agents',
      label: (agent.name || '').trim() || 'Untitled agent',
      hint: (agent.description || '').trim() || undefined,
      keywords: agent.tags ?? [],
      to: `/agents/${agent.id}`,
    }));

  return [...actions, ...goTo, ...recentChats, ...agentRows];
}

export function normaliseQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase();
}

const WORD_BREAK = /[^\p{L}\p{N}]+/u;

/** The query starts the text, or starts any word in it. */
function startsAWord(text: string, q: string): boolean {
  return text.startsWith(q) || text.split(WORD_BREAK).some((word) => word.startsWith(q));
}

/**
 * How well an item matches, lower is better, or null for no match.
 *   0  a word in the label starts with the query ("agents" in "My agents")
 *   1  the label contains the query somewhere
 *   2  a word in the hint or keywords starts with it
 *   3  the hint or keywords contain it somewhere
 */
export function matchRank(query: string, item: CommandItem): number | null {
  const q = normaliseQuery(query);
  const label = item.label.toLowerCase();
  if (startsAWord(label, q)) return 0;
  if (label.includes(q)) return 1;
  const extra = [item.hint ?? '', ...(item.keywords ?? [])].join(' · ').toLowerCase();
  if (startsAWord(extra, q)) return 2;
  if (extra.includes(q)) return 3;
  return null;
}

/**
 * The rows to show for a query. An empty query shows only Actions and Go to,
 * in their own order. Otherwise every match, best rank first, and ties keep
 * section order and then build order.
 */
export function rankCommands(query: string, items: readonly CommandItem[]): CommandItem[] {
  if (normaliseQuery(query) === '') {
    return items.filter((item) => EMPTY_QUERY_SECTIONS.includes(item.section));
  }
  const ranked: { item: CommandItem; rank: number; section: number; index: number }[] = [];
  items.forEach((item, index) => {
    const rank = matchRank(query, item);
    if (rank !== null) {
      ranked.push({ item, rank, section: SECTION_ORDER.indexOf(item.section), index });
    }
  });
  ranked.sort((a, b) => a.rank - b.rank || a.section - b.section || a.index - b.index);
  return ranked.map((r) => r.item);
}

/**
 * The next active row for an arrow key. Wraps at both ends. With no rows it is
 * -1, and a stale index starts from the nearest end.
 */
export function nextIndex(current: number, step: 1 | -1, count: number): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return step === 1 ? 0 : count - 1;
  return (current + step + count) % count;
}

/** Ctrl+K, or Cmd+K on a Mac. Shift and Alt are other chords, so they are left alone.
 * A press an editor already handled (`defaultPrevented`) stays the editor's: CodeMirror
 * binds the Mac's Control+K to "delete to line end", and it runs before this window
 * listener. Any editor that later claims Ctrl+K (e.g. "insert link") wins the same way. */
export function isCommandMenuShortcut(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  defaultPrevented?: boolean;
}): boolean {
  if (e.defaultPrevented) return false;
  return (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k';
}

/** The shortcut as a person on this platform writes it, for the Search button. */
export function commandMenuShortcutLabel(userAgent: string): string {
  return /Mac|iPhone|iPad|iPod/i.test(userAgent) ? '⌘K' : 'Ctrl+K';
}

/** Window event that opens the menu. The Search buttons fire it; App.tsx listens. */
export const OPEN_COMMAND_MENU_EVENT = 'aiaas:open-command-menu';

export function requestCommandMenu(): void {
  window.dispatchEvent(new Event(OPEN_COMMAND_MENU_EVENT));
}
