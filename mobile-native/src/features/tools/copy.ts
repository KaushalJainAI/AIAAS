/**
 * Tools wording, filters and search. Copied from better-n8n-frontend/src/pages/Tools.tsx,
 * so the library reads the same on the phone as on the web.
 */
import type { IconName } from '../../components/Icon';
import type { ToolEffect, ToolEntry } from './types';

export const ICON_FOR_CATEGORY: Record<string, IconName> = {
  search: 'search-outline',
  globe: 'globe-outline',
  book: 'book-outline',
  code: 'code-slash-outline',
  files: 'folder-outline',
  users: 'people-outline',
  clock: 'time-outline',
  message: 'chatbubbles-outline',
  eye: 'eye-outline',
  layout: 'grid-outline',
  shield: 'shield-outline',
  plug: 'extension-puzzle-outline',
  terminal: 'terminal-outline',
};

export const FALLBACK_CATEGORY_ICON: IconName = 'construct-outline';

/** What running the tool does to the world. Shown as a chip and in the detail. */
export const EFFECT_VIEW: Record<ToolEffect, { label: string; blurb: string; tone: 'success' | 'warning' | 'danger' }> = {
  read: { label: 'Read-only', blurb: 'Looks at things. Nothing outside changes.', tone: 'success' },
  reversible: { label: 'Undoable', blurb: 'Changes something you can put back.', tone: 'warning' },
  irreversible: { label: 'Permanent', blurb: 'Cannot be taken back once it runs.', tone: 'danger' },
};

export function effectView(effect: string) {
  return EFFECT_VIEW[effect as ToolEffect] ?? EFFECT_VIEW.irreversible;
}

export const REQUIREMENT_BLURB: Record<string, string> = {
  memory: 'Needs conversation memory switched on.',
  vision: 'Needs an image the vision witness can look at.',
  spill: 'Appears once a result was too large to keep in full.',
  files: 'Needs an agent with file access; chat never gets it.',
};

export type FilterKey = 'all' | 'read' | 'changes' | 'off';

export const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'read', label: 'Read-only' },
  { key: 'changes', label: 'Makes changes' },
  { key: 'off', label: 'Off' },
];

/**
 * Model-written descriptions are instructions ("Run this if the user asks…"). A list
 * row gets one short sentence; the full text lives in the detail.
 */
export function shortBlurb(description: string): string {
  if (!description) return '';
  const cut = description.split(/(?:\. Use this|\. Run this| — use| -- use|\. More powerful|\. Try )/)[0];
  const first = cut.split(/\. (?=[A-Z])/)[0] ?? cut;
  const s = (first || cut).trim();
  if (!s) return '';
  return s.endsWith('.') ? s : `${s}.`;
}

export function matchesFilter(tool: ToolEntry, filter: FilterKey): boolean {
  if (filter === 'read') return tool.effect === 'read';
  if (filter === 'changes') return tool.effect !== 'read';
  if (filter === 'off') return !tool.enabled;
  return true;
}

/** Every word has to appear somewhere, in any order. Names are matched with `_` read as a space. */
export function matchesQuery(tool: ToolEntry, q: string): boolean {
  if (!q) return true;
  const haystack = [tool.name, tool.name.replace(/_/g, ' '), tool.displayName, tool.description]
    .join(' ')
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/** The values a "Defaults" action sets, for every knob a tool declares. */
export function defaultsOf(tool: ToolEntry): Record<string, number> {
  return Object.fromEntries(tool.settings.map((s) => [s.key, s.default]));
}
