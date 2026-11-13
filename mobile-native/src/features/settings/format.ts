import type { Tier, UserMemory } from './types';

export function tierLabel(tier: Tier | undefined): string {
  switch (tier) {
    case 'pro':
      return 'Pro plan';
    case 'enterprise':
      return 'Enterprise plan';
    default:
      return 'Free plan';
  }
}

/** Server categories, in display order (core/models.py::UserMemory.CATEGORIES). */
export const MEMORY_CATEGORY_ORDER = ['profile', 'preference', 'project', 'context'] as const;

export const MEMORY_CATEGORY_LABELS: Record<string, string> = {
  profile: 'Who you are',
  preference: 'How you like to work',
  project: 'What you are working on',
  context: 'Anything else',
};

/**
 * Stored but not shown to the model (core/memory.py::_select). Only an explicit
 * false counts: a server that does not send the field shows every fact.
 */
export function isHidden(memory: UserMemory): boolean {
  return memory.in_prompt === false;
}

export interface MemoryGroup {
  category: string;
  label: string;
  items: UserMemory[];
}

/** Same grouping as the web Memory tab (better-n8n-frontend/src/lib/memory.ts). Unknown categories fall under "context". */
export function groupMemories(memories: UserMemory[]): MemoryGroup[] {
  const byCategory = new Map<string, UserMemory[]>();
  for (const m of memories) {
    const key = (MEMORY_CATEGORY_ORDER as readonly string[]).includes(m.category) ? m.category : 'context';
    const list = byCategory.get(key) ?? [];
    list.push(m);
    byCategory.set(key, list);
  }
  return MEMORY_CATEGORY_ORDER.filter((c) => (byCategory.get(c) ?? []).length > 0).map((category) => ({
    category,
    label: MEMORY_CATEGORY_LABELS[category] ?? category,
    items: (byCategory.get(category) ?? []).slice().sort((a, b) => a.id - b.id),
  }));
}

/** 'HH:MM:SS' from the API to 'HH:MM' for a text field. */
export function toInputTime(value: string | undefined): string {
  return value ? value.slice(0, 5) : '';
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** 'HH:MM' typed by the user to 'HH:MM:SS' for the API, or null when it is not a valid 24-hour time. */
export function toApiTime(value: string): string | null {
  const trimmed = value.trim();
  if (!TIME_PATTERN.test(trimmed)) return null;
  return `${trimmed}:00`;
}
