/**
 * Tools Library Service — the catalogue plus this user's overlay on it.
 *
 * Tools are code (chat/tools/registry.py) grouped by the grant that
 * gates them (agents/agent/runtime.py:GRANT_TOOLS). Plugins (MCP) bring
 * dynamic mcp__* tools; their catalogue lives under /api/mcp/servers,
 * not here. Skills are prompt injection, not callable.
 *
 * What is configurable is a workspace-wide switch per tool and, for the few
 * that declare one, a numeric budget. The *schema* for those budgets comes
 * down with the catalogue (`settings`), so this page renders controls for
 * tools it has never heard of and needs no per-tool knowledge of its own.
 */
import apiClient from './client';

export type ToolEffect = 'read' | 'reversible' | 'irreversible';
export type ToolRequirement = 'memory' | 'vision' | 'spill' | 'files' | null;

/** One integer knob, with everything a control needs to render and validate. */
export interface ToolSetting {
  key: string;
  label: string;
  help: string;
  default: number;
  minimum: number;
  maximum: number;
  unit: string;
}

export interface ToolEntry {
  name: string;
  displayName: string;
  description: string;
  effect: ToolEffect;
  parallel: boolean;
  sensitive: boolean;
  requires: ToolRequirement;
  alwaysAvailable: boolean;
  unserved: boolean;
  /** Effective state — an absent row on the server means on. */
  enabled: boolean;
  /** The switch is not the user's to flip (the model is told to call it by name). */
  locked: boolean;
  /** This user has a stored row: either switched off or holding a custom value. */
  customized: boolean;
  settings: ToolSetting[];
  config: Record<string, number>;
  parameters: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
    [k: string]: unknown;
  };
}

export interface ToolCategory {
  key: string;
  label: string;
  description: string;
  icon: string;
  unserved: boolean;
  /** Mirrors a toggle in the agent builder, as opposed to being always-on. */
  grantBacked: boolean;
  tools: ToolEntry[];
  enabledCount: number;
  note?: string;
}

export interface ToolsCatalogue {
  categories: ToolCategory[];
  totalTools: number;
  enabledTools: number;
  grants: string[];
  grantCategories: string[];
}

export interface ToolUsage {
  usage: Record<string, number>;
  totalAgents: number;
}

/** What a PATCH may say about one tool. Both fields optional; either alone is valid. */
export interface ToolChange {
  enabled?: boolean;
  config?: Record<string, number>;
}

export const toolsService = {
  async catalogue(): Promise<ToolsCatalogue> {
    const res = await apiClient.get<ToolsCatalogue>('/tools/');
    return res.data;
  },
  async usage(): Promise<ToolUsage> {
    const res = await apiClient.get<ToolUsage>('/tools/usage/');
    return res.data;
  },
  /**
   * Change one tool or a whole category in one request, and get the whole
   * catalogue back — so a clamped value or a refused lock shows immediately
   * rather than after a reload.
   */
  async update(changes: Record<string, ToolChange>): Promise<ToolsCatalogue> {
    const res = await apiClient.patch<ToolsCatalogue>('/tools/', { tools: changes });
    return res.data;
  },
};

export default toolsService;
