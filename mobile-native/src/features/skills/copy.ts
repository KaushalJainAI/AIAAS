/** Skills wording and choices, copied from better-n8n-frontend/src/pages/Skills.tsx. */
import type { SkillTab } from './types';

export const CATEGORIES: { value: string; label: string }[] = [
  'General',
  'Data Science',
  'Automation',
  'Development',
  'Marketing',
  'Security',
  'Finance',
  'Communication',
].map((c) => ({ value: c, label: c === 'Data Science' ? 'Data science' : c }));

export const TABS: { key: SkillTab; label: string }[] = [
  { key: 'mine', label: 'Mine' },
  { key: 'public', label: 'Library' },
];

/** "Used by N agents" / "Not used yet"; nothing when an older server sent no count. */
export function usageLabel(used: number | null | undefined): string {
  if (used == null) return '';
  if (used === 0) return 'Not used yet';
  return `Used by ${used} agent${used === 1 ? '' : 's'}`;
}

export const SKILL_PAGE_SIZE = 100;

export const SKILL_EDITOR_PLACEHOLDER = '# What the agent should do\n\n- Step one\n- Step two';
