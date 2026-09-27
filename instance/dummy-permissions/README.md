# dummy-permissions

Permission matrices — what to assert, not how. Both harnesses read these as expectations.

- `tool-configs/*.json` — `ToolConfig` overlays (`enabled`, `config`). Absent row = default; row that drifts to defaults should be deleted.
- `autonomy/*.json` — `guardrails.autonomy` per persona+agent and expected gating behavior.
- `mcp/*.json` — `MCPServerPreference.effective_enabled` expectations (curated rows are read-only).
- `roles/matrix.json` — end-to-end role matrix.

Enforcement point is single: `chat/tools/disabled_tools_for` → `get_available_tools` / `AgentToolbox` / `execute_tool`.
