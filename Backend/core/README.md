# `core/`: users, login, and the request pipeline

The user sees this as sign-up and sign-in, the profile and Settings pages,
memory ("what the assistant knows about you"), API keys, usage, and teams. It
also holds the plumbing every request passes through: auth, rate limits, and
the input and output safety checks.

## Data (`models.py`)

| Model | What it is |
|---|---|
| `UserProfile` | Per-user settings and account state: tier, default model and effort, default autonomy, `paused_until` ("pause everything") |
| `UserMemory` | Facts the assistant remembers across chats (`memory.py`). Shown in Settings → Memory |
| `APIKey` | Keys for calling the API without a browser login. Stored as SHA-256 |
| `UsageTracking` | Usage counters |
| `PasswordOTP` | One-time codes for password reset |
| `Organization`, `Membership`, `OrgInvite` | Teams, the people in them, and invitations |

## Files

| File | What it does |
|---|---|
| `views.py`, `urls.py`, `serializers.py` | Sign up, log in, profile, API keys, memory, usage (`/api/auth/...`, `/api/memory/`, `/api/usage/`) |
| `org_views.py`, `orgs.py` | `/api/orgs/`: teams, members, invitations. Membership is checked live, never cached |
| `memory.py` | Reads and writes `UserMemory`. Repeats are merged; old facts drop out per category |
| `preferences.py` | Settings read once per turn and written into the prompt |
| `auth/authentication.py` | Who the caller is: a JWT in the header, or an API key. No `?token=` login in URLs |
| `auth/permissions.py` | Permission classes: object ownership and tier checks |
| `auth/revocation.py` | "Log out everywhere": tokens issued before `UserProfile.tokens_valid_after` are refused |
| `realtime/consumers.py` | Base class for per-user WebSocket consumers |
| `realtime/channels_middleware.py` | WebSocket login |
| `http/middleware.py` | Custom middleware. Runs in both sync and async mode |
| `http/throttling.py`, `http/pagination.py` | Rate limits by tier; page sizes |
| `http/client_ip.py` | The caller's IP, read through our reverse proxies (`TRUSTED_PROXY_COUNT`) |
| `safety/security.py` | Checks each message *you* send for attacks on the model. A match refuses the whole request before it is saved. It never rewrites your text |
| `safety/provenance.py` | Attacks hidden in what a *tool* read (a web page, an email). Puts `auto` mode on guard for the rest of that turn |
| `safety/net.py` | Outgoing URLs: `validate_url` blocks internal addresses (SSRF). `check_egress` then checks the host against the scope's allow-list |
| `safety/content_policy.py` | Content the platform refuses whoever asks: sexual content involving minors, sexual deepfakes of real people, weapons of mass destruction |
| `safety/moderation.py` | A second check by a small safety model, for image prompts and published pages only. Can only refuse more; fails open |
| `safety/labels.py` | The visible "AI-generated" tag and metadata on generated images |
| `safety/outbound.py` | Checks every message an agent sends: content policy, daily cap, AI disclosure line |
| `admin.py`, `apps.py`, `__init__.py` files | Django admin and app config |
| `management/commands/boot.py` | Prepares the database before the server starts. The image's `CMD` runs it, then starts daphne |
| `management/commands/backup_db.py` | A consistent copy of the database, kept locally and optionally uploaded to S3 |

Teams are described in [`docs/ORG_KNOWLEDGE_PLAN.md`](../docs/ORG_KNOWLEDGE_PLAN.md).
Google and social login use `django-allauth`.

## Rules

- Membership, and so access to a team, is read live on every check. Never cache it.
- The input sanitiser refuses or passes. It never rewrites a message.
- The safety rules for this app are listed in [`docs/SAFETY_AND_GUARDRAILS.md`](../docs/SAFETY_AND_GUARDRAILS.md).

## Tests

`core/tests/`: `test_memory.py`, `test_net.py`, `test_sanitizer.py`,
`test_provenance.py`, `test_content_policy.py`, `test_orgs.py`, `test_hybrid_middleware.py`.
