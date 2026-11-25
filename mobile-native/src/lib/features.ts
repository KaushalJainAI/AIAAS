/**
 * Product switches that hide a whole surface without deleting its code.
 * Each mirrors a backend setting and the web app's `src/lib/features.ts`.
 */

/**
 * "Add a custom server" (More → Connections → Advanced). Retired 2026-11-23:
 * connectors come from the curated catalogue only. Mirrors the backend's
 * `MCP_CUSTOM_SERVERS_ENABLED` (off), which refuses the create and hides
 * user-owned rows. The server form screen is kept.
 */
export const CUSTOM_MCP_SERVERS = false;
