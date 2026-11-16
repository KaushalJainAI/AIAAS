# "Continue with ChatGPT" — record

## Status

**Built 2026-10-11, not yet run against a real ChatGPT account.** Phases 1–6
are in the code and tested with stubs. Phase 0 (the spike,
`scripts/chatgpt_plan_spike.py`) needs a person to sign in and has **not
been run**, so §10-style verification is empty and the open questions below
stand. Phase 7 (the hosted site) is blocked on OpenAI. OpenCode Zen was
removed in the same build.

Audience: whoever finishes this. Facts about OpenAI's side were read from
`developers.openai.com/siwc` on 2026-10-10 and are **unverified** until the
spike runs — do not build on unverified items before testing them with a
real ChatGPT account.

## What it is

A user presses **"Continue with ChatGPT"**, approves once, and their turns
run on the usage already included in their ChatGPT plan — via OpenAI's
official **Sign in with ChatGPT** flow (DevDay 2026-09-29), not the
reverse-engineered Codex CLI route. OpenCode Zen went first: it was never
verified, serves models OpenRouter's free router already covers, and was a
fifth provider to keep in step.

Two tracks, decided by OpenAI's own constraint (plan usage is available
today to **open-source, locally hosted apps**; a paid or remotely hosted
site needs the [interest form](https://openai.com/form/sign-in-with-chatgpt-interest/)):

| Track | Who | When |
|---|---|---|
| **A. Self-hosted** | Anyone running AIAAS on their own machine | Built (Phases 2–6) |
| **B. Hosted site** | Users of the production deployment | Only after OpenAI approves — Phase 7 |

`CHATGPT_PLAN_ENABLED` is `True` in `settings/local.py`, `False` in
`settings/deployment.py` until Track B is approved. When off, its routes
404 and the provider is not offered — including the unauthenticated
`/auth/callback`.

## How it works (the short version)

- **Sign-in** (public client, PKCE, no secret): authorize at
  `https://auth.openai.com/api/accounts/authorize`; token at
  `https://auth.openai.com/api/accounts/oauth/token`; first sign-in uses
  `client_id=dynamic_agent_client`, and the callback returns `code`, `state`
  **and an issued `client_id`** used for every later call for that account.
  Scope: `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`,
  `resource=https://api.openai.com/v1`, `code_challenge_method=S256`,
  loopback `redirect_uri`, fresh `state`/`nonce`, `agent_name_hint` (our app
  name, the same every time) and `ext_agent_host_id` (a stable id for this
  install).
- **Tokens**: access token lasts 1 hour; the 30-day refresh token
  **rotates** on every refresh — the replacement must be saved and two
  refreshes for one account must never race. Sign-out: POST the refresh
  token to the `revocation_endpoint` from `.well-known/openid-configuration`.
- **Errors** (in a `response.failed` event or an HTTP status):
  `subscription_sharing_usage_limit_exceeded` (429) → stop, "Manage usage"
  link, never retry; `..._user_not_eligible` (403) → explain; `invalid_user`
  /`invalid_grant`/`refresh_token_*` → mark the credential unverified,
  "sign in again"; `unsupported_capability` (400) → never resend; `..._usage_unavailable`
  /`user_unavailable` (503) → bounded retry, keep the tokens.
- **UI rules OpenAI sets**: the button reads "Continue with ChatGPT"; a
  one-time modal says "You're using your ChatGPT plan"; "Using ChatGPT plan"
  and a "Manage usage" link stay visible near the composer; at a limit,
  "Manage usage" is the primary action.

## What it delivered

- **OpenCode Zen removed** (migrations `0010`/`0011`-era: Zen credential
  type/rows, provider code, seeds, docs sweep). Done in one step, not the
  planned two; tests guard the removal.
- **Provider slug `chatgpt`** with label "ChatGPT plan (your
  subscription)". Never a default, never a platform key (no
  `PLATFORM_ENV_KEYS` entry, ever — one person's plan must not serve
  another user).
- **Sign-in flow** (PKCE, public client, no secret): `begin()` →
  authorize URL → `/auth/callback` on a loopback address (the redirect OpenAI
  allows; only the port may vary) → `complete()` validates the ID token
  (JWKS, `iss`, `nonce`) and writes a `chatgpt` credential with
  `is_verified=True`. Refresh token **rotates**; replacement is always
  saved, under the same `select_for_update` lock the Google path uses.
- **Responses-protocol handler** (`llm/handlers/responses_api.py`,
  `ChatGPTPlanNode`) — the codebase did not speak Responses before.
  `System` messages: the first becomes `instructions` (the stable prefix,
  byte-identical turn to turn); later ones ride in `input` with role
  `developer`, never folded into `instructions` (the clock trap). Tools go
  in the Responses shape; `store: false`, `stream: true` always; no
  `temperature`/`top_p`/output caps ever. A stream that ends without
  `response.completed` is a failure, not an answer.
- **Catalogue is per account, not seeded** — `GET /v1/models` with the
  user's token, cached 10 min per user, upserted as `chatgpt/<slug>`.
  `/api/llm/models/` shows only this user's listing.
- **Cost** — `cost_usd` recorded as 0 with tokens kept; for this provider
  the spend cap is a size limit, not money. Unattended callers refused at
  `check_guardrails`; `AgentSerializer` refuses a schedule on a `chatgpt`
  agent. Side calls stay off the plan.
- **UI** — "Continue with ChatGPT" button (OAuth popup), "Using ChatGPT
  plan · Manage usage" beside the model selector, per-user sign-in notice,
  Disconnect in Connections, "Manage usage" as the primary action on a
  limit.
- **What was built differently:** `credentials/manager.py` untouched (the
  handler asks `credentials/chatgpt.py::access_token_for` directly);
  `ext_agent_host_id` is derived from `SECRET_KEY` (or `CHATGPT_HOST_ID`),
  no table; the callback renders its own small page and the opener polls
  `status/`; `ResponsesAPINode` subclasses `OpenAICompatibleLLMNode` for the
  helpers only; the first-sign-in notice is inline, not the modal OpenAI
  asks for.
- **OpenCode removal mechanics:** the seed migration was made a no-op (kept
  in `django_migrations`); a data migration deletes `opencode` rows then the
  type; stored rows on `ChatSession`/`UserProfile`/`SubAgent` move to the
  shipped default (`openrouter`); `SubAgentRevision` rows are left alone
  (they record what a past run really used); the provider block was dropped
  from `populate_models.py` and the picker emptied; a fresh
  `migrate && manage.py boot` was the check.

## The phases (all built except where noted)

1. **Remove OpenCode Zen** — migrations first, then provider code, then
   seeds, then the frontend prompt; docs sweep after.
2. **Sign-in and the credential** — `chatgpt` slug, OAuth2 credential type,
   `credentials/chatgpt.py` (host id, begin/complete/refresh/revoke),
   the four routes (`/start/`, `/auth/callback`, `/status/`, `/disconnect/`),
   loopback-only `start/`, never a token in the redirect, never a raw
   OpenAI error message.
3. **A Responses-protocol handler** — `responses_api.py` +
   `ChatGPTPlanNode`; `execute()` collects the stream (there is no
   non-streaming mode on this route); record bodies/streams so Phase-4+
   tests replay them against stubs.
4. **Models, cost and limits** — per-account catalogue, image-input rule,
   0-cost accounting with spend-cap-as-size-limit, unattended-callers
   refusal.
5. **Frontend** — the button, the inline notice, "Using ChatGPT plan ·
   Manage usage", disconnect row, the error mapping (`limit`,
   `not_eligible`, `sign_in_again`).
6. **Docs and safety notes** — `CLAUDE.md`, READMEs, `API.md`,
   `SAFETY_AND_GUARDRAILS.md` (a third unauthenticated route), log-filter
   redaction for token prefixes, `CHATGPT_PLAN_ENABLED`/`CHATGPT_AGENT_NAME`.
7. **The hosted site** — blocked on OpenAI (see Open).

## Decisions worth remembering

- **Never use the Codex CLI client id** against `chatgpt.com/backend-api/codex`
  — that is OpenAI's CLI impersonation and lands the risk on the user's
  account. Same for the "paste the failed localhost URL back into the site"
  trick. Both need the same approval as the hosted site; if Track B is not
  approved, neither happens.
- **The redirect must be a loopback address** — it reaches the computer
  running the browser, never our GCP server. `host_id` is stable per
  install, generated once, never regenerated.
- **A plan token is not a platform key.** `api_key_override` would
  meter the turn against the user — never pass one. The token is resolved
  per model call (a run outlives the one-hour token).
- **Fail fast on a plan refusal.** `llm/fallback.py` never moves a `chatgpt`
  turn onto a platform key (that would silently spend the user's plan
  with no way back), and never picks `chatgpt` as a fallback either.
- **Unattended use is refused in v1** — a schedule quietly spending someone's
  weekly plan cap overnight is what the guardrails exist to prevent.
- **Empty/negative answers are failures.** A stream cut before
  `response.completed`, a 503 without bounded retry, and never-eligible
  answers are all surfaced, never answered as if complete.

## Open

- **Phase 0 spike never run** — the whole verification table is empty:
  can an unregistered app sign in with `dynamic_agent_client`; accepted
  `ext_agent_host_id` format; whether a port other than 1455 works on the
  callback; **are function tools accepted** (agents' whole basis); image
  input; `reasoning.effort` rungs; the `developer` role;
  `include: ["reasoning.encrypted_content"]`; what `/v1/models` reports per
  model.
- **Phase 7 — the hosted site** — blocked on OpenAI. The interest form can
  only be submitted by the account owner; production does not offer the
  provider until approved.
- **Known gaps (2026-10-10 review):** per-user cap on concurrent plan
  calls (fan-out on one weekly cap draws everything down at once); the
  `reasoning.encrypted_content` round-trip; a 503 retry beyond the existing
  connection retry; callers that pass refused settings (eval judge, side
  calls) are dropped silently rather than refused.
- **Before Track B:** replace the inline sign-in notice with the modal
  OpenAI's UI guidelines ask for; confirm the repository is public under
  its MIT licence; get a JWT library with RSA support confirmed.
