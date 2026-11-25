# `credentials/`: saved API keys and logins

The user sees this on the Credentials and Connections pages: the keys and
OAuth logins they connect (an OpenAI key, a Google login, a Slack token). Each
secret is **encrypted** with `CREDENTIAL_ENCRYPTION_KEY` and is never sent back
to the browser.

Design: [`docs/SAFETY_AND_GUARDRAILS.md`](../docs/SAFETY_AND_GUARDRAILS.md) (the old
`CREDENTIALS_AND_SECURITY.md` was folded into it).

## Data (`models.py`)

| Model | What it is |
|---|---|
| `CredentialType` | A kind of credential and its fields, for example "OpenAI: api_key". Created by a migration, so a fresh install has them |
| `Credential` | One saved credential for one user. Secret fields are encrypted |
| `CredentialAuditLog` | Who used or changed a credential, and when |

## Files

| File | What it does |
|---|---|
| `manager.py` | `CredentialManager`: **the one way to read a credential**. Decrypts, caches for 5 minutes, refreshes OAuth tokens |
| `resolution.py` | Which key is used to call provider X for user Y. Platform-key fallback lives here |
| `refs.py` | Secret references: a tool argument names a credential (`{"secret_ref": "slug.field"}`) and the value is filled in at dispatch, then scrubbed from results |
| `oauth.py` | The Google sign-in flow for connecting an account. Holds `ALLOWED_REDIRECT_ORIGINS` |
| `chatgpt.py` | "Continue with ChatGPT": sign-in link, code exchange, token refresh (the refresh token rotates, so the new one is always saved), sign-out |
| `chatgpt_views.py`, `chatgpt_urls.py` | Its routes, including `/auth/callback`, where OpenAI sends the browser back |
| `verification.py` | `CredentialVerifier`: checks that a saved credential actually works |
| `browser_utils.py` | Logs into a site with a headless browser and collects its auth tokens |
| `views.py`, `urls.py`, `serializers.py` | `/api/credentials/`. Its `balance` action (`GET /api/credentials/<id>/balance/`) shows what is left on an OpenRouter key |
| `../llm/balance.py` | Asks OpenRouter what a key has left (`/api/v1/key`, optionally `/api/v1/credits`). Called by the `balance` action; lives in `llm/` because it is a provider call |
| `management/commands/seed_connector_credentials.py` | Creates the credential types the connectors need. The migration calls the same code |

## Rules

- Read a credential only through `CredentialManager`. A second lookup would skip the cache and the refresh.
- A blob field wins over the same-named token column. Do not "unify" that.
- Tests that read credentials must clear the manager's cache in `setUp`. Test databases reuse ids.
- `CredentialType` rows already exist in tests, from migrations. Use `update_or_create`, not `create`.

## Tests

`credentials/tests/`: `test_credentials.py`, `test_refs.py`, `test_chatgpt_auth.py`, `test_browser_utils.py`, `test_health.py`.
