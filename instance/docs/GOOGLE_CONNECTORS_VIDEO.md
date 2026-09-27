# Google Connectors — How a User Connects (Video Storyboard)

> **Goal:** 90-second video showing a non-technical user connecting `Gmail / Drive / Calendar` in one click, and seeing the agent use it.
> **Where:** `/connections` → `Connect` → Google OAuth popup → `Connected` → agent grants.
> **No secrets in video:** dummy `@example.com`, blurred auth screen if re-recorded for public.

### Prerequisites (local)

```bash
# Backend + Frontend running - same as instance/interactive-tests/README.md
cd Backend && DJANGO_SETTINGS_MODULE=workflow_backend.settings.local python manage.py runserver 0.0.0.0:8000
cd better-n8n-frontend && npm run dev   # http://localhost:5173

# Seed so Connections catalogue exists (migrations 0005,0011,0012,0014 must have run)
python manage.py migrate
python instance/scripts/seed_instance.py
```

`Backend/.env.local` already has platform OAuth client `860732387709-kurtttd0m4nc40mjfvngqh0cklat7odv.apps.googleusercontent.com` `instance/docs/USER_JOURNEY.md`. User brings **no** GCP project.

---

### Storyboard (90s, 6 chapters)

| # | Time | Screen | Action | Voiceover | File ref |
|---|------|--------|--------|-----------|----------|
| 0 | 0-5s | Login | `demo_user@example.com / test123` → landing | "AIAAS runs your agents on your Google Workspace — no keys to copy." | `core/views.py:140` `UserRegistrationView` |
| 1 | 5-20s | `GET /connections` `better-n8n-frontend/src/pages/Connections.tsx:948` | Cards: `Gmail`, `Google Drive`, `Google Calendar`, `Google Sheets` grouped by `CategoryOrder` `google_workspace` `mcp_integration/models.py:72`. Pill shows `Not connected` grey. | "Every Google connector is a curated `MCPServer (user=NULL)` — a template. You just flip your own switch." | `mcp_integration/serializers.py:36` `effective_enabled` |
| 2 | 20-45s | Click `Connect` on `Gmail` → `ConnectModal` `Connections.tsx:114` | Modal: `Sign in with Google` → `credentialsService.initGoogleOAuth(redirectUri, googleScopesFor('gmail'))` `api/credentials.ts:125` → `GET /api/credentials/oauth/google/init/?scopes=...` `credentials/views.py:209` → signed `state` `signing.dumps(user_id, redirect_uri)` + `ALLOWED_REDIRECT_ORIGINS` | "One tap. We ask Google for only what Gmail needs — `gmail.modify + send + settings.basic`." | `lib/googleScopes.ts:24` `GOOGLE_SCOPES[gmail]` |
| 3 | 45-60s | Google OAuth consent (popup `600×700`) `Connections.tsx:164` `window.open(url)` | User picks Google account → `Allow` → redirect `http://localhost:5173/oauth/callback?code=...&state=...` `pages/OAuthCallback.tsx:21` → `POST /api/credentials/oauth/google/callback/` `views.py:249` validates `state`+`redirect_uri`, `GoogleOAuthProvider.exchange_code` `oauth.py:40` `Fernet` encrypt `models.py:175` `access_token/refresh_token`, `update_or_create(user, name=Google Account)` | "Your token never leaves the vault — `Fernet(CREDENTIAL_ENCRYPTION_KEY)` + auto-refresh 5 min before expiry." | `credentials/manager.py:117` |
| 4 | 60-70s | Popup `postMessage OAUTH_SUCCESS` → `Connections.tsx:187` `toast Connected` | Card flips `Not connected` → `Connected` blue, `What it can do` expands `CapabilityList` `Connections.tsx:407` `GET /api/mcp/servers/<id>/tools/` `client.py:651` `list_tools` pooled `SESSION_TTL 300s`. If `credential_file_map` (Drive/Calendar) `client.py:144` writes `0700` file then `initialize`. | "Back on AIAAS: `validate_credentials` dry-run passes, the MCP session handshakes, tools appear." | `mcp_integration/client.py:212` `_SessionWorker` |
| 5 | 70-85s | `GET /agents/:id` Builder → `tool_grants.mcp=true` + `agent_context.connectors=[id]` `agents/agent/runtime.py:332` | Grant `mcp` plus selection. Mention `autonomy` slider `ask/auto/review/plan`. | "Give an agent the grant. `fileAccess`/`mcp_servers` is the second axis — grant says *may*, selection says *which*." | `runtime.py:156` `mcp_scope_for` |
| 6 | 85-90s | Run agent `POST /api/orchestrator/agents/{id}/execute/` → `ws/` stream | Agent calls `mcp__7__send_email_ab12cd` → `permissions.default_policy` `chat/tools/permissions.py:154` gates reads vs writes, approval dialog if `ask`. | "Unattended run? Every credentialed read also asks — `unattended_policy` `permissions.py:169`." | `runtime.py:377` `approval_policy_for` |

### Recording checklist

* Headed Chrome `1280×720`, hide bookmarks, use `demo_user@example.com`.
* Blur Google consent `email` if publishing.
* Show `Network` tab once to prove `state` param exists.
* End card: `Looking for a key? Manage saved accounts` `Connections.tsx:1049` link `/credentials`.

### What you will see when you re-run the Playwright demo

`instance/interactive-tests/scenarios/007-google-connectors-demo.spec.ts` — runs with `video: 'on'` and slow `delay: 30` typing, so `test-results/.../video.webm` **is the video**. No real Google credentials needed for the dry-run; with a real account the popup completes to `Connected`.

```bash
cd instance/interactive-tests
npx playwright test scenarios/007-google-connectors-demo.spec.ts --headed --project=chromium
# video → test-results/007-google-connectors-demo-*/video.webm
# convert: ffmpeg -i video.webm -vf "scale=1280:720" google-connectors-demo.mp4
```
