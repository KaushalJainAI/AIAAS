/**
 * Product switches that hide a whole surface without deleting its code.
 *
 * Each one mirrors a backend setting. The backend is what actually refuses the
 * request; this only stops the app from offering something that would fail.
 */

/**
 * "Add your own MCP server" (Connections → Advanced). Retired 2026-11-23:
 * connectors come from the curated catalogue only. Mirrors the backend's
 * `MCP_CUSTOM_SERVERS_ENABLED` (off), which refuses the create and hides
 * user-owned rows. Flip both to bring it back; the components are kept.
 */
export const CUSTOM_MCP_SERVERS = false;
