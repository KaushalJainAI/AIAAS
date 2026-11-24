# Connector catalogue plan

**Status:** proposed 2026-11-23. Nothing built yet.
**Branch:** `feature/connector-catalogue`, cut from `develop`. All work for this
plan lands there. Merge to `develop` only when a phase is green; never straight
to `main`.

## 1. What this plan does

Two things, in this order:

1. **Retire custom MCP servers.** Users can no longer add their own MCP server
   (the "Advanced → Add custom server" form on web, the server form on mobile).
   The code stays in the tree behind one switch, so it can come back.
2. **Grow the curated catalogue with hosted vendor MCP servers.** Each new
   connector is a row we researched, configured and tested ourselves, so a user
   clicks *Connect*, signs in with the vendor, and the agent has the tools.

Then, for every connector, **prove the agent loop handles it**: tool names,
schemas, tool count, approvals, injection defences, token refresh and errors.

Widened 2026-11-23 to **every sensible connector**, through four engines that
look the same to the user (one card, one Connect button, one "Get started"
panel): vendor-hosted **MCP**, **API cards** on our existing `call_api`,
**SQL** drivers on our existing `query_sql`, and **native** tools. The full
list, what we need, what the user needs, and each card's setup steps are in
[CONNECTOR_CATALOGUE.md](CONNECTOR_CATALOGUE.md). Phases 9–14 below build the
parts the first eight phases do not cover.

What this plan does **not** do: plugins, a new hook system, or any change to the
agent loop's shape. The loop stays as it is. We only make sure connector tools
fit it.

## 2. Why hosted MCP servers

- **Production runs no Node and no stdio MCP** (`MCP_ALLOW_STDIO=False`). A
  hosted server is an HTTPS endpoint the vendor runs, so it costs us no process
  and no memory. That is why every curated stdio row ended up disabled or
  rewritten as native tools (H-110, H-117, migration `0021`).
- **The hard client work is already built**: streamable HTTP and SSE transports
  (`mcp_integration/client.py`), OAuth discovery + dynamic client registration +
  PKCE (`mcp_integration/oauth.py`), session pooling, tool cache, tool pinning
  against rug pulls (`pinning.py`), untrusted-output wrapping and the injection
  check (H-159), and the approval gate for credentialed tools.
- **The vendor maintains the tools.** A native connector (Gmail, Notion) is code
  we keep in step with a REST API forever. A hosted server is a row.

Native REST tools stay the right answer when a vendor has no hosted server or
locks it down (see Slack, §6.8).

## 3. What the code does today, and the gaps

Read 2026-11-23 on `develop`.

| Area | Today | Gap for curated hosted connectors |
|---|---|---|
| OAuth sign-in UI | `OAuthConnectButton` renders only inside `CustomServerRow` (`pages/Connections.tsx`) | Retiring custom servers removes the **only** OAuth sign-in button. Curated cards (`ConnectionCard`) only know credential-vault connects |
| Client registration | `oauth.get_or_register_client` needs a `registration_endpoint` (DCR); without one it refuses | GitHub, Asana, HubSpot and Slack have **no DCR**. They need a pre-registered client id + secret |
| Scopes | `ServerMetadata.default_scope` asks for **every** scope the server advertises | Least privilege. Atlassian advertises 44 scopes; Sentry advertises write scopes |
| Refresh | `access_token_for` refreshes with no lock, and omits `resource` | Two concurrent runs refresh the same **single-use** refresh token (Slack, Linear rotate) → the loser's token is revoked → the user is silently disconnected. RFC 8707 `resource` is sent on authorize and code exchange but not on refresh |
| Tool schemas | `_build_openai_descriptor` passes `inputSchema` through verbatim (only forces top-level `type: object`) | `$ref`/`$defs`, `oneOf` at the root, `type: [..]` unions and unknown keywords are rejected by some providers behind OpenRouter. One bad schema can fail the **whole request** |
| Tool count | Chat offers every tool of every enabled connection | GitHub's default toolsets, Sentry's ~80-tool catalogue and Atlassian's ~270 tools would flood every chat turn, cost context and miss the prompt cache |
| Read/write | `permissions.looks_read_only` judges by name prefix (`get_`, `list_`, `search_`...) | Correct and conservative. But no per-connector way to *tighten* (e.g. HubSpot `manage_*`, Stripe `stripe_api_write`), or to hide a tool entirely |
| Narrowing | Only `credential_header_map` (secret headers) | GitHub narrows by static headers (`X-MCP-Toolsets`, `X-MCP-Readonly`) or URL path; Linear and Sentry by URL. No place for non-secret static headers |
| Connection status | `validate_credentials` checks DB + decryption | A vendor 401 (`invalid_token`) or a refused refresh does not turn the card to "Sign in again" |
| Pins | Per user: a changed tool description is held until each user approves it | A vendor deploy that rewords descriptions holds those tools for **every** user at once |
| Parallel reads | `mcp_reads_only` lets read calls run in parallel | Sentry's docs say parallel calls hit per-second rate limits; run them one at a time |

## 4. Rules this plan must keep

From CLAUDE.md "Core rules" and the design history. Every phase is checked
against these:

- **Connector metadata is data, not code** (H-109). A new connector is a
  migration that adds a row. The frontend keys presentation off `icon_slug`
  only, never off `name`.
- **A catalogue row is a claim that something starts, and the claim is checked**
  (H-110). A row ships `enabled=False, coming_soon=True` until a real
  connection has listed its tools. A vendor's docs are not proof.
- **Reach is checked at both doors.** Anything that narrows tools narrows both
  `get_openai_tool_descriptors` (offered) and `MCPToolProvider.execute`
  (dispatched).
- **Chat holds only read tools.** `execute_chat_tool` refuses MCP tools whose
  names do not read as reads. Write tools reach a user only through an agent's
  `mcp` grant and its approval gate.
- **Names only narrow.** A third party's tool name or annotation may make us
  *more* careful, never less. Our own per-connector settings follow the same
  rule (§5.4).
- **Third-party text is untrusted.** Tool output stays inside
  `<untrusted_data>`; descriptions stay behind pinning.
- **Unknown and foreign ids get the same 404.**
- **Fail before you look busy.** A missing or expired sign-in surfaces as
  "Sign in again", never as an agent apologising mid-turn.
- **`Backend/docs/API.md` changes with every route, permission or serializer
  change.** The mobile app copies the web's request bodies, so a route change is
  a mobile change too.
- **Paid runs need the user's go-ahead.** Live checks against vendor accounts
  are free but use the user's accounts, so they are listed per phase and run
  only when the user says so.

## 5. Phases

Each phase is one or more commits on the feature branch, with its own tests,
and leaves the branch green: `pytest` for the touched apps, frontend
`npm run lint` + `tsc -b --force` + vitest, mobile `npx tsc --noEmit` +
`npm run lint`, and `lint-imports` from `Backend/`.

### Phase 0 — Retire custom MCP servers

**Switch:** `MCP_CUSTOM_SERVERS_ENABLED` in `settings/base.py`, default
`False` in every environment, read at call time (like `MCP_ALLOW_STDIO`).
A switch rather than commented-out code: commented code is not type-checked or
linted, so it rots, and turning it back on would mean un-commenting by hand
across three apps. Flipping one env var brings everything back.

Backend (`mcp_integration/`):
- `MCPServerViewSet.create` → **403** `{code: "custom_servers_disabled"}` when
  off. `update` of a user-owned row's config → same 403. The `{enabled}`-only
  path and `set-enabled` keep working.
- `destroy` of a user-owned row **keeps working**, so users can clean up.
- `_visible_servers_queryset` excludes user-owned rows when off. That one
  function feeds both doors (descriptors and dispatch), the builder's picker,
  `visible_server_ids_sync` and the benchmarks installer, so custom servers stop
  reaching agents everywhere at once. Rows are **kept**, not deleted.
- `AgentSerializer` (`agents/config.py`): an agent whose `connectors` names a
  now-hidden custom server must still save. Drop unknown ids on read (the
  runtime already does) and accept them on save, rather than 400ing an
  unrelated edit. Check `agents/tests/test_connector_scope.py` first.
- `MCPServerViewSet.get_queryset` (the list) hides user-owned rows when off, so
  the page and mobile see only the catalogue.

Web (`better-n8n-frontend/`):
- `pages/Connections.tsx`: the Advanced section, `CustomServerRow` and the
  `MCPServerModal` mount render only when `CUSTOM_MCP_SERVERS` (one exported
  constant in `lib/features.ts`, `false`) is true. Files stay in the tree.
- The empty-state copy "or add your own below" goes.
- `OAuthConnectButton` moves out of the custom section (Phase 1 reuses it).

Mobile (`mobile-native/`):
- `app/(tabs)/more/connections/server-form.tsx` and the entry points that link
  to it are hidden behind the same kind of constant. Delete on a custom row
  stays.

Docs: `API.md` rows for `/api/mcp/servers/` and `/{pk}/`; `MCP_ARCHITECTURE.md`;
`mcp_integration/README.md`; `SAFETY_AND_GUARDRAILS.md` (one less third-party
surface); a `DESIGN_HISTORY.md` entry.

Tests (`mcp_integration/tests/test_custom_servers_retired.py`):
- POST refused with the code; PATCH config on an owned row refused; DELETE of an
  owned row works.
- An existing custom row is in neither the descriptors nor dispatch for its
  owner; a model calling its old tool name gets `tool_not_found`.
- Flag on → all of the above revert (one test per door).
- Saving an agent that references a hidden custom row succeeds.

Before deploy (read-only, with the user's go-ahead): count user-owned
`MCPServer` rows in production, to know how many users lose a connector.

### Phase 1 — Sign in to a curated hosted connector

- `ConnectionCard` gets an OAuth path: a row with `type in ('http','sse')` and
  `supports_oauth` shows **Connect** that runs `oauthInit` → `startOAuth`, and
  **Disconnect** that calls `oauthDisconnect`. Reuse `OAuthConnectButton`'s
  logic. `lib/connectionStatus.ts` treats `oauth_connected` as connected for
  those rows.
- The chat's "Get set up" card reads the same status (it already shares
  `connectionStatus`), so no second rule.
- Mobile: `ConnectionDetailScreen` gets the same Connect/Disconnect; it already
  has `mcpOAuthDisconnect`, and `/oauth/callback` handles the return.
- `validate_credentials` for an OAuth row reports `ok: false` with "Sign in
  again" when there is no token, or the token is expired with no usable
  refresh.
- **A vendor 401 marks the token dead.** When `call_tool`/`list_tools` gets 401
  `invalid_token`, set a `needs_reauth` flag on `MCPOAuthToken`; validation and
  the card read it; a successful sign-in clears it. The tool result says
  "the user must reconnect X on Connections" with `code: reauth_required`, so
  the model stops retrying.

Tests: card status matrix (vitest, `lib/__tests__/connectionStatus.test.ts`);
backend 401 → flag → validation false → re-sign-in clears.

### Phase 2 — OAuth hardening

1. **Pre-registered clients.** For vendors without DCR, the platform holds one
   client per connector, from env:
   `MCP_OAUTH_<ICON_SLUG>_CLIENT_ID` / `_CLIENT_SECRET` (e.g.
   `MCP_OAUTH_GITHUB_CLIENT_ID`). `get_or_register_client` checks for a
   configured client **before** trying DCR, and stores it in `MCPOAuthClient`
   like a registered one (secret Fernet-encrypted). No env client and no DCR →
   the existing `oauth_unavailable` error, and the row stays `coming_soon`.
   Redirect URI is our `/oauth/callback` origin from `lib/origins.ts` /
   `credentials/oauth.py::ALLOWED_REDIRECT_ORIGINS`; it must be registered with
   each vendor exactly.
2. **Token-endpoint auth method.** Read `token_endpoint_auth_methods_supported`
   and use `client_secret_post` or `client_secret_basic` accordingly (HubSpot is
   post-only; GitHub, Asana, Linear, Sentry accept both). Public clients
   (`none`, Stripe) send no secret. Today we always post.
3. **Curated scopes.** New `MCPServer.oauth_scopes` (text, blank = today's
   behaviour for back-compat). Each curated row sets the narrowest scopes its
   default tools need (§6). Never fall back to "everything advertised" for a
   curated row.
4. **Refresh under a lock.** In `access_token_for`: open a transaction,
   `select_for_update` the token row (Postgres), re-check `_needs_refresh` after
   the lock, then refresh. SQLite (dev) has no row locks; add a short Redis lock
   keyed by token id as well, the way `tool_cache` already uses Redis. Store the
   new refresh token **before** returning. On a refused refresh, re-read the row
   once: if another worker already rotated it, use theirs.
5. **`resource` on refresh** (RFC 8707), same value as authorize.
6. **Hard expiry.** Stripe's refresh tokens die 14 days after consent however
   often they are used. Store `refresh_expires_at` when a vendor documents one
   (from the curated row: `oauth_refresh_ttl_days`), and show "Sign in again
   soon" three days before.
7. **Per-site connections.** Atlassian tokens are per site (`cloudId`). Out of
   scope until Phase 7; noted so the token model is not designed in a way that
   blocks it.

Tests: extend `test_oauth.py` — configured client beats DCR; no DCR + no env
client → `oauth_unavailable`; scope string comes from the row; two concurrent
refreshes call the token endpoint once and both get the new access token; the
refresh body carries `resource`; post vs basic chosen from metadata.

### Phase 3 — Shape each connector's tools

All per-row data, set in the connector's migration:

1. **`static_headers`** (JSON, non-secret, validated: header names on an
   allow-list per row, values ≤ 200 chars, never `Authorization`). Lets GitHub
   send `X-MCP-Toolsets` / `X-MCP-Readonly`. Applied in `client.py` where
   `credential_header_map` headers are built.
2. **`tool_allowlist`** (JSON list of original tool names, empty = all). The
   tools a user gets by default. Applied in `get_openai_tool_descriptors` and in
   `execute` (both doors). The Connections "What it can do" list still shows
   every tool, marking which are on.
3. **`tool_effects`** (JSON `{name: "reversible" | "irreversible"}`). Tightens
   only. A tool named here is never treated as a read, even when its name
   starts with `get_`. It cannot mark anything as a read. `looks_read_only`
   stays the only way a tool becomes ungated, so our own settings cannot open a
   hole either.
4. **`serial_calls`** (bool). When true, `mcp_reads_only` answers False for that
   server's tools, so reads run one at a time (Sentry).
5. **Schema normaliser** (`mcp_integration/schema.py`, pure): inline
   `$ref`/`$defs` (with a depth cap), turn a root `oneOf`/`anyOf` of objects
   into one object with the union of properties and none required, collapse
   `type: [x, "null"]` to `x`, drop keywords outside a conservative JSON-Schema
   subset (`format` kept as text), cap description length. Pure function, so it
   is tested on captured fixtures (Phase 4). Runs in `_build_openai_descriptor`.
   The pin digest stays computed on the **original** schema, so normalising
   never looks like a rug pull.
6. **Tool budget.** A per-turn cap on MCP descriptors (`MCP_MAX_TOOLS_PER_TURN`,
   default 40). Past it, drop the connectors' extra tools in a stable order
   (server id, then tool name: keeps the prompt cache) and add one line to the
   trailing context message saying which connectors were trimmed. Never
   silently. `tool_allowlist` should mean we never hit it.
7. **Platform-approved pins for curated rows.** When a curated row's tool
   definition changes, staff approve once with
   `manage.py mcp_pins approve <server> <tool>` (or in Django admin), and
   that approval covers every user. Instruction-shaped descriptions are still
   quarantined per user. **Needs the user's decision** (§8).

Tests: one per field at both doors; normaliser table tests; budget order is
stable across two identical turns (assert identical descriptor lists).

### Phase 4 — Conformance harness

The part that proves "our agent loop is compatible", for every connector, before
its row is enabled.

**Offline** (CI, no network): `mcp_integration/tests/fixtures/connectors/<slug>/
tools_list.json` is the vendor's real `tools/list` response, captured in the
live check below. `test_connector_conformance.py`, parametrised over every
fixture, asserts:

- every encoded name is ≤ 64 chars, matches `[a-zA-Z0-9_-]`, and is unique
  (`encode_tool_name` adds a digest; prove it holds for this vendor);
- every normalised schema is in our safe subset and still has
  `type: object` at the root;
- the allow-listed tools fit inside the tool budget;
- no allow-listed description trips `instruction_shaped` (or the fixture
  documents why it is quarantined);
- every allow-listed tool not covered by `looks_read_only` either appears in
  `tool_effects` or is consciously left irreversible (the default), so the
  read/write split is a decision, not an accident;
- chat sees only the read tools (`execute_chat_tool` refuses the rest), and the
  test prints the allow-listed tools the name rule treats as writes, so a real
  read that chat cannot use is a known fact, not a surprise (§8.6);
- an agent with the `mcp` grant and `connectors: [{id, mode: "read"}]` is
  offered only reads; `mode: "all"` offers writes, which pause for approval.

**Live** (manual, with the user's go-ahead and a test account per vendor):
`manage.py connector_check <icon_slug> --user <email>`. It connects with that
user's token, prints protected-resource + AS metadata, runs `initialize` +
`tools/list`, writes the fixture, makes **one read call** chosen per connector,
forces a token refresh, and reports pass/fail per step. No write calls. Only a
real `tools/list` counts as evidence (H-110).

**End to end** (manual, per connector, recorded in the Progress table):
1. Connect from the web Connections page, then from the phone.
2. In chat: a question that needs a read tool. It answers, and the tool result
   shows as untrusted in the run view.
3. In an agent run with `mode: "all"`: one write. It pauses for approval; the
   Inbox shows a readable `describe_call` line, not `mcp__7__...`.
4. Disconnect → the tools leave the next turn; the card says Connect.
5. Revoke at the vendor → next call yields `reauth_required` and the card turns
   to "Sign in again".

### Phase 5 — Wave 1: Linear and Sentry (work with DCR)

Both advertise dynamic registration, so they need Phases 0–4 and no vendor app
setup. Details in §6.1 and §6.2.

### Phase 6 — Wave 2: GitHub, Asana, Stripe

GitHub and Asana need a vendor app registered by the user (§8). Stripe has DCR
but moves money, so it ships read-only first. Details in §6.3–§6.5.

### Phase 7 — Wave 3 spikes: HubSpot and Atlassian

Each starts as a one-day spike that answers its open questions (§6.6, §6.7)
with a real account. Build only if the spike passes.

### Phase 8 — Deferred: Slack MCP

Not buildable for us today (§6.8). Messaging keeps covering Slack.

### Phase 9 — One catalogue, four engines, and a "Get started" panel

Today `setup_notes` shows only when a card is switched off, so a user gets no
guide **before** connecting, and API/SQL connections live on a separate
"Custom tools" form with no catalogue at all.

1. **`MCPServer.kind`**: `mcp | native | api | sql` (the table keeps its
   historical name, like `nodes_aimodel`). The Connections page renders every
   kind with the same card. Existing rows backfill from `type`.
2. **`MCPServer.setup_guide`** (JSON, data not code, H-109):
   `{you_need: [..], admin_needed: str|null, cost: str, time: str,
   steps: [{text, url?}], limits: [..], fields: [{name, label, kind:
   text|secret|file|select, help, pattern?}]}`. Rendered as a **Get started**
   panel in the connect modal (web) and `ConnectionDetailScreen` (mobile), shown
   before connecting and reachable after. Validated by a serializer and a test
   that every enabled curated row has a guide with at least one step.
3. **Templates for `api` and `sql` cards.** `MCPServer.template` holds the
   connection shape (base URL pattern like `https://{subdomain}.freshdesk.com/
   api/v2`, auth shape, spec file name or driver kind, preset options). **Connect**
   on such a card collects `fields`, stores secrets in the vault, and creates the
   user's own `ApiConnection` / `DataConnection` from the template through the
   existing `datasources` serializers (one save path). The card then reads as
   connected while that row exists. Placeholders in a URL are filled from
   validated fields only, then pass the egress/SSRF guard like any URL.
4. **User-supplied endpoints for MCP rows.** Some hosted servers are per user
   (Zoho's URL carries a secret key; Supabase needs a project ref; Snowflake's
   managed MCP is per account). A curated MCP row may declare
   `url_template` + `fields`; a field marked `secret` (Zoho's whole URL) is kept
   in the vault, never on the row or in logs.
5. **Expiry and re-sign-in.** `setup_guide.limits` states expiry the vendor
   imposes (Stripe 14 days, brokers daily, Mailchimp keys one year) and the card
   counts down from it (Phase 2 item 6).

Tests: kinds render; a template with a bad placeholder is refused; Connect on an
API card creates exactly one `ApiConnection` owned by the caller with the secret
in the vault; a foreign or unknown card id gets the same 404.

### Phase 10 — API cards

The `call_api` engine is built (OpenAPI validation, GET = read, writes need
approval, vault auth, model-supplied `Authorization` dropped). This phase adds
the auth shapes real APIs use and ships the first batch of cards.

1. **Auth shapes** in `ApiConnection.auth` (today `bearer | header | query |
   basic`): a **prefix** on header auth (`Klaviyo-API-Key `,
   `Token token=`, raw ClickUp/Monday tokens with no prefix); **two secrets**
   (Datadog's two headers, Trello's key + token, Twilio's SID + secret);
   **static non-secret headers** (Klaviyo `revision`); **login-for-token**
   (Shiprocket: POST credentials, cache the short-lived token, retry once on 401).
2. **Spec files** in `datasources/catalogue/<slug>.json`: the vendor's official
   OpenAPI trimmed to the read operations we offer, or a small hand-written spec
   when the vendor has none (Airtable, Trello, Vercel). Trimming keeps the
   operation index small and makes "what the card can do" a reviewed list.
3. **Curated read lists.** GraphQL reads are POSTs (Monday). A card may name
   operations that are reads despite their method. Same question as §8.6;
   until decided, such a card asks for approval on those reads.
4. **First batch (Wave 1 in the catalogue):** Cloudflare, DigitalOcean,
   Netlify, Vercel, PagerDuty, Todoist, Trello, ClickUp, Airtable, Calendly,
   Cal.com, Pipedrive, Freshdesk, Mailchimp, Klaviyo, SendGrid, Brevo, Postmark,
   Typeform, Jotform, Contentful, WooCommerce, OpenWeather.
5. **Per-card live check**: `manage.py connector_check <slug>` (Phase 4) learns
   the `api` kind: build the connection from the template with a test key, call
   one GET, assert the response shape.

### Phase 11 — SQL engines

Production is a small shared box, so **prefer the vendor's HTTP SQL API over a
Python driver** (measured footprints in the catalogue §9).

1. Drivers in `datasources/drivers.py`, each an optional kind listed by
   `available_kinds()`: `snowflake` (SQL API + key-pair JWT), `databricks`
   (Statement Execution API + token), `bigquery` (REST `jobs.query` + service
   account or Google OAuth), `clickhouse` (HTTP, `readonly=1` on every request).
   Supabase and Neon are presets on the existing `postgres` kind.
2. **Dialect rules in `sqlcheck.py`**, per kind: reject `CALL`, `EXECUTE
   IMMEDIATE`, scripting (`DECLARE`), `COPY INTO`, `UNLOAD`, multi-statement
   batches, data-modifying CTEs in Postgres, and ClickHouse table functions
   (`url()`, `s3()`, `file()`). Each rule gets a refusal test.
3. **Cost guards** passed on every call: BigQuery `maximumBytesBilled` (card
   field, default 1 GB), Databricks `row_limit`/`byte_limit`/`wait_timeout`,
   Snowflake `timeout`, ClickHouse `max_execution_time` (U), plus our row cap.
   The setup guide tells the user to auto-suspend their warehouse.
4. **MongoDB** is not SQL: a new read tool `query_mongo` (grant-gated like
   `query_sql`) over `pymongo` (~1 MB), accepting `find`/`aggregate`/`count`,
   rejecting `$out`, `$merge`, `$function`, `$accumulator`, `$where`, with
   `maxTimeMS` and a result cap. A new tool, so it follows the "adding a tool"
   checklist (registry declaration, `effect="read"`, grant, both doors).
5. Redshift waits: its Data API needs AWS request signing, and `boto3` is too
   heavy for the box until measured.

### Phase 12 — OAuth presets for API cards

Some APIs are OAuth-only (Microsoft Graph, Shopify, Salesforce, Dropbox, Box,
Zoom) or deprecate keys (Zendesk). Reuse Phase 2's sign-in code for API cards:
`template.oauth = {authorize_url, token_url, scopes, client_env}`, one app
registered per vendor by you. Each preset is its own spike; Microsoft 365 first
(widest reach).

### Phase 13 — Indian connectors

From the catalogue §6–§8:

- **Zerodha (Kite) and Upstox** (MCP): read-only allowlists, never order or GTT
  tools; daily re-sign-in shown on the card. **Agent-loop risk:** Kite's login is
  a link returned by a `login` tool and held in the MCP session, and our pooled
  sessions close after 5 idle minutes (`MCP_SESSION_TTL`). The live check must
  show whether a login survives a session close; if not, Kite needs a
  per-user session that lives until 6 AM.
- **Razorpay** (MCP): reads only; test-mode keys first; OAuth if third parties
  may register.
- **Zoho** (MCP): user-supplied secret URL (Phase 9 item 4).
- **Zomato** (MCP, spike): reads and cart; `checkout_cart` always asks and is
  refused in unattended runs (`carries_credentials` already gates it; add it to
  `tool_effects` as irreversible).
- **Swiggy**: apply to the Builders Club first; build on acceptance.
- **SEBI note** in `SAFETY_AND_GUARDRAILS.md`: why broker connectors are
  read-only (per-client static IP for orders since 2026-04-01).

### Phase 14 — Aggregator (decision only)

No build. Revisit Pipedream Connect if users ask for apps the catalogue lacks
(catalogue §13). Composio is ruled out for now (May 2026 credential leak);
Zapier MCP does not fit a multi-user product.

## 6. Connector notes

Research of each vendor's own docs and live `.well-known` metadata, 2026-11-23.
**Verified** = read on the vendor's own site or fetched live. **Unverified** =
not settled by what we read; each connector's live check must answer it.

### 6.1 Linear — Wave 1

- **Endpoint:** `https://mcp.linear.app/mcp` (streamable HTTP). Read-only
  variant `https://mcp.linear.app/mcp/readonly`. SSE `/sse` is deprecated.
  Verified (docs + live 401 challenge).
- **Auth:** OAuth 2.1 with DCR. Live AS metadata: `registration_endpoint
  https://mcp.linear.app/register`, PKCE S256, auth methods `client_secret_basic
  | client_secret_post | none`, scopes `read write openid email`. Linear API keys
  also work as a bearer. Verified.
- **Scopes:** `read` for the first release; `read write` when writes ship.
- **Tools:** not listed in Linear's docs ("finding, creating, and updating
  issues, projects, comments"). Names from `tools/list` only. Unverified.
- **Shaping:** start on the `/readonly` URL. Moving to `/mcp` with `write` is a
  later, separate migration.
- **Tokens:** "25-day refresh window" for MCP connections. Developer-API tokens
  rotate the refresh token on each use, with a 30-minute retry grace. Phase 2's
  lock covers rotation either way.
- **Limits:** no MCP-specific numbers; API limit 5,000 req/h per user for OAuth
  apps (not stated to apply to MCP).
- **Live check read call:** list my assigned issues.

### 6.2 Sentry — Wave 1

- **Endpoint:** `https://mcp.sentry.dev/mcp`, or org- and project-scoped
  `/mcp/{org}` and `/mcp/{org}/{project}`. Transport documented only as
  "HTTP". Verified URL; transport unverified.
- **Auth:** live AS metadata advertises `registration_endpoint
  https://mcp.sentry.dev/oauth/register`, PKCE S256, auth methods incl. `none`,
  scopes `org:read project:write team:write event:write alerts:write`. The prose
  docs do not describe DCR. An upstream Sentry token goes in a `Sentry-Bearer`
  header, not `Authorization`. DCR verified in metadata only.
- **Scopes:** `org:read` only for Wave 1, if the server accepts it alone. The
  live check confirms. Otherwise use the smallest set it accepts.
- **Tools:** the repo catalogue has ~80, about 24 of them writes by name
  (`create_*`, `update_*`, `delete_*`, `link_issue`...). Narrow with
  `?skills=inspect,triage` in the URL. Verified in docs; the hosted list is
  unverified.
- **Shaping:** URL `?skills=inspect,triage`; `tool_allowlist` of the issue,
  event, trace and search reads; `serial_calls = true` (Sentry's docs ask for
  one call at a time); `analyze_issue_with_seer` left out (Seer is a paid
  Sentry feature).
- **Open:** whether the hosted AI search tools (`search_issues`,
  `search_events`...) need a customer LLM key. If they do, leave them out.
- **Live check read call:** `find_organizations`.

### 6.3 GitHub — Wave 2

- **Endpoint:** `https://api.githubcopilot.com/mcp/`. GA since 2025-09-04.
  Read-only path `/readonly`; one toolset `/x/{toolset}`. Verified (docs,
  changelog).
- **Auth:** **no DCR** ("not supported at this time"). Needs a GitHub OAuth App
  or GitHub App we register, with a client secret; PKCE recommended. A user PAT
  also works as a bearer. Org owners may block third-party apps until they
  approve them. Verified.
- **Scopes:** GitHub's MCP scope page 404'd. Choose minimal OAuth App scopes in
  the spike (`repo` is broad; a GitHub App with fine-grained read permissions is
  the narrower choice). Unverified.
- **Tools:** toolsets `context, repos, issues, pull_requests, users` by
  default; dozens of tools. Narrow with headers `X-MCP-Toolsets` and
  `X-MCP-Readonly` (or the `/readonly` path). A typo in `X-MCP-Tools` stops the
  server; unknown toolset names are silently ignored. Verified.
- **Shaping:** `/readonly` URL + `static_headers: {"X-MCP-Toolsets":
  "repos,issues,pull_requests"}` for the first release.
- **Gotchas:** Copilot Business/Enterprise orgs must enable the "MCP servers in
  Copilot" policy; some tools need a paid Copilot licence (leave them out).
  Whether a non-Copilot user can use the endpoint at all is **unverified**:
  the spike's first question.
- **Live check read call:** `get_me`.

### 6.4 Asana — Wave 2

- **Endpoint:** `https://mcp.asana.com/v2/mcp` (streamable HTTP), GA. V1
  (`/sse`) is shut down. Verified.
- **Auth:** **no DCR** ("not supported with Asana's V2 MCP Server"). Register an
  "MCP app" at app.asana.com/0/my-apps with our redirect URL; client id +
  secret. AS metadata: PKCE S256, `client_secret_post | client_secret_basic`.
  Access tokens last one hour. Verified.
- **Scopes:** send `default` or no scope: a specific scope is refused with
  "Invalid scope(s) requested". Verified. So `oauth_scopes = "default"`.
- **Tools:** 44 (25 read, 16 write, 3 interactive previews). The previews need a
  client that renders interactive apps, so leave them out. `search_tasks` is
  Premium-only. Writes batch up to 50 items. Verified.
- **Schemas:** several tools take "exactly one of" two fields (`add_comment`:
  `text` or `html_text`). The normaliser must keep these callable; the fixture
  test checks them.
- **Gotchas:** workspace admins can block the app; Enterprise+ admins allow
  clients one by one.
- **Live check read call:** `get_me`.

### 6.5 Stripe — Wave 2 (read-only)

- **Endpoint:** `https://mcp.stripe.com`. Verified (docs + live 401).
- **Auth:** live metadata advertises DCR at
  `https://access.stripe.com/mcp/oauth2/register`, public client (auth method
  `none`), PKCE S256, scope `mcp`. Fine-grained permissions and live vs sandbox
  are chosen on Stripe's consent screen. Refresh tokens expire **14 days after
  consent**, whatever happens. Verified (metadata, docs); DCR not called.
- **Deadline:** from 2027-01-11 Stripe MCP refuses full-access secret keys and
  non-agent restricted keys. OAuth is unaffected; we never take pasted Stripe
  keys.
- **Tools:** 16 in the docs. `stripe_api_write` reaches **every** POST, PATCH,
  PUT and DELETE in the API. `send_money`, `transfer_money` and
  `convert_currency` move funds (Stripe makes them wait for "human
  confirmation" in the Dashboard). Verified.
- **Shaping:** `tool_allowlist` = `get_stripe_account_info`, `stripe_api_read`,
  `stripe_api_search`, `stripe_api_details`, `get_balance_summary`,
  `search_stripe_documentation`. Writes and Treasury are **not** in the
  allowlist, so they are neither offered nor dispatchable. Recommend
  sandbox-only consent for the demo account.
- **Agent-loop fit:** `stripe_api_read`, `stripe_api_search` and
  `stripe_api_details` do not start with a read prefix, so the name rule treats
  them as writes: chat refuses them, and an agent run asks for approval. That is
  safe but clumsy. Do **not** loosen the name rule for them; if chat needs
  them, that is a §8 decision about trusting a curated row's read list.
- **UX:** "Sign in again" warning from day 11 (Phase 2 item 6).
- **Live check read call:** `get_stripe_account_info`.

### 6.6 HubSpot — Wave 3 spike

- **Endpoint:** `https://mcp.hubspot.com` (streamable HTTP). Verified.
- **Auth:** **no DCR**. Requires an "MCP Auth App" in our HubSpot developer
  account, PKCE required, token auth `client_secret_post` only. Scopes are not
  chosen by the client; they follow from the tools, and new tools mean users
  must reinstall. Verified.
- **Blocker to settle in the spike:** HubSpot says Marketplace-distributed apps
  with MCP components need Ecosystem review. Whether a privately distributed MCP
  Auth App can serve any customer's account without review is **unverified**.
  If it cannot, HubSpot waits for review or is dropped.
- **Tools:** ~41–43; 17 `manage_*` writes, several of which HubSpot already
  makes ask for confirmation. Reads include `search_crm_objects` (≤200 per page)
  and `get_crm_objects` (≤100 ids).
- **Shaping:** read tools only in the allowlist.

### 6.7 Atlassian (Jira + Confluence) — Wave 3 spike

- **Endpoint:** `https://mcp.atlassian.com/v2/mcp`. v1 SSE was retired after
  2026-06-30. Verified (docs + live 401).
- **Auth:** OAuth 2.1. The v2 resource points at `auth.atlassian.com` as its
  authorization server; DCR is advertised on the v1 metadata but **no Atlassian
  doc confirms DCR or bring-your-own clients for v2** (their own ticket
  ROVO-870 asks for it). Unverified: the spike's first question.
- **Blocker:** each customer's admin keeps a **domain allow-list** of client
  origins allowed to use the server (defaults: claude.ai, chatgpt.com,
  vscode.dev, localhost...). Our origin is not on it, so every customer's admin
  would have to add us. Verified in docs.
- **Tools:** ~270 plus 7 meta-tools (`discover`, `executeRead`,
  `executeWrite`, `executeDestructive`...). Every call needs a `cloudId`
  (per site). Some "enriched" calls cost Rovo credits. Verified.
- **Agent-loop fit:** the `discover` → `execute*` pattern means the real action
  is an argument, not a tool name. Our name-based read/write rule sees only
  `executeRead`/`executeWrite`. `executeRead` does not start with a read prefix,
  so it would be gated, which is safe but clumsy. Needs its own design if built.
- **Decision:** spike only. Likely outcome: a native Jira connector (REST, like
  Notion) is the better path. Decide after the spike.

### 6.8 Slack — deferred

- `https://mcp.slack.com/mcp`, streamable HTTP only, no DCR. Verified.
- "Only directory-published apps or internal apps may use MCP. Unlisted apps
  are prohibited." Every workspace's admin approves the app. Verified.
- So: not available to us without a Slack Marketplace listing. Slack reading
  and posting already work through Messaging with a bot token (migration
  `0021`). The Slack MCP row stays `coming_soon`.

## 7. Order of work

| Phase | Depends on | Needs the user |
|---|---|---|
| 0 Retire custom servers | — | Read-only prod count before deploy |
| 1 OAuth on curated cards | 0 | — |
| 2 OAuth hardening | 1 | — |
| 3 Tool shaping | — (parallel with 1–2) | Pin policy decision (§8.3) |
| 4 Conformance harness | 3 | — |
| 5 Linear, Sentry | 1–4 | Test accounts; live checks |
| 6 GitHub, Asana, Stripe | 5 | Register GitHub + Asana apps; secrets into prod env; Stripe sandbox |
| 7 HubSpot, Atlassian spikes | 5 | Developer accounts; go/no-go per spike |
| 9 Catalogue kinds + Get started panel | 0 | — |
| 10 API cards | 9 | A test key per vendor for the live check |
| 11 SQL engines | 9 | Test warehouses (Snowflake/Databricks trials, a BigQuery project) |
| 12 OAuth presets | 2, 9 | Register each vendor app |
| 13 Indian connectors | 1–4, 9 | Zerodha/Upstox/Razorpay accounts; Swiggy application |
| 14 Aggregator | — | Decision only |

Suggested build order: 0 → 9 → 10 (most connectors per hour) → 1–4 → 5 → 11 →
6 → 13 → 12 → 7.

## 8. Decisions for the user

1. **Existing custom servers.** Recommended: hidden from agents and the page,
   rows kept, owner can still delete. Alternative: keep serving them, block only
   new ones.
2. **Vendor app registration.** GitHub, Asana (and HubSpot, if built) need apps
   registered under accounts you control, and their secrets in production's env.
   Nobody else can do this step.
3. **Pin approval for curated rows.** Recommended: staff approve a changed
   curated tool once for everyone (Phase 3.7). Alternative: keep per-user holds,
   accepting that a vendor update hides tools for every user until each
   approves.
4. **Stripe at all?** Recommended: yes, read-only, sandbox consent for the demo.
5. **Writes.** Every Wave 1–2 connector ships read-only. Writes are a separate,
   later migration per connector, through an agent's grant and approvals.
6. **Reads the name rule misses.** Some real reads don't start with a read
   prefix (Stripe `stripe_api_read`, HubSpot `discover_hubspot_schema`,
   Atlassian `executeRead`). Recommended: leave them gated, and list them per
   connector in the conformance report. Alternative: a curated row may declare
   a reviewed read list that chat trusts. That would be the first time our own
   data, not a name, ungates an MCP tool, so it needs its own design-history
   entry.

7. **Broker connectors** (Zerodha, Upstox): read-only forever, or revisit
   trading later? Recommended: read-only. SEBI's per-client static IP rule makes
   orders from a shared server impractical anyway.
8. **Zomato ordering**: allow `checkout_cart` behind approval, or keep Zomato
   to search, menus and order history? Recommended: start without checkout.
9. **Swiggy**: apply to the Builders Club (only you can).

## 9. Progress

| Phase | State | Notes |
|---|---|---|
| 0 | built 2026-11-24 | `MCP_CUSTOM_SERVERS_ENABLED` + `CUSTOM_MCP_SERVERS` (web, mobile); retired rows 404 except DELETE; agents keep a retired id (dropping it would widen the scope); test settings keep it on for the engine suites. H-169. Prod row count not yet checked |
| 1 | not started | |
| 2 | not started | |
| 3 | not started | |
| 4 | not started | |
| 5 | not started | |
| 6 | not started | |
| 7 | not started | |
| 8 | deferred | Slack MCP needs a Marketplace listing |
| 9 | 9a built 2026-11-24 | `kind` + `setup_guide` (validator `setup_guide.py`, migration 0024 writes guides for the six live cards), Get started panel on web (card + Connect dialog) and mobile (detail screen). 9b (templates, Connect for API/SQL cards, user-supplied endpoints) ships with Phase 10 |
| 10 | not started | |
| 11 | not started | |
| 12 | not started | |
| 13 | not started | |
| 14 | decision only | |

## 10. Sources (read 2026-11-23)

- Linear: https://linear.app/docs/mcp ; https://linear.app/developers/oauth-2-0-authentication ;
  https://mcp.linear.app/.well-known/oauth-authorization-server (live)
- Sentry: https://mcp.sentry.dev/ ; https://github.com/getsentry/sentry-mcp ;
  https://mcp.sentry.dev/.well-known/oauth-authorization-server (live)
- GitHub: https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md ;
  https://github.com/github/github-mcp-server/blob/main/docs/host-integration.md ;
  https://github.blog/changelog/2025-09-04-remote-github-mcp-server-is-now-generally-available/
- Asana: https://developers.asana.com/docs/integrating-with-asanas-mcp-server ;
  https://developers.asana.com/docs/mcp-tools-reference ; https://developers.asana.com/docs/oauth
- Stripe: https://docs.stripe.com/mcp ; https://mcp.stripe.com/.well-known/oauth-authorization-server (live)
- HubSpot: https://developers.hubspot.com/docs/apps/developer-platform/build-apps/integrate-with-the-remote-hubspot-mcp-server ;
  https://developers.hubspot.com/docs/apps/developer-platform/add-features/mcp-registry
- Atlassian: https://developer.atlassian.com/cloud/rovo-mcp/ ;
  https://support.atlassian.com/atlassian-rovo-mcp-server/docs/supported-tools/ ;
  https://support.atlassian.com/security-and-access-policies/docs/available-atlassian-rovo-mcp-server-domains/
- Slack: https://docs.slack.dev/ai/slack-mcp-server/
