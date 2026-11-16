# Custom Tools

**Status:** built (last change 2026-11-11). Phases A–C are in the tree; Phase D's manual two-user run is not recorded anywhere.

A custom tool is a connection the user creates: a REST API (`ApiConnection`) or a database (`DataConnection`). It runs through the generic `call_api` / `query_sql` callers, so no user code runs. Users can share a tool the way they share an agent. Credentials never travel.

## What it delivered

- **Backend CRUD**: `datasources/views.py` (two owned viewsets, `_OwnedViewSet`), mounted at `/api/datasources/data-connections/` and `/api/datasources/api-connections/` (`datasources/urls.py`).
- **Validation at write**: `datasources/serializers.py`. Hosts go through the SSRF half of `check_egress`, methods are restricted to `HTTP_METHODS`, OpenAPI text is capped at 500 KB, SQL is checked by `datasources/sqlcheck.py`.
- **Sharing**: `SharedTool` model and `datasources/sharing.py` (`snapshot_api`, `snapshot_data`, `install_copy`). Endpoints for publish preview, publish/withdraw, the shared list, read by slug, and install.
- **Agent sharing carries tools**: `agents/publishing.py` makes `api_tool` and `data_tool` requirements. `agents/views/gallery.py` (`'install'` value) creates the installer's private copies.
- **Frontend**: `components/tools/CustomTools.tsx` has the "My tools" section, the create/edit dialog, `ShareToolDialog`, and "Shared by others" with Install. Client calls are in `src/api/datasources.ts`.
- **Tests**: `datasources/tests/test_api.py`, `test_data.py`, `test_sharing.py`.

## Decisions worth remembering

- **Private by query, not by filter.** Every read and write is scoped to the caller. A foreign id is 404, never 403, so the API cannot be used to probe ids.
- **Secrets are references.** A row stores a `secret_ref` (`slug.field`) only. Resolution happens at dispatch, after approval (see CLAUDE.md, "Secret references" under Foundations).
- **A listing is a snapshot.** `SharedTool` freezes `tool_config` and `auth_shape` at publish. Withdrawing unlists; installs already made keep working. Same rule as `SharedAgent`.
- **The auth shape travels, the secret does not.** An installed copy starts unauthenticated. `install_copy` returns the credential needs, and the installer answers them from their own vault.
- **Creation has one entry point.** The Tools header no longer has "New agent" or a second "New tool" button. Creation lives in "My tools" (`pages/Tools.tsx` comment).
- **No new execution path.** Creation and install write rows the existing callers already read. Grants still decide what an agent can reach (CLAUDE.md, "A grant says whether, a scope says which").

## Open

- Phase C tests: no Vitest coverage for the dialog validation or section rendering exists (no `*.test.*` file references `CustomTools`).
- Phase D: the manual check (create, share, install as a second user, confirm no secret travelled) is not recorded as done. Automated tests cover the same rules, but not the UI path end to end.
- Agent-builder pickers for `apiConnections` / `dataConnections` scoping (the plan's out-of-v1 list).
- Python / code custom tools. Needs its own plan.
- Server-side OpenAPI URL import. v1 takes pasted spec text only.
