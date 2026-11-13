/**
 * Explore: the wording and the lookups the screens share. Pure data.
 *
 * Copied from better-n8n-frontend/src/pages/Templates.tsx, PublicAgent.tsx and
 * src/types/agentConfig.ts, so the install screen says the same things the web
 * does. Keys are the wire names the backend stores and the runtime enforces.
 */
import type { IconName } from '../../components/Icon';
import type { Autonomy, FileAccess, ToolGrants } from '../builder/types';
import type { AgentTemplate, TemplateRequirement, RequirementType } from './types';

/* What each grant lets the agent do, in the second person: "what are you handing over". */
export const GRANT_COPY: Record<string, string> = {
  webSearch: 'Search the web',
  scrape: 'Open and read web pages',
  codeExecution: 'Run Python in a sandbox',
  shell: 'Run shell commands',
  fileOps: 'Read and write your files',
  office: 'Create PowerPoint, Excel and Word files',
  media: 'Generate images on your OpenRouter account',
  publish: 'Publish pages shareable by link',
  browser: 'Use a web browser on allowed sites',
  rag: 'Search a knowledge base',
  mcp: 'Use your connections',
  voice: 'Transcribe audio and speak text',
  esign: 'Send documents for e-signature',
  talk: 'Message on Slack, WhatsApp, Teams, SMS and Telegram',
  data: 'Query databases',
  api: 'Call HTTP APIs',
  decisions: 'Make typed decisions with a decision model',
  subAgents: 'Delegate to your other agents',
};

export const REQUIREMENT_NOUN: Record<string, string> = {
  connector: 'Connection',
  knowledge_base: 'Knowledge base',
  skill: 'Skill',
  api_tool: 'API tool',
  data_tool: 'Database tool',
};

export const AUTONOMY_COPY: Record<Autonomy, { label: string; hint: string }> = {
  plan: { label: 'Plan only', hint: 'Can look and report, never change anything. Nothing to approve.' },
  review: { label: 'Review every step', hint: 'You approve each step. Slow, for high-stakes work.' },
  ask: { label: 'Ask before changes', hint: 'Pauses before anything leaves your account.' },
  auto: { label: 'Ask before irreversible', hint: 'Runs file changes you can undo; still stops before anything you cannot.' },
  full: { label: 'Never ask', hint: 'No approval gate at all, including tools using your credentials.' },
};

export const FILE_ACCESS_COPY: Record<FileAccess, { label: string; hint: string }> = {
  none: { label: 'None', hint: 'No file tools at all — it is not offered them.' },
  readonly: { label: 'Read only', hint: 'Can read all your files. Cannot change anything.' },
  scoped: { label: 'Own folder', hint: 'Read and write, but only inside its own folder in Agents/. It cannot see the rest of your files.' },
  read_all_write_own: {
    label: 'Read all, write own folder',
    hint: 'Can read all your files, but only writes inside its own folder in Agents/. Usually the one you want.',
  },
  full: { label: 'All your files', hint: 'Read and write anywhere in your files. Rarely justified.' },
};

/** Ionicons for a template's stable `icon` slug. An unknown slug falls back, never blank. */
export const TEMPLATE_ICONS: Record<string, IconName> = {
  search: 'search-outline',
  inbox: 'mail-outline',
  'book-open': 'book-outline',
  'calendar-clock': 'calendar-outline',
  table: 'grid-outline',
  radar: 'radio-outline',
  presentation: 'easel-outline',
  pen: 'create-outline',
  sparkles: 'sparkles-outline',
  image: 'image-outline',
  globe: 'globe-outline',
  swords: 'git-compare-outline',
  target: 'locate-outline',
};

export const FALLBACK_TEMPLATE_ICON: IconName = 'construct-outline';

/** One-click packs, keyed by the backend's `gallery.PACKS` slugs. Display only. */
export interface PackMeta {
  slug: string;
  title: string;
  blurb: string;
  icon: IconName;
}

export const PACKS: PackMeta[] = [
  { slug: 'office', title: 'Office pack — Analyst, Slides, Writer', icon: 'easel-outline',
    blurb: 'Three specialists that turn files into files: clean a spreadsheet, build a deck, write a report. One click, no setup.' },
  { slug: 'research', title: 'Research pack — Deep research, Competitors, Publisher', icon: 'search-outline',
    blurb: 'Sourced research three ways: a report, a comparison workbook, or a page you can share by link.' },
  { slug: 'data', title: 'Data pack — Extractor, SQL analyst, Dashboards', icon: 'grid-outline',
    blurb: 'Numbers into files: pull rows out of files, query databases, save dashboards. One click, no setup.' },
  { slug: 'web', title: 'Web pack — Browser scout, API runner', icon: 'globe-outline',
    blurb: 'The live web: pages a scraper cannot render, and your own APIs. The browser scout needs a browser engine on the server.' },
  { slug: 'team', title: 'Team pack — Standup digest, Support drafts', icon: 'person-outline',
    blurb: 'The team loop: a scheduled morning digest plus drafts that never send themselves. One click, no setup.' },
  { slug: 'paperwork', title: 'Paperwork pack — Signatures, Minutes', icon: 'create-outline',
    blurb: 'Paperwork: signatures tracked home, recordings turned into minutes. Needs an e-signature provider and a speech engine on the server.' },
  { slug: 'code', title: 'Code pack — Repo assistant, Reviewer, Team + Lead', icon: 'radio-outline',
    blurb: 'The coding team: a single assistant, a reviewer that never edits, six specialists, and the lead that orchestrates them. Needs a workspace engine on the server.' },
  { slug: 'money', title: 'Money pack — Reconciler, Invoice chaser', icon: 'cash-outline',
    blurb: 'Money: reconcile the month, then chase what is still unpaid. One click, no setup.' },
  { slug: 'marketing', title: 'Marketing pack — SEO brief, Ad copy, Outreach', icon: 'locate-outline',
    blurb: 'A brief writers can rank with, testable ad variants, and outreach drafts that never send themselves. One click, no setup.' },
  { slug: 'hiring', title: 'Hiring pack — JD writer, Screener, Interview kit', icon: 'book-outline',
    blurb: 'Hiring: a posting about the work, a quoted resume scorecard, and the interview kit. One click, no setup.' },
  { slug: 'support', title: 'Support pack — FAQ, Ticket triage, Changelog', icon: 'mail-outline',
    blurb: 'Support: answers quoting your material, triaged tickets with drafts, and the changelog from the diff. One click, no setup.' },
  { slug: 'data-science', title: 'Data science pack — Scientist, Engineer, ML', icon: 'grid-outline',
    blurb: 'Explore and model, move and validate, train and ship. Three file-returning specialists. One click, no setup.' },
];

export type SourceFilter = 'all' | 'curated' | 'community' | 'mine';

export const SOURCE_FILTERS: { key: SourceFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'curated', label: 'Built in' },
  { key: 'community', label: 'Community' },
  { key: 'mine', label: 'Mine' },
];

/** The capability lines, in grant order. Only what is on. */
export function grantedLines(template: Pick<AgentTemplate, 'config'>): string[] {
  const tools = (template.config.tools ?? {}) as Partial<ToolGrants>;
  return Object.entries(tools)
    .filter(([, on]) => on === true)
    .map(([key]) => GRANT_COPY[key] ?? key);
}

/** Custom-tool requirement: reuse your own, or take the author's frozen copy. */
export function isToolRequirement(type: RequirementType): boolean {
  return type === 'api_tool' || type === 'data_tool';
}

export function requirementNoun(type: string): string {
  return REQUIREMENT_NOUN[type] ?? type;
}

/** Autonomy and file access, with the web's fallbacks when a template leaves them out. */
export function limitsOf(template: Pick<AgentTemplate, 'config'>): {
  autonomy: Autonomy;
  fileAccess: FileAccess;
  spendCap: number;
  schedule: string;
} {
  return {
    autonomy: ((template.config.autonomy ?? 'ask') as Autonomy),
    fileAccess: ((template.config.fileAccess ?? 'scoped') as FileAccess),
    spendCap: template.config.spendCapRupees ?? 500,
    schedule: template.config.schedule ?? '',
  };
}

/** Whether a template's grants can run on this server. Absent on older servers: available. */
export function isUnavailable(template: Pick<AgentTemplate, 'available'>): boolean {
  return template.available === false;
}

/**
 * A pack is down only when every member is (the web's `packAvailability`). A
 * partly blocked pack still installs what can run.
 */
export function packIsDown(members: AgentTemplate[]): { down: boolean; reason: string } {
  const blocked = members.filter(isUnavailable);
  if (members.length === 0 || blocked.length < members.length) return { down: false, reason: '' };
  const reason = blocked[0]?.unavailable_reason ?? 'This pack cannot run on this server.';
  return { down: true, reason };
}

/** Requirement labels, editable on publish. */
export function requirementLabel(req: Pick<TemplateRequirement, 'label' | 'type'>): string {
  return req.label || requirementNoun(req.type);
}
