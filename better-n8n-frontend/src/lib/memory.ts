/**
 * Grouping for the Settings → Memory tab.
 *
 * The server's categories (`core/models.py::UserMemory.CATEGORIES`) are the
 * Vocabulary: profile, preference, project, context. An unknown value groups
 * under context rather than vanishing — a fact the UI cannot place is still
 * a fact the user should see and be able to delete.
 */
import type { UserMemory } from '../api/memory';

export const MEMORY_CATEGORY_ORDER = [
  'profile',
  'preference',
  'project',
  'context',
] as const;

export const MEMORY_CATEGORY_LABELS: Record<string, string> = {
  profile: 'Who you are',
  preference: 'How you like to work',
  project: 'What you are working on',
  context: 'Anything else',
};

export interface MemoryGroup {
  category: string;
  label: string;
  items: UserMemory[];
}

export function groupMemories(memories: UserMemory[]): MemoryGroup[] {
  const byCategory = new Map<string, UserMemory[]>();
  for (const m of memories ?? []) {
    const key = MEMORY_CATEGORY_ORDER.includes(
      m.category as (typeof MEMORY_CATEGORY_ORDER)[number],
    )
      ? m.category
      : 'context';
    const list = byCategory.get(key) ?? [];
    list.push(m);
    byCategory.set(key, list);
  }
  return MEMORY_CATEGORY_ORDER.filter((c) => (byCategory.get(c) ?? []).length > 0).map(
    (category) => ({
      category,
      label: MEMORY_CATEGORY_LABELS[category] ?? category,
      items: (byCategory.get(category) ?? []).slice().sort((a, b) => a.id - b.id),
    }),
  );
}
