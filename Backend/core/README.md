# `core/`: users, login, and the request pipeline

Everything about **who is calling** and the plumbing every request passes
through.

## Data (`models.py`)

| Model | What it is |
|---|---|
| `UserProfile` | Per-user settings and account state: tier, credits, default model and effort, default autonomy, `paused_until` ("pause everything") |
| `UserMemory` | Facts the assistant remembers about you across chats (`memory.py`). Viewed and deleted in Settings → Memory, or with `/memory` in chat |
| `APIKey` | Keys for calling the API without a browser login |
| `UsageTracking` | Usage counters |
| `PasswordOTP` | One-time codes for password reset |
| `Organization` | A team. Holds its name, whether new chats share with it by default, `capture_mode` (`suggest` or `auto`) and `review_policy` (`open` or `curated`) |
| `Membership` | One person in one team, with a role: `owner`, `admin`, `curator` or `member` |
| `OrgInvite` | An offer to join a team. Nobody is a member until they accept it |

## Files

| File | What it does |
|---|---|
| `views.py`, `urls.py`, `serializers.py` | Sign up, log in, profile, API keys, memory, usage (`/api/auth/...`, `/api/memory/`, `/api/usage/`) |
| `memory.py` | Reading and writing `UserMemory`. Keeps it small: repeats are merged, old facts are dropped per category |
| `preferences.py` | Your settings, read once per turn and written into the prompt |
| `auth/` | How a request is identified: a JWT in the header, or an API key. There is no `?token=` login in URLs any more, because a token in a URL ends up in logs. Also the permission classes |
| `auth/revocation.py` | Logging out everywhere. Changing your password or email sets `UserProfile.tokens_valid_after`, and any token issued before that is refused (REST, token refresh and WebSockets alike) |
| `orgs.py` | Teams: who is in them and in what role, and the invitation rules (invite, accept, decline, withdraw). Membership is read live on every check, never cached |
| `org_views.py` | `/api/orgs/`: teams, members, invitations |
| `http/middleware.py` | Custom middleware (runs in both sync and async mode) |
| `http/throttling.py` | Rate limits by account tier |
| `http/pagination.py` | Page sizes for list endpoints |
| `realtime/` | WebSocket login (`channels_middleware.py`) and a base class for per-user sockets |
| `safety/net.py` | Checks outgoing URLs: blocks internal addresses (SSRF), applies per-agent allow-lists |
| `safety/security.py` | Checks each message *you* send for attacks on the model ("ignore your instructions..."). A match refuses the whole request before it is saved; anything else passes through unchanged. It never rewrites your text |
| `safety/provenance.py` | Defends against attacks hidden in what a *tool* read (a web page, an email). If a result looks like an instruction, `auto` mode asks before anything irreversible for the rest of that turn |
| `safety/content_policy.py` | Content the platform refuses to make, whoever asks: sexual content involving minors, sexual deepfakes of real people, and weapons of mass destruction. Checked on messages, image prompts, outbound messages and published pages |
| `safety/moderation.py` | A second check by a small safety model, after the word patterns pass, for image prompts and published pages only. It uses our own three categories, can only refuse more, and lets things through if the model is down |
| `safety/labels.py` | Puts a visible "AI-generated" tag and AI metadata on every generated image |
| `safety/outbound.py` | One check for every message an agent sends: the content policy, a daily limit per account, and an "AI assistant" line on messages nobody reviewed |

Google / social login uses `django-allauth`.

## Teams, roles and invitations

A team (`Organization`) is the group a person shares solved problems and team
knowledge bases with. Nothing else about a team is configured here.

| Role | What it can do |
|---|---|
| `owner` | Everything an admin can, plus make or remove owners, and delete the team. The last owner cannot leave |
| `admin` | Invite and remove people, change roles and team settings |
| `curator` | Approve, edit and withdraw the team's solutions. Cannot manage people |
| `member` | Read the team's solutions, add their own, and share their own knowledge bases with the team |

Two team settings sit on the `Organization` row. `capture_mode` decides what a
fix found in chat becomes: `suggest` saves a draft for its author, `auto` saves
it straight away. `review_policy` decides a share: `open` shares at once,
`curated` waits for a curator.

**Invitations.** An owner or admin invites an email address. The invite adds
nobody. The invitee accepts or declines from their own account. The rules:

- **Consent.** Only an accepted invitation makes someone a member.
- **Verified email.** Accepting needs a verified email, held in
  `UserProfile.email_verified_at`. Google sign-in, a password reset and an
  email change set it. Signing up alone does not. Declining needs no
  verification.
- **No account lookup.** The answer to an invite is the same for a registered
  and an unregistered address. Only a manager is told that a person is already
  a member.
- **Expiry.** An invitation is open for 14 days. A withdrawn one is recorded
  as declined, so there is one "closed" state.
- **Notice.** A registered address also gets a notification, with a link to
  the team's page.

## Tests

`core/tests/`: `test_memory.py`, `test_net.py`, `test_hybrid_middleware.py`,
`test_sanitizer.py`, `test_provenance.py`, `test_orgs.py` (teams, roles, invitations).
