/**
 * Skills: reusable instruction fragments an agent can be given.
 *
 * Copied from better-n8n-frontend/src/api/skills.ts. Field names are the wire
 * names, including the camelCase `isShared` and `updatedAt`, which the server
 * sends as they are.
 */

export interface Skill {
  id: number;
  title: string;
  description: string;
  content: string;
  author: string;
  isShared: boolean;
  category: string;
  updatedAt: string;
  /** How many agents attach this skill. Optional: an older server omits it. */
  used_by?: number | null;
}

export type SkillTab = 'mine' | 'public';

/** The fields a person edits; the server fills in the rest. */
export interface SkillInput {
  title: string;
  description: string;
  content: string;
  category: string;
}

export interface SkillSearchPage {
  results: Skill[];
  total: number;
}
