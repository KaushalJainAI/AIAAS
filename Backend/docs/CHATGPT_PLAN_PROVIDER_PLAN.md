# Remove OpenCode Zen; add "Continue with ChatGPT" — plan

Status: **built 2026-10-11, not yet run against a real ChatGPT account.**
Phases 1–6 are in the code and tested with stubs. Phase 0 (the spike,
`scripts/chatgpt_plan_spike.py`) needs a person to sign in and has not been
run, so §10 is empty and every **[verify]** below is still open — including
whether the plan route accepts function tools, which agents need. Phase 7 (the
hosted site) is blocked on OpenAI. What was built differently from this plan
is listed in §11.
Audience: the engineer (or model) implementing it. Do the phases in order; each
ends with a check. Facts about OpenAI's side were read from
`developers.openai.com/siwc` on 2026-10-10 and are marked **[verify]** where the
docs were silent — do not build on a **[verify]** item before testing it with a
real ChatGPT account.

---

## 1. The two decisions, in short

1. **OpenCode Zen goes.** It was never verified with a real key
   (`OPENCODE_ZEN_PLAN.md` §8), it serves three free models OpenRouter's free
   router already covers, and it is a fifth provider to keep in step.
2. **`chatgpt` replaces it as the bring-your-own provider**: a user presses
   "Continue with ChatGPT", approves once, and their turns run on the usage
   already included in their ChatGPT plan (the same allowance Codex draws from).
   We use OpenAI's **official** Sign in with ChatGPT flow, announced at DevDay
   2026-09-29 — not the reverse-engineered Codex CLI route.

### The constraint that shapes everything

OpenAI's docs say plan usage is available today to **open-source, locally
hosted apps**. A **paid or remotely hosted** app must apply through the
[interest form](https://openai.com/form/sign-in-with-chatgpt-interest/). The
flow enforces this by itself: the redirect must be an HTTP **loopback** address
(`http://127.0.0.1:<port>/auth/callback`), which reaches the computer running
the browser — never our GCP server.

So there are two tracks:

| Track | Who | When |
|---|---|---|
| **A. Self-hosted** | Anyone running AIAAS on their own machine (`docker compose up`, MIT licence) | Build now — Phases 2–6 |
| **B. Hosted site** | Users of the production deployment | Only after OpenAI approves the interest form — Phase 7 |

`CHATGPT_PLAN_ENABLED` is `True` in `settings/local.py` and `False` in
`settings/deployment.py` until Track B is approved.

### What we will not do

**Do not use the Codex CLI's client id against `chatgpt.com/backend-api/codex`.**
Several open-source tools did this before the official flow existed. It means
our server pretends to be OpenAI's CLI and holds many users' ChatGPT tokens on
a hosted box, which is exactly the case OpenAI asks hosted apps to get approval
for. The cost of being wrong lands on the user's ChatGPT account, not on us.
The same applies to the "paste the failed localhost URL back into the site"
trick: it works technically and puts us in the same unapproved position.

---

## 1a. Phase 0 — A one-file spike, before any product code

Revised 2026-10-10 after a gap review. Four unknowns decide whether this
feature is worth building at all, so they are tested first, with a throwaway
script in `Backend/scripts/` (PKCE sign-in on a loopback listener, then one
streamed `/v1/responses` call) and a real ChatGPT account:

1. **Can an unregistered open-source app sign in at all?** One docs page
   describes `dynamic_agent_client`; another says client ids go to "a select
   group of commercial partners". If sign-in is refused, stop here and wait for
   the interest form.
2. **Are function tools accepted?** If not, this provider can chat but cannot
   run agents or let chat delegate. Decide then whether a chat-only provider is
   worth shipping; do not discover it in Phase 3.
3. **Which callback ports and what `ext_agent_host_id` format are accepted?**
4. **What does `/v1/models` return** (slugs, context, image input, effort)?

Save the raw event streams from the spike: they are the fixtures Phase 3's
tests replay. Fill in §10 before Phase 2 starts.

## 1b. The change budget — what makes this safe for the existing system

The seam is `llm/access.py`: it fetches a handler by provider slug and consumes
`{type: content | metadata | error, ...}` dicts from `execute` /
`stream_execute`. A new handler that emits the same dicts gets tools,
streaming, thinking, steering, curation and vision witnesses for free, and
nothing above it changes.

**Not edited by this plan:** `llm/handlers/openai_compatible.py`,
`llm/access.py`'s call path, `chat/turn/*`, `agents/agent/*`, and
`Credential.get_valid_access_token` (Google-only by its own docstring — leave
it so).

**Edited, a few lines each:** `llm/providers.py` (slug + label),
`llm/handlers/registry.py` (register), `credentials/manager.py` (one branch
that calls the new refresh for this type), the error classifier (new codes,
additive), `llm/views.py` (hide the provider when the setting is off or the
user's listing lacks a model), `agents/config.py` (refuse a schedule on this
provider), two frontend files. Everything else is new files.

**Two tests guard the old system:** (a) with `CHATGPT_PLAN_ENABLED=False`,
`/api/llm/models/` returns exactly what it returned before; (b) the request
body each of the four existing providers builds for a fixed transcript is
byte-identical before and after (capture it first, per the refactor parity
rule).

**OpenCode is removed in two steps, in a separate commit from ChatGPT:** first
*switch it off* (stop offering it, move stored rows to the default — data
only, easy to undo), then delete the code a release later once nothing has
complained. Phase 1 below describes the end state.

---

## 2. Phase 1 — Remove OpenCode Zen

Order matters: fix the migration first, or a fresh `migrate` breaks.

**1.1 Migration `credentials/migrations/0010_opencode_credential_type.py`.**
Its `seed_opencode` imports `CREDENTIAL_TYPES` from the seed command and does
`next(s for s in ... if s['slug'] == 'opencode')`. Once the seed entry is
deleted that raises `StopIteration` on every fresh install. Make both functions
no-ops (`RunPython.noop`) and say why in the docstring. Keep the file — it is in
`django_migrations` on every existing database.

**1.2 New data migration `credentials/00NN_remove_opencode.py`.** Delete
`Credential` rows of type `opencode`, then the `CredentialType` row. A secret we
can no longer use should not stay in the vault. Reverse is a no-op.
Before deploying, count them on production
(`Credential.objects.filter(credential_type__slug='opencode').count()`); this
delete is not reversible. **Decision for the user — see §9.**

**1.3 New data migration in `chat`, `core`, `agents`** (one each, or one in
`agents` depending on all three): rows with `llm_provider='opencode'` on
`ChatSession`, `UserProfile` and `SubAgent` move to the shipped default
(`openrouter` / `openrouter/free`), and an effort level the new model lacks is
cleared. `SharedAgent` snapshots are moved the same way (an installer must not
receive a provider that no longer exists). `SubAgentRevision` rows are **left
alone**: they record what a past run really used.

**1.4 Code.**

| File | Change |
|---|---|
| `llm/providers.py` | Drop `opencode` from `SUPPORTED_PROVIDERS`, `PROVIDER_LABELS` and the docstring. Do **not** add it to `RETIRED_PROVIDERS` — that map means "now served by this OpenRouter prefix", and Zen's ids have no OpenRouter equivalent |
| `llm/handlers/llm_providers.py` | Delete `OpenCodeZenNode` |
| `llm/handlers/registry.py` | Drop the import, the `register` call and the docstring mention (lines 11, 110, 118) |
| `credentials/resolution.py` | Drop the `opencode` paragraph above `PLATFORM_ENV_KEYS` |
| `credentials/verification.py` | Delete the `slug == 'opencode'` branch (lines 88–131) |
| `credentials/management/commands/seed_connector_credentials.py` | Delete the entry at line 407 |
| `populate_models.py` | Delete the provider block (lines ~832–855) and the comment at 441; add the three seeded ids (`opencode/space-bunny-free`, `opencode/longcat-2.5-preview-free`, `opencode/mimo-v2.6-flash-free`) to `RETIRED_MODEL_VALUES` beside the six already there. Check how the script treats an `AIProvider` row that is no longer seeded; if nothing deactivates it, set `is_active=False` explicitly so the picker stops listing an empty provider |
| `llm/catalog_refresh.py` | Check `SUGGESTED_SUCCESSORS` for any `opencode/*` key or value |
| `chat/turn/agent.py:539` | Drop `"opencode"` from `_RAW_FILE_PROVIDERS` |
| `agents/` | `makemigrations orchestrator` — `SubAgent.llm_provider` choices changed |

**1.5 Tests.** Delete `llm/tests/test_opencode_provider.py` and the OpenCode
block in `credentials/tests/test_credentials.py` (lines ~109–180). In
`llm/tests/test_seed_catalogue.py:255` drop `'opencode'` from the tuple.

**1.6 Frontend.** `components/chat/StandaloneChat.tsx` lines ~2673–2730 (the
free-model description and the "Add your OpenCode Zen key" prompt) — remove
now; Phase 5 puts the ChatGPT button in the same place.
`components/mcp/MCPServerModal.tsx:32` — drop `'opencode'`.

**1.7 Docs.** `CLAUDE.md` (lines 167, 172, 2794, the env/provider prose),
`START_HERE.md:93`, `Backend/README.md:45`, `llm/README.md:21,50`,
`AIAAS_Investor_Pitch_Guide.md:278`, `LLD_Guide/` (01, 02, 04, 05, 09, 10, 11),
`Backend/docs/README.md:47`, `progress.md:21`. Mark `OPENCODE_ZEN_PLAN.md`
"retired 2026-10-xx" at the top; keep the file as history. The many
"OpenCode-style side panel" mentions are about the *editor*, not the provider —
leave them.

**Check:** `grep -ri opencode Backend better-n8n-frontend/src` returns only the
two old migrations, `RETIRED_MODEL_VALUES` and the side-panel comments. Fresh
database: `manage.py migrate && manage.py boot` succeeds. `pytest llm credentials
agents chat/tests/test_pipeline.py`, `makemigrations --check`, `npm run lint`,
`tsc -b --force`.

---

## 3. What OpenAI's flow needs (reference for Phases 2–6)

**Sign-in** (public client, PKCE, no client secret):

- Authorize: `https://auth.openai.com/api/accounts/authorize`
- Token: `https://auth.openai.com/api/accounts/oauth/token`
- First sign-in uses `client_id=dynamic_agent_client`; the callback returns
  `code`, `state` **and an issued `client_id`**, which is used for every later
  call for that account.
- Parameters: `response_type=code`,
  `scope=openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`,
  `resource=https://api.openai.com/v1`, `code_challenge_method=S256`,
  `redirect_uri` (loopback; only the port may vary), fresh `state` and `nonce`,
  `agent_name_hint` (our app name, the same every time; omitted on
  re-authorisation), `ext_agent_host_id` (a stable id for this install, chosen
  and saved before the first sign-in).
- Access token lasts 1 hour. Refresh token lasts 30 days and **rotates** on
  every refresh — the replacement must be saved, and two refreshes for one
  account must never race.
- Sign-out: POST the refresh token to the `revocation_endpoint` from
  `https://auth.openai.com/.well-known/openid-configuration`.

**Inference:**

- `POST https://api.openai.com/v1/responses`, `Authorization: Bearer <access_token>`.
  This is the **Responses API**, not chat-completions — a protocol the codebase
  does not speak today.
- Must send `store: false` and `stream: true`.
- Refused: `temperature`, `top_p`, `max_output_tokens`, `truncation`, `user`,
  `metadata`, `background`, `conversation`, `prompt`, and any message with the
  `system` role. Refused tools: image generation, file search, code interpreter,
  computer use, hosted MCP. Refused inputs: audio, video, the Files API.
- Models: `GET https://api.openai.com/v1/models` with the same token; show
  entries with `visibility: "list"` by `display_name`, send `slug`. The list is
  a catalogue, not a promise — only a completed turn proves access.
- Function tools, image input and reasoning effort are **not mentioned** in the
  docs. **[verify]** all three in Phase 3; the agent loop needs function tools.

**Errors** (in a `response.failed` event or an HTTP status):

| Code | Means | What we do |
|---|---|---|
| `subscription_sharing_usage_limit_exceeded` (429) | Plan or per-app weekly cap reached | Stop; "Manage usage" link. Never retry |
| `subscription_sharing_user_not_eligible` (403) | Plan does not include this | Explain; do not loop the sign-in |
| `subscription_sharing_invalid_user` (401), `invalid_grant`, `refresh_token_*` | Token revoked or expired | Mark the credential unverified; "sign in again" |
| `subscription_sharing_unsupported_capability` (400) | We sent something refused | Explain; never resend the same body |
| `subscription_sharing_usage_unavailable` / `user_unavailable` (503) | Temporary | Bounded retry; keep the tokens |

**UI rules OpenAI sets:** the button reads **"Continue with ChatGPT"**; a
one-time modal says "You're using your ChatGPT plan"; "Using ChatGPT plan" and a
"Manage usage" link stay visible near the composer; at a limit, "Manage usage"
is the primary action.

---

## 4. Phase 2 — Sign-in and the credential

**2.1 Provider slug.** Add `chatgpt` to `SUPPORTED_PROVIDERS` (last — a
bring-your-own provider can never be the default) with label
`ChatGPT plan (your subscription)`. No entry in `PLATFORM_ENV_KEYS`, ever: one
person's plan must not serve another user.

**2.2 Credential type** `chatgpt`, `auth_method='oauth2'`, seeded by migration
(the fresh-install rule). One row per user per ChatGPT account:
`access_token` / `refresh_token` / `token_expires_at` in the existing columns;
the blob holds the issued `client_id`, `sub`, email, granted scopes and the
`id_token` (needed later as `id_token_hint`). Confirm the two token columns are
encrypted at rest before storing anything in them.

**2.3 `credentials/chatgpt.py`** (new; pure functions plus two HTTP calls
through `shared_client`):

- `host_id()` — the install's `ext_agent_host_id`: generated once, kept in a
  single-row table, never regenerated.
- `begin(user)` — makes the PKCE verifier, `state` and `nonce`, stores them
  server-side keyed by `state` (cache, 10-minute life, bound to the user id),
  returns the authorize URL.
- `complete(state, code, client_id)` — looks the attempt up by `state` (unknown
  or expired → refuse), exchanges the code, **validates the ID token** (JWKS
  signature, `iss == https://auth.openai.com`, `nonce` matches), writes the
  credential with `is_verified=True`.
- `refresh(credential)` — `grant_type=refresh_token` with the issued client id
  and `resource`; saves the **new** refresh token. Runs under the
  `select_for_update` re-fetch `Credential.get_valid_access_token` already uses,
  so two turns cannot spend one rotating token twice.
  `get_valid_access_token` refuses every non-Google type on purpose (it uses
  the Google client from settings); do not widen it. This is its own function
  with the same lock, called from one new branch in `CredentialManager`, and
  it uses the **issued** client id from the blob. On `invalid_grant` and the
  `refresh_token_*` codes: clear the tokens, `is_verified=False`, `last_error`
  set.
- `revoke(credential)` — revocation endpoint, then delete the row. A failed
  revoke still deletes locally and says so.

**2.4 Routes** (add all four to `Backend/docs/API.md`):

| Route | Auth | Does |
|---|---|---|
| `POST /api/credentials/chatgpt/start/` | JWT | Returns `{authorize_url}`. 404 when `CHATGPT_PLAN_ENABLED` is off; 400 when the request did not arrive on a loopback host |
| `GET /auth/callback` | none (bound by `state`) | The loopback landing. Calls `complete`, then redirects to the frontend's `/oauth/callback` with `?ok=1` or an error **code** — never a token, never OpenAI's raw message |
| `GET /api/credentials/chatgpt/status/` | JWT | `{connected, email, expires_at}` |
| `POST /api/credentials/chatgpt/disconnect/` | JWT | `revoke` |

`/auth/callback` sits at the site root because OpenAI allows only the port to
vary **[verify]** that port 8000 is accepted; if only 1455 is, the compose file
publishes the backend on 1455 as well. It is the app's third unauthenticated
route; every refusal is the same redirect with a generic error code.

**2.5 Resolution.** The new handler reads the access token itself from
`context.get_credential(...)`, refreshed first if it expires within five
minutes; `resolve_node_api_key` is not changed. **Never pass the token as
`api_key_override`**: `llm/access.py` treats an override as a platform key and
meters the turn against the user (`metered = bool(api_key_override)`). An agent
run can outlast the one-hour token, so the token is resolved per model call,
and the manager's 5-minute cache must not hand back one that has expired —
test that. Confirm `llm.preflight()` accepts this credential type as it stands.

**Check:** `credentials/tests/test_chatgpt_auth.py` against a stubbed auth
server — PKCE challenge matches verifier; a callback with an unknown, reused or
other-user `state` is refused; a wrong `nonce` is refused; a refresh saves the
rotated token; two concurrent refreshes make one HTTP call; `invalid_grant`
unverifies the row; `start/` is 404 with the setting off. Then one real sign-in
on a local install.

---

## 5. Phase 3 — A Responses-protocol handler

New file `llm/handlers/responses_api.py`, class `ResponsesAPINode`, and
`ChatGPTPlanNode(ResponsesAPINode)` in `llm_providers.py`, registered in
`registry.py`. It is a new base, not a subclass of `OpenAICompatibleLLMNode`:
the body shape, the event stream and the tool-call items all differ, which is
the same reason Ollama has its own.

**Request building** (one function, used by both `execute` and
`stream_execute`):

- The **first** `system` message becomes `instructions` — it is the session's
  stable prefix and must stay byte-identical turn to turn.
- Every **later** `system` message (clock, pace budget, plan, trim notice) stays
  in place in `input` with role `developer`. **[verify]** the plan route accepts
  `developer`; if not, send them as `user` messages wrapped in a labelled block.
  Never fold them into `instructions` — that rewrites the cached prefix every
  turn (the clock trap).
- An assistant turn with `tool_calls` becomes one `function_call` item per
  call; each `tool` message becomes a `function_call_output` with the same
  `call_id`. `llm/budget.py`'s segment rule already keeps these together.
- Tools are sent in the Responses shape (`{type: "function", name, parameters}`
  — flat, not nested under `function`).
- Images become `input_image` parts. Audio and video attachments are refused
  with a sentence before the request is sent.
- `store: false`, `stream: true` always. **Never** send `temperature`, `top_p`,
  or any output-token cap; a test asserts the body's key set.
- Effort: `reasoning: {effort}` through the existing `reasoning_payload` hook.
- With `store: false` the server keeps no reasoning between calls. First cut:
  do not send reasoning items back. **[verify]** whether
  `include: ["reasoning.encrypted_content"]` is accepted, and adopt it if a
  multi-step agent run measurably loses quality without it.

**Stream parsing:** `response.output_text.delta` → tokens; reasoning-summary
deltas → thinking; `response.output_item.done` of type `function_call` → a tool
call; `response.completed` → usage and the end; `response.failed` and
`response.incomplete` → an error carrying the code. A stream that ends without
`response.completed` is a failure, not an answer. `execute()` (non-streaming
callers) collects the stream — there is no non-streaming mode on this route.

**Retry:** keep the existing rule (`STREAM_CONNECT_RETRY_DELAYS`, only while
nothing was emitted) and add the two 503 codes; nothing else is retried.

**Errors:** extend `llm.classify_provider_error` /
`explain_provider_failure` with the table in §3. `usage_limit_exceeded` →
`LLMQuotaExhausted`; `not_eligible` and the token codes → `LLMAccessDenied`.
The sentence says "your ChatGPT plan", and carries the manage-usage link.

**Never cross the streams:** `llm/fallback.py` must not move a `chatgpt` turn
onto a platform key when the plan refuses (fail fast, tell the user), and must
never pick `chatgpt` as a fallback *for* another provider.

**Check:** `llm/tests/test_responses_handler.py` with recorded event streams —
text, a tool call, two tool calls in one turn, a failure mid-stream, a stream
cut before `completed`; the body-key assertion; the system→instructions /
developer split; a transcript round-trip (assistant tool call + results →
items → same call ids). Then, on a real account, one chat turn with a tool call
and one with an image, and write the three **[verify]** answers into §10.

---

## 6. Phase 4 — Models, cost and limits

**Catalogue.** The model list is per account, so it is fetched, not seeded:
`GET /v1/models` with the user's token, cached 10 minutes per user. Rows are
upserted into `AIModel` as `chatgpt/<slug>` (the value column is unique across
all providers; the prefix is stripped on the wire, the trick the Zen node used)
because the hot path reads context window and effort rungs from that table.
`/api/llm/models/` returns, for `chatgpt`, only the slugs in **this user's**
listing. Find out what the listing reports per model (context, image input,
effort rungs) **[verify]**; whatever it does not report comes from a small
hand-kept table in the handler module, and a slug in neither is offered with no
effort control and no image input rather than guessed.

**Image rule.** `offered_in_picker` requires image input. A plan model that
cannot be shown to read images stays out of the picker like any other.

**Cost.** Nothing is billed to us or by the token to the user. `cost_usd` is
recorded as 0 with `usage` tokens kept. The spend cap still works because
`rupees_for` is a blended rate over tokens; say in the builder that for this
provider the cap is a size limit, not money. The picker shows "Uses your
ChatGPT plan", never "Free".

**Where it may run.** Recommended for v1: `chat` and runs a person starts
(`api`, `orchestrator`). Refused at `check_guardrails` for
`UNATTENDED_CALLERS`, `mission` and `eval`, with a sentence naming the reason:
a schedule quietly spending someone's weekly plan cap overnight is the surprise
this product's guardrails exist to prevent. `AgentSerializer` refuses a
schedule on an agent whose provider is `chatgpt`. **Decision for the user — §9.**

**Side calls stay off the plan.** The context fold, the auto reviewer, solution
capture and moderation already run on platform models; confirm follow-up
questions and the vision witness do too, and move any that use the chat's own
provider.

**Check:** a user with no ChatGPT credential sees the provider with a
"Continue with ChatGPT" prompt and no models; user A's listing never appears
for user B; a scheduled run on a `chatgpt` agent is refused before any model
call; `test_effort.py::ShippedDefaultTests` still passes (the default did not
move).

---

## 7. Phase 5 — Frontend

- `components/settings/` and the chat model picker (where the OpenCode prompt
  was): a **"Continue with ChatGPT"** button. It calls `start/` and opens the
  URL in a popup; `pages/OAuthCallback.tsx` already handles the popup landing.
- First successful sign-in only: the modal "You're using your ChatGPT plan —
  eligible usage in this app uses your ChatGPT plan." Remembered per user on
  the server (a `UserProfile` flag), not in `localStorage`.
- While the selected provider is `chatgpt`: "Using ChatGPT plan · Manage usage"
  beside the model selector in `ChatHeader`.
- `lib/streamErrors.ts`: the limit, not-eligible and sign-in-again cases, with
  "Manage usage" as the primary action on the limit.
- Connections / credentials list: the ChatGPT row shows the account email and a
  Disconnect button; it has no key field.
- When `CHATGPT_PLAN_ENABLED` is off the provider is absent from
  `/api/llm/models/`, so nothing above renders. Do not show a disabled button.

**Check:** vitest for the error mapping; `chatPieces.test.tsx` for the header
line; lint at zero; `tsc -b --force`.

---

## 8. Phase 6 — Docs and safety notes; Phase 7 — the hosted site

**Phase 6.** `CLAUDE.md` (provider layer, env vars, a new pattern paragraph),
`llm/README.md`, `credentials/README.md`, `START_HERE.md`, `API.md`,
`SAFETY_AND_GUARDRAILS.md` (a third unauthenticated route; tokens for a
third-party account held in the vault), `LLD_Guide/`. New env vars:
`CHATGPT_PLAN_ENABLED`, `CHATGPT_AGENT_NAME` (the `agent_name_hint`).
Tokens never appear in logs, URLs, `AgentStep` payloads or error frames — add
the token prefix to whatever redaction the log filter already does.

**Phase 7 (blocked on OpenAI).** Submit the interest form for the hosted
deployment. If approved, OpenAI issues a client id and, presumably, an HTTPS
redirect; the work is then small — a second redirect URI, the issued client id
in settings, `CHATGPT_PLAN_ENABLED=True` in deployment — because Phases 2–5
were built behind one setting. Until then production does not offer the
provider.

---

## 9. Decisions needed from the user

1. **Submit the interest form** for the hosted site (only the account owner can).
   Without it, this feature exists for self-hosted installs only.
2. **Unattended use.** Recommended: plan usage only for chat and manually
   started runs in v1. Alternative: allow schedules, with the user's explicit
   opt-in per agent.
3. **Saved OpenCode keys.** Recommended: delete them in the migration.
   Alternative: keep the rows, deactivate the type.

## 9a. Known gaps (from the 2026-10-10 review)

- **Caller settings the route refuses.** Callers pass `temperature` and token
  caps in `config` (the eval judge, side calls). The handler drops them
  silently; with no output cap, a runaway answer is bounded only by the plan.
- **Switching provider mid-conversation.** History written under another
  provider carries that provider's tool-call ids and no reasoning items. The
  item conversion must accept them; add a test with a mixed transcript.
- **Fan-out on one plan.** Parallel workers set to `chatgpt` all draw on one
  person's cap and whatever concurrency limit OpenAI applies (unknown). Cap
  concurrent `chatgpt` calls per user at a small number until measured.
- **The popup landing.** `pages/OAuthCallback.tsx` was written for Google
  credential OAuth; check what query it expects before reusing it.
- **Old revisions.** A `SubAgentRevision` naming `opencode` (or later, an agent
  whose ChatGPT sign-in was removed) must still render, and restoring one must
  fail with a sentence, not a serializer 500.
- **"Open source" is OpenAI's condition.** Confirm the repository is public
  under its MIT licence before relying on the self-hosted track.
- **Whose terms apply.** Turns on this provider go to OpenAI under the user's
  own ChatGPT data settings, not ours. Say so in the one-time modal.
- **A JWT library for ID-token checks.** Confirm PyJWT with RSA support is
  already installed (simplejwt and `cryptography` suggest yes) before adding one.

## 10. Verification log (fill in during the build)

| Question | Answer | Date |
|---|---|---|
| Can an unregistered app sign in with `dynamic_agent_client`? | | |
| What `ext_agent_host_id` format is accepted? | | |
| Does `/auth/callback` on a port other than 1455 work? | | |
| Are function tools accepted on the plan route? | | |
| Is image input accepted? | | |
| Is `reasoning.effort` accepted, and which rungs per model? | | |
| Is the `developer` role accepted? | | |
| Is `include: ["reasoning.encrypted_content"]` accepted? | | |
| What does `/v1/models` report per model? | | |

## 11. What was built differently (2026-10-11)

- **OpenCode was removed in one step, not two.** The "switch off first" step
  made sense across releases; done in one sitting, the tests guard it instead.
- **`credentials/manager.py` was not touched at all.** The handler asks
  `credentials/chatgpt.py::access_token_for` directly, so the planned "one
  branch in the manager" was not needed.
- **No table for the host id.** `ext_agent_host_id` is derived from
  `SECRET_KEY` (hashed), or set with `CHATGPT_HOST_ID`.
- **The callback renders its own small page** and the opener polls `status/`.
  `pages/OAuthCallback.tsx` is Google-shaped and was left alone.
- **The credential type is seeded `is_active=False`**, inline in migration
  `0012`, so the generic "add credential" screen never offers it.
- **`ResponsesAPINode` subclasses `OpenAICompatibleLLMNode`** to reuse the
  system-prompt and structured-output helpers; both execute methods are
  replaced, and `openai_compatible.py` itself is unchanged.
- **The first-sign-in notice is inline in the picker (and on the popup page),
  not a modal.** OpenAI's guideline asks for a modal; do this before applying
  for the hosted site.
- **Not built:** the per-user cap on concurrent plan calls (§9a), the
  `reasoning.encrypted_content` round-trip, and a retry for the two 503 plan
  codes beyond the existing connection retry.
- **Known edge:** `llm/fallback.py` swaps a *retired* model for the platform
  fallback. A `chatgpt/…` row is never retired by the seed or the refresh
  (`source='hand'`), so this does not happen today; if such a row is ever
  switched off by hand, that agent's runs would move to the platform key.

## Sources

- OpenAI, Sign in with ChatGPT docs — `developers.openai.com/siwc` (overview,
  sign-in, accounts and sessions, models and inference, token reference, errors
  and recovery, preview limitations, self-hosted VMs, UI/UX guidelines)
- The New Stack, "OpenAI makes 'Sign in with ChatGPT' a way to use your
  subscription in third-party developer tools" — `thenewstack.io/sign-in-with-chatgpt/`
