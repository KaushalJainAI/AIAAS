# Tool Configuration

**Status:** partly built. The backend (`tools_config`) and the Tools page are in. The Overview/Inbox merge landed as Activity (`/runs`), not Overview, and its verification is unconfirmed.

Tools stay code. Users choose which tools exist for their workspace and how much each may return. Grants still decide what each agent may reach. Custom tools are a separate plan (`CUSTOM_TOOLS_PLAN.md`).

## What it delivered

- **`ToolConfig` overlay**: `Backend/tools_config/models.py`, one row per (user, tool). An absent row means the code default. Overlay reads and cache: `tools_config/overlay.py`.
- **Knob table**: `tools_config/settings_schema.py` (`TOOL_SETTINGS`), for example `charLimit` on page reads and research budget.
- **API**: `/api/tools/` catalogue and `/api/tools/usage/` (agents that use each tool), in `tools_config/views.py`.
- **Tools page**: `better-n8n-frontend/src/pages/Tools.tsx`. Grouped by grant, search, per-tool enable switch, knobs. The shared catalogue client is `src/api/tools.ts`.
- **Runtime enforcement**: one read, `chat/tools/disabled_tools_for`. Used by chat's `get_available_tools`, by `AgentToolbox.descriptors`, and by `execute_tool` for both.
- **Locked tools**: `LOCKED_TOOLS` cannot be switched off, because prompts name them.
- **Tests**: `tools_config/tests/test_config.py`.
- **Connections page**: kept at `/connections`. It is titled "Plugins & their Connectors" with a Plugins section (`pages/Connections.tsx`). The old `/connectors` and `/mcp-servers` routes redirect there.

## Decisions worth remembering

- **Absent row is the default.** A fresh `migrate` makes zero rows. "Reset to default" is a delete, and a row that drifts back to defaults is deleted on save.
- **Enforcement is not in `tools_config`.** The one read is in `chat/tools/`, so every door reads the same switch.
- **A failed read means nothing is off.** A cache miss must not strip a running agent's toolbox.
- **The overlay is a second axis.** The page says so: a grant decides what one agent may reach, the library decides what exists to be granted.
- **Overview became Activity.** The plan's Phase 2 said merge Inbox into Overview. In the tree `/overview`, `/inbox` and `/orchestrator` all redirect to `/runs`, and `Overview.tsx` and `Inbox.tsx` do not exist. See `ACTIVITY_PAGE_PLAN.md`.
- **Plugins vs Connectors.** The route stays `/connections` (URL stable), and the page headings carry the vocabulary. Rejected: merging Tools into Connections, because the two answer different questions.
- **No per-tool, per-agent matrix.** Grants stay the per-agent knob. The overlay is global.

## Open

- Phase 2 check: the plan's verification list (fresh `migrate` yields zero rows, `/inbox` gives a 302 to the merged page) is unconfirmed. The redirects exist in `App.tsx`.
- Phase 3 (optional, not started): bulk enable and disable, and more per-tool knobs when a real limit is hit (for example a `deep_research` fan-out knob). Search exists.
- AgentBuilder warning: a warning when a grant's tools are switched off in the library was not found in `pages/AgentBuilder.tsx`. The links to `/tools` and the catalogue read are there. Verify before calling it done.
- Manual check from §6: disable a tool, confirm an agent loses it on the next turn, re-enable, confirm it returns. Not recorded.
