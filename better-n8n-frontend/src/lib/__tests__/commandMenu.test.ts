import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { ChatSessionSummary } from '../../api/chat';
import type { Agent } from '../../api/agents';
import { navGroups } from '../navigation';
import {
  AGENT_SEARCH_LIMIT,
  AGENTS_KEY,
  CHAT_SEARCH_LIMIT,
  CHAT_SESSIONS_KEY,
  SETTINGS_SECTIONS,
  buildCommands,
  commandMenuShortcutLabel,
  defaultActiveIndex,
  isCommandMenuShortcut,
  matchRank,
  nextIndex,
  rankCommands,
  readCachedSources,
  type CommandItem,
} from '../commandMenu';
import type { RecentPage } from '../recentPages';

const settingsSource = readFileSync(
  fileURLToPath(new URL('../../pages/Settings.tsx', import.meta.url)),
  'utf8',
);

/* Settings.tsx keeps its tab list in a local `const tabs = [...]`, so it cannot
 * be imported. Read the list out of the source instead: the test fails when a
 * section in SETTINGS_SECTIONS disappears from Settings, and when Settings gains
 * a section the menu does not list. */
function settingsTabsInSource(): { id: string; label: string }[] {
  const start = settingsSource.indexOf('const tabs = [');
  expect(start, 'Settings.tsx should still declare `const tabs = [`').toBeGreaterThan(-1);
  const end = settingsSource.indexOf('];', start);
  const block = settingsSource
    .slice(start, end)
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  return [...block.matchAll(/\{ id: '([a-z]+)' as const, label: '([^']+)'/g)].map((m) => ({
    id: m[1],
    label: m[2],
  }));
}

function item(partial: Partial<CommandItem> & Pick<CommandItem, 'label' | 'section'>): CommandItem {
  return { id: partial.label, to: '/x', ...partial };
}

describe('Settings sections', () => {
  it('match the tabs Settings.tsx shows, in the same order', () => {
    expect(settingsTabsInSource()).toEqual(SETTINGS_SECTIONS);
  });

  it('every section is a real Settings tab id, so ?tab= opens it', () => {
    const linkable = settingsSource.match(/LINKABLE_TABS: readonly string\[\] = \[([^\]]*)\]/);
    expect(linkable).not.toBeNull();
    for (const s of SETTINGS_SECTIONS) {
      expect(linkable![1]).toContain(`'${s.id}'`);
    }
  });
});

describe('buildCommands', () => {
  const chat = (id: string, title: string) =>
    ({ id, title, llm_provider: '', llm_model: '', llm_effort: '', intent: '', system_prompt: '' }) as unknown as ChatSessionSummary;
  const agent = (id: number, name: string, status = 'active', extra: Partial<Agent> = {}) =>
    ({ id, name, status, description: '', tags: [], ...extra }) as unknown as Agent;

  it('offers the five destinations, every hub tab and every Settings section under Go to', () => {
    const rows = buildCommands({}).filter((r) => r.section === 'Go to');
    const destinations = navGroups.flatMap((g) => g.items);
    for (const d of destinations) {
      expect(rows.find((r) => r.to === d.path && r.label === d.label)).toBeTruthy();
    }
    for (const tab of destinations.flatMap((d) => d.tabs ?? [])) {
      expect(rows.some((r) => r.to === tab.path && r.label === tab.label)).toBe(true);
    }
    for (const s of SETTINGS_SECTIONS) {
      expect(rows.some((r) => r.to === `/settings?tab=${s.id}` && r.label === s.label)).toBe(true);
    }
  });

  it('keeps sections in display order', () => {
    const order = buildCommands({ chats: [chat('1', 'a')], agents: [agent(1, 'b')] }).map((r) => r.section);
    const unique = order.filter((s, i) => order.indexOf(s) === i);
    expect(unique).toEqual(['Actions', 'Go to', 'Recent chats', 'Agents']);
  });

  it('New chat asks the composer for a fresh chat', () => {
    const newChat = buildCommands({}).find((r) => r.label === 'New chat');
    expect(newChat?.to).toBe('/ai-chat');
    expect(newChat?.state).toEqual({ newChat: true });
  });

  it('links a chat to its session and an agent to its builder', () => {
    const rows = buildCommands({ chats: [chat('a b', 'Plan')], agents: [agent(7, 'Digest')] });
    expect(rows.find((r) => r.section === 'Recent chats')?.to).toBe('/ai-chat?session=a%20b');
    expect(rows.find((r) => r.section === 'Agents')?.to).toBe('/agents/7');
  });

  it('leaves archived agents out', () => {
    const rows = buildCommands({ agents: [agent(1, 'Live'), agent(2, 'Old', 'archived')] });
    expect(rows.filter((r) => r.section === 'Agents').map((r) => r.label)).toEqual(['Live']);
  });

  it('names an untitled chat and agent rather than showing a blank row', () => {
    const rows = buildCommands({ chats: [chat('1', '   ')], agents: [agent(1, '')] });
    expect(rows.find((r) => r.section === 'Recent chats')?.label).toBe('Untitled chat');
    expect(rows.find((r) => r.section === 'Agents')?.label).toBe('Untitled agent');
  });

  it('caps what one search reads from the cache', () => {
    const many = Array.from({ length: CHAT_SEARCH_LIMIT + 5 }, (_, i) => chat(String(i), `c${i}`));
    const manyAgents = Array.from({ length: AGENT_SEARCH_LIMIT + 5 }, (_, i) => agent(i, `a${i}`));
    const rows = buildCommands({ chats: many, agents: manyAgents });
    expect(rows.filter((r) => r.section === 'Recent chats')).toHaveLength(CHAT_SEARCH_LIMIT);
    expect(rows.filter((r) => r.section === 'Agents')).toHaveLength(AGENT_SEARCH_LIMIT);
  });
});

describe('readCachedSources', () => {
  it('reads only what is cached and never fetches a missing list', () => {
    const client = new QueryClient();
    expect(readCachedSources(client)).toEqual({ chats: undefined, agents: undefined });
  });

  it('reads the two keys the pages fill', () => {
    const client = new QueryClient();
    client.setQueryData(CHAT_SESSIONS_KEY, [{ id: '1', title: 'x' }]);
    client.setQueryData(AGENTS_KEY, [{ id: 1, name: 'y' }]);
    const sources = readCachedSources(client);
    expect(sources.chats).toHaveLength(1);
    expect(sources.agents).toHaveLength(1);
    expect(CHAT_SESSIONS_KEY).toEqual(['chatSessions']);
    expect(AGENTS_KEY).toEqual(['agents']);
  });
});

describe('rankCommands', () => {
  const items: CommandItem[] = [
    item({ label: 'New chat', section: 'Actions' }),
    item({ label: 'Billing', section: 'Go to', hint: 'Settings' }),
    item({ label: 'Chatty helper', section: 'Agents' }),
    item({ label: 'My agents', section: 'Go to', hint: 'Agents' }),
    item({ label: 'Plan the chat', section: 'Recent chats' }),
  ];

  it('an empty query shows only Actions and Go to, in their own order', () => {
    const rows = rankCommands('   ', items);
    expect(rows.map((r) => r.label)).toEqual(['New chat', 'Billing', 'My agents']);
    expect(rows.every((r) => r.section === 'Actions' || r.section === 'Go to')).toBe(true);
  });

  it('a word that starts a label beats a substring in the middle of one', () => {
    // "Ranch notes" is built first and in the same section, but "ch" only sits
    // inside "ranch". "New chat" has a word that starts with "ch", so it wins.
    const pair: CommandItem[] = [
      item({ label: 'Ranch notes', section: 'Actions' }),
      item({ label: 'New chat', section: 'Actions' }),
    ];
    expect(rankCommands('ch', pair).map((r) => r.label)).toEqual(['New chat', 'Ranch notes']);
  });

  it('a plain substring still matches, after the word-start matches', () => {
    const rows = rankCommands('ill', items).map((r) => r.label);
    expect(rows).toEqual(['Billing']);
    const sub = rankCommands('lan', items).map((r) => r.label);
    expect(sub).toEqual(['Plan the chat']);
  });

  it('a hint or keyword match ranks below any label match', () => {
    // "agents" starts the label "My agents" (rank 0) and is the hint of nothing else here.
    // "settings" is only the hint of Billing, so it is a rank-2 match.
    const rows = rankCommands('settings', items).map((r) => r.label);
    expect(rows).toEqual(['Billing']);
    expect(matchRank('settings', items[1])).toBe(2);
    expect(matchRank('agents', items[3])).toBe(0);
  });

  it('ties keep section order, then build order', () => {
    const tied: CommandItem[] = [
      item({ label: 'Zed chat', section: 'Agents' }),
      item({ label: 'Yes chat', section: 'Actions' }),
      item({ label: 'Xa chat', section: 'Recent chats' }),
    ];
    expect(rankCommands('chat', tied).map((r) => r.section)).toEqual(['Actions', 'Recent chats', 'Agents']);
  });

  it('ignores case and repeated spaces', () => {
    expect(rankCommands('  NEW   chat ', items).map((r) => r.label)).toEqual(['New chat']);
  });

  it('returns nothing when no row matches', () => {
    expect(rankCommands('zzqq', items)).toEqual([]);
  });

  it('on the real catalogue, "agents" finds the Agents destination and its My agents tab', () => {
    const rows = rankCommands('agents', buildCommands({})).map((r) => r.label);
    expect(rows).toContain('My agents');
    expect(rows).toContain('Agents');
  });
});

describe('matchRank', () => {
  it('is null when neither the label nor the hint matches', () => {
    expect(matchRank('nope', item({ label: 'Billing', section: 'Go to', hint: 'Settings' }))).toBeNull();
  });
});

describe('nextIndex', () => {
  it('moves down and wraps to the top', () => {
    expect(nextIndex(0, 1, 3)).toBe(1);
    expect(nextIndex(2, 1, 3)).toBe(0);
  });

  it('moves up and wraps to the bottom', () => {
    expect(nextIndex(0, -1, 3)).toBe(2);
    expect(nextIndex(1, -1, 3)).toBe(0);
  });

  it('starts from the nearest end when the index is stale or unset', () => {
    expect(nextIndex(-1, 1, 3)).toBe(0);
    expect(nextIndex(-1, -1, 3)).toBe(2);
    expect(nextIndex(9, 1, 3)).toBe(0);
  });

  it('is -1 with no rows', () => {
    expect(nextIndex(0, 1, 0)).toBe(-1);
  });
});

describe('isCommandMenuShortcut', () => {
  const press = (over: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }>) => ({
    key: 'k', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over,
  });

  it('opens on Ctrl+K and on Cmd+K', () => {
    expect(isCommandMenuShortcut(press({ ctrlKey: true }))).toBe(true);
    expect(isCommandMenuShortcut(press({ metaKey: true }))).toBe(true);
    expect(isCommandMenuShortcut(press({ ctrlKey: true, key: 'K' }))).toBe(true);
  });

  it('is not Shift, Alt, or a bare K', () => {
    expect(isCommandMenuShortcut(press({}))).toBe(false);
    expect(isCommandMenuShortcut(press({ ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isCommandMenuShortcut(press({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(isCommandMenuShortcut(press({ ctrlKey: true, key: 'j' }))).toBe(false);
  });

  it('leaves a press an editor already handled to that editor', () => {
    // CodeMirror's Mac Control+K (delete to line end) calls preventDefault first.
    expect(isCommandMenuShortcut({ ...press({ ctrlKey: true }), defaultPrevented: true })).toBe(false);
    expect(isCommandMenuShortcut({ ...press({ metaKey: true }), defaultPrevented: false })).toBe(true);
  });
});

describe('commandMenuShortcutLabel', () => {
  it('shows the Mac chord on Apple devices and Ctrl+K elsewhere', () => {
    expect(commandMenuShortcutLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('⌘K');
    expect(commandMenuShortcutLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe('⌘K');
    expect(commandMenuShortcutLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Ctrl+K');
  });
});

describe('Recent pages in the menu', () => {
  const NOW = 10 * 60_000;
  const recent = (path: string, title: string, at: number): RecentPage => ({ path, title, at });
  const pages: RecentPage[] = [
    recent('/agents/12', 'Digest agent', NOW - 5 * 60_000),
    recent('/runs', 'Activity', NOW - 60 * 60_000),
    recent('/documents', 'Library · Files', NOW - 2 * 24 * 60 * 60_000),
  ];

  it('shows Recent first on an empty query, ahead of Actions and Go to', () => {
    const rows = rankCommands('', buildCommands({ recentPages: pages, now: NOW }));
    expect(rows.slice(0, 3).map((r) => r.section)).toEqual(['Recent', 'Recent', 'Recent']);
    expect(rows[3].section).toBe('Actions');
    expect(rows.slice(0, 3).map((r) => r.id)).toEqual(['recent:/agents/12', 'recent:/runs', 'recent:/documents']);
  });

  it('gives each Recent row its title, its path, and how long ago it was', () => {
    const [first] = buildCommands({ recentPages: pages, now: NOW }).filter((r) => r.section === 'Recent');
    expect(first).toMatchObject({ label: 'Digest agent', to: '/agents/12', note: '5 min ago' });
  });

  it('skips the page the menu was opened on', () => {
    const rows = buildCommands({ recentPages: pages, currentPath: '/agents/12', now: NOW });
    const recents = rows.filter((r) => r.section === 'Recent');
    expect(recents.map((r) => r.to)).toEqual(['/runs', '/documents']);
  });

  it('is searched by title like the other rows, and found outside an empty query', () => {
    const rows = rankCommands('library', buildCommands({ recentPages: pages, now: NOW }));
    expect(rows[0]).toMatchObject({ section: 'Recent', label: 'Library · Files' });
  });

  it('a note is not searched, so a time word does not match', () => {
    const rows = rankCommands('ago', buildCommands({ recentPages: pages, now: NOW }));
    expect(rows.some((r) => r.section === 'Recent')).toBe(false);
  });

  it('an empty list has no Recent section', () => {
    const rows = buildCommands({ recentPages: [], now: NOW });
    expect(rows.some((r) => r.section === 'Recent')).toBe(false);
    expect(rankCommands('', rows)[0].section).toBe('Actions');
  });

  it('highlights the first Recent row on open, or the first row when there are none', () => {
    const rows = rankCommands('', buildCommands({ recentPages: pages, now: NOW }));
    expect(rows[defaultActiveIndex(rows)].id).toBe('recent:/agents/12');
    const none = rankCommands('', buildCommands({ now: NOW }));
    expect(defaultActiveIndex(none)).toBe(0);
    expect(none[0].section).toBe('Actions');
  });

  it('highlights the Recent row even when it is not first in the list', () => {
    const rows: CommandItem[] = [
      { id: 'a', section: 'Actions', label: 'New chat', to: '/ai-chat' },
      { id: 'r', section: 'Recent', label: 'Runs', to: '/runs' },
    ];
    expect(defaultActiveIndex(rows)).toBe(1);
    expect(defaultActiveIndex([])).toBe(0);
  });

  it('with only the current page recorded, Recent is empty', () => {
    const rows = buildCommands({ recentPages: [pages[0]], currentPath: '/agents/12', now: NOW });
    expect(rows.some((r) => r.section === 'Recent')).toBe(false);
  });
});
