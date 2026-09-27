import type { ToolPermissionMode } from '../types/agentConfig';

/** Button copy for the three per-tool modes, strictest last. */
export const TOOL_PERMISSION_COPY: Record<ToolPermissionMode, { label: string; hint: string }> = {
  allow: { label: 'Allow', hint: 'Run without asking, even where autonomy would pause.' },
  ask: { label: 'Ask', hint: 'Pause for approval, even where autonomy would not.' },
  deny: { label: 'Deny', hint: 'Never offered and refused if named.' },
};

/**
 * Toggle one tool's rule: picking the active mode clears it back to inherit
 * (unset), so there are three buttons and four states with no separate reset.
 */
export function toggleToolPermission(
  current: Record<string, ToolPermissionMode> | undefined,
  tool: string,
  mode: ToolPermissionMode,
): Record<string, ToolPermissionMode> {
  const next = { ...(current ?? {}) };
  if (next[tool] === mode) delete next[tool];
  else next[tool] = mode;
  return next;
}

/**
 * Drop rules for tools the grants no longer unlock. Applied at save, not on
 * toggle, so switching a group off and back on within one edit keeps the
 * rules — the backend would ignore stale entries anyway (grant off wins),
 * but a stored config full of dead rules is a screen that overpromises.
 */
export function pruneToolPermissions(
  current: Record<string, ToolPermissionMode> | undefined,
  grantedToolIds: string[],
): Record<string, ToolPermissionMode> {
  const granted = new Set(grantedToolIds);
  const next: Record<string, ToolPermissionMode> = {};
  for (const [tool, mode] of Object.entries(current ?? {})) {
    if (granted.has(tool)) next[tool] = mode;
  }
  return next;
}

/** How many rules actually narrow a granted tool — the knob's hint. */
export function countToolPermissions(
  current: Record<string, ToolPermissionMode> | undefined,
  grantedToolIds: string[],
): number {
  const granted = new Set(grantedToolIds);
  return Object.keys(current ?? {}).filter((t) => granted.has(t)).length;
}
