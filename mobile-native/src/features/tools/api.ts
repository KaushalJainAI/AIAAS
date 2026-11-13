/**
 * Tools library over HTTP. Mirrors better-n8n-frontend/src/api/tools.ts.
 *
 * Backend: `tools_config/` on `/api/tools/`. Plugin (MCP) tools are not here:
 * their catalogue lives under `/api/mcp/servers/`.
 */
import { api } from '../../api/client';
import type { ToolChange, ToolsCatalogue, ToolUsage } from './types';

export const toolsApi = {
  /** The catalogue grouped by grant, with this user's overlay and each knob's schema. */
  catalogue: () => api<ToolsCatalogue>('/tools/'),

  /** Agents-per-grant counts for the "granted to N agents" chips. */
  usage: () => api<ToolUsage>('/tools/usage/'),

  /**
   * Change one tool or a whole category in one request. Answers the whole
   * catalogue, so a clamped value or a refused lock shows at once.
   */
  update: (changes: Record<string, ToolChange>) =>
    api<ToolsCatalogue>('/tools/', { method: 'PATCH', body: { tools: changes } }),
};
