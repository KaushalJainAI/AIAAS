import { describe, expect, it } from 'vitest';
import { groupMemories } from '../memory';
import type { UserMemory } from '../../api/memory';

const fact = (id: number, category: string, text = 'fact'): UserMemory => ({
  id,
  text: `${text} ${id}`,
  category,
  source: 'chat',
  updated_at: '2026-09-24T10:00:00Z',
});

describe('groupMemories', () => {
  it('groups by category in server order, not first-seen order', () => {
    const groups = groupMemories([
      fact(1, 'project'),
      fact(2, 'profile'),
      fact(3, 'preference'),
    ]);
    expect(groups.map((g) => g.category)).toEqual([
      'profile',
      'preference',
      'project',
    ]);
  });

  it('omits empty categories and labels the rest', () => {
    const groups = groupMemories([fact(1, 'profile')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Who you are');
    expect(groups[0].items.map((m) => m.id)).toEqual([1]);
  });

  it('files an unknown category under context rather than dropping it', () => {
    const groups = groupMemories([fact(1, 'mystery')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].category).toBe('context');
    expect(groups[0].items).toHaveLength(1);
  });

  it('an empty list groups to nothing', () => {
    expect(groupMemories([])).toEqual([]);
  });
});
