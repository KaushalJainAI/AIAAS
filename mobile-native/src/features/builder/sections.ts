/**
 * The builder's screens, in the order the web board groups them, and the one-line
 * summary each shows on the list. Pure: no React, no I/O.
 *
 * Groups and wording follow better-n8n-frontend/src/pages/AgentBuilder.tsx (its
 * tabs: Basics, Behavior, Tools & access, Automation & safety).
 */
import type { IconName } from '../../components/Icon';
import { AUTONOMY_COPY, CONTRACT_COPY, FILE_ACCESS_COPY, STATUS_COPY, type AgentSection } from './config';
import { countToolPermissions } from './edits';
import type { AgentConfig } from './types';

export interface SectionInfo {
  key: AgentSection;
  title: string;
  icon: IconName;
}

export interface SectionGroup {
  title: string;
  items: SectionInfo[];
}

/** The screens, grouped as the list shows them. */
export const SECTION_GROUPS: SectionGroup[] = [
  {
    title: 'Agent',
    items: [
      { key: 'identity', title: 'Name and status', icon: 'pricetag-outline' },
      { key: 'instructions', title: 'Instructions', icon: 'document-text-outline' },
      { key: 'model', title: 'Model and thinking', icon: 'hardware-chip-outline' },
    ],
  },
  {
    title: 'What it can use',
    items: [
      { key: 'grants', title: 'Tools', icon: 'construct-outline' },
      { key: 'toolRules', title: 'Tool rules', icon: 'options-outline' },
      { key: 'connections', title: 'Connections', icon: 'link-outline' },
      { key: 'knowledge', title: 'Knowledge and skills', icon: 'library-outline' },
      { key: 'delegation', title: 'Delegation', icon: 'people-outline' },
      { key: 'files', title: 'File access', icon: 'folder-open-outline' },
    ],
  },
  {
    title: 'How it runs',
    items: [
      { key: 'autonomy', title: 'Autonomy', icon: 'shield-checkmark-outline' },
      { key: 'guardrails', title: 'Limits and spend', icon: 'speedometer-outline' },
      { key: 'output', title: 'Result shape', icon: 'document-outline' },
      { key: 'schedule', title: 'Schedule', icon: 'time-outline' },
      { key: 'context', title: 'Context', icon: 'layers-outline' },
    ],
  },
];

export function sectionInfo(key: string): SectionInfo | null {
  for (const group of SECTION_GROUPS) {
    const found = group.items.find((item) => item.key === key);
    if (found) return found;
  }
  return null;
}

export interface SummaryContext {
  /** The model's display name, or null when it is the account default. */
  modelName: string | null;
  /** How many schedules the agent has (from the Schedules page). */
  scheduleCount: number;
}

/** One line for the list. Says what is set, not what is possible. */
export function summaryFor(key: AgentSection, cfg: AgentConfig, ctx: SummaryContext): string {
  switch (key) {
    case 'identity':
      return `${cfg.name.trim() || 'Not named yet'} · ${STATUS_COPY[cfg.status]?.label ?? cfg.status}`;
    case 'instructions': {
      const brief = cfg.brief.trim();
      return brief ? brief.slice(0, 80) : 'Not written yet';
    }
    case 'model':
      return ctx.modelName ?? 'Account default';
    case 'grants': {
      const total = Object.keys(cfg.tools).length;
      const on = Object.values(cfg.tools).filter(Boolean).length;
      return `${on} of ${total} switched on`;
    }
    case 'toolRules': {
      const scope = cfg.toolScope.length ? `${cfg.toolScope.length} chosen` : 'Every tool the switches unlock';
      const rules = countToolPermissions(cfg.toolPermissions, Object.keys(cfg.toolPermissions ?? {}));
      return rules ? `${scope} · ${rules} custom rule${rules === 1 ? '' : 's'}` : scope;
    }
    case 'connections':
      return cfg.connectors.length ? `${cfg.connectors.length} chosen` : 'Every connection you have';
    case 'knowledge':
      return `${cfg.knowledgeBases.length} knowledge base${cfg.knowledgeBases.length === 1 ? '' : 's'} · ${cfg.skills.length} skill${cfg.skills.length === 1 ? '' : 's'}`;
    case 'delegation':
      if (cfg.delegatesTo.length) return `${cfg.delegatesTo.length} agent${cfg.delegatesTo.length === 1 ? '' : 's'}`;
      return cfg.tools.subAgents ? 'Any of your agents' : 'Off: delegation is switched off';
    case 'files':
      return FILE_ACCESS_COPY[cfg.fileAccess]?.label ?? cfg.fileAccess;
    case 'autonomy':
      return AUTONOMY_COPY[cfg.autonomy]?.label ?? cfg.autonomy;
    case 'guardrails':
      return `₹${cfg.spendCapRupees} cap · ${Math.round(cfg.maxRunSeconds / 60)} min a run`;
    case 'output':
      return CONTRACT_COPY[cfg.outputContract]?.label ?? 'Prose';
    case 'schedule':
      return ctx.scheduleCount
        ? `${ctx.scheduleCount} schedule${ctx.scheduleCount === 1 ? '' : 's'}`
        : 'None: runs when you ask it to';
    case 'context': {
      const parts = [cfg.compaction && 'compaction', cfg.recursiveContext && 'summaries', cfg.indexing && 'saved recall'].filter(Boolean);
      return parts.length ? parts.join(', ') : 'All off';
    }
  }
}
