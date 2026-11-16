# Security review — record (2026-09-25)

## Status

**Implemented (S1–S9, S11, P1–P3, round two N1–N8). S10 is a
owner-side housekeeping step. Built, not deployed.** A whole-project
review — backend, frontend, and the deploy config — not a diff review.
Items in order of severity; every fix named with its tests.

## What it delivered

**Round one**

- **S1 (High) pre-account takeover.** Google sign-in refuses an unverified
  Google email; when it links to an existing account whose email was never
  proven and that still has a password, the password is made unusable and
  every old token is revoked. Email is marked verified on each inbox-proven
  path; lookups are case-insensitive.
- **S2 (Medium) stolen tokens outlive a reset.** `UserProfile.tokens_valid_after`
  + `core/auth/revocation.py`; every JWT door refuses tokens issued before
  the cutoff. Change/reset/email change/S1 linking all revoke.
- **S3 (Medium) `?token=` accepted on every GET** — removed; URLs land in
  logs, history and `Referer`. WebSocket keeps its own `?token=` (browsers
  cannot set WS headers).
- **S4 (dormant) workspace webhook fired every user's triggers** and ran
  agents inside the request; it had never worked (wrong column names,
  swallowed). Now owner-scoped, matched by `job_id`, detached, empty secret
  can never match.
- **S5–S9.** `CORS_ALLOW_ALL_ORIGINS` forced off in deployment; API keys stored as SHA-256
  (listed as `key_prefix`; shown once); OTP via `secrets.randbelow`; PDF
  previews re-typed before framing + `CSP: sandbox` on file responses;
  `openExternal` refuses non-`http(s)` URLs.
- **S11 (Medium) refresh tokens were reusable** — the `token_blacklist`
  app was missing, so `BLACKLIST_AFTER_ROTATION` did nothing. Installed and
  pinned by a test. (`flushexpiredtokens` worth a beat schedule.)

**Round two (same day)**

- **N1 (High) SSRF via `download_file`** following redirects to the cloud
  metadata address; now `fetch_file` re-runs the SSRF guard on every hop.
- **N2 (Medium) zip bombs** — `zip_within_budget` (200 MB uncompressed
  ceiling) checked at every door and in every extractor.
- **N3 (Medium)** MCP OAuth discovery followed redirects past the guard.
- **N4 (Medium) WhatsApp/SMS/Teams webhooks verified nothing** —
  `X-Hub-Signature-256` / Twilio `X-Twilio-Signature`; Teams refused until
  Bot Framework JWT validation exists.
- **N5–N8.** nginx `client_max_body_size`, admin login throttled, SQLite
  `ATTACH`/`PRAGMA` refused, generated media fetched through the guarded
  `fetch_file`.

**Performance wins in the same pass:** P1 API-key touch throttled to 60 s;
P2 workspace webhooks detach; P3 one query collision check at sign-up.

Checked and fine: `SECRET_KEY` outside DEBUG; login throttling; webhook
404s; WS ownership checks; every iframe lacks `allow-same-origin`; stdio
MCP off in prod; sandbox is the sidecar.

## Decisions worth remembering

- **A control is not shipped until it is on a door.** S4 was "done" UI over
  a feature that had never worked.
- **"Never shown once" means never shown.** `key_prefix`, allow digests.
- **Revocation is a property of every door**, not of the login view.

## Open

- **S10** — `my-pem.pem` sits world-readable in the project root: move it
  to `~/.ssh/` and restrict permissions (owner action; not moved
  automatically because scripts may name the path).
- **Not deployed.** Migrations to run on deploy: `core.0012` (hashes API
  keys in place) and the `token_blacklist` app's. Everyone stays signed
  in — no cutoff is set.
- **`WHATSAPP_APP_SECRET` / `TWILIO_AUTH_TOKEN`** must be set before using
  those channels; without them their webhooks refuse everything.
