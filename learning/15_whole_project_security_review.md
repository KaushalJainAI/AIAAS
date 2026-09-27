# 15 — A Whole-Project Security Review: What a Diff Review Can't See

> Source: `core/views.py`, `core/auth/revocation.py`, `core/auth/authentication.py`,
> `core/models.py`, `workspaces/views.py`, `agents/scheduler.py`, `inference/utils.py`,
> `docker-compose.prod.yml`, frontend `lib/safeUrl.ts`, `hooks/useBlobUrl.ts`
> Found and fixed: 2026-09-25 · Plan: `Backend/docs/SECURITY_REVIEW_FIX_PLAN.md`

---

## The Setup

A first security review looked only at the pending diff and found nothing. A
second pass read the **whole system** — settings, deploy config, every route that
needs no login, token handling, file serving — and found eleven problems. None of
them were in the diff. They were in how old pieces fit together.

That is the lesson in one line: **most security bugs are interactions, not lines.**
A diff review asks "is this change safe?" A system review asks "what can a
stranger do end to end?"

---

## Finding 1 — Pre-account takeover (High)

Two pieces, each reasonable alone:

1. **Signup** creates an account with any email, and never checks you own it.
2. **Google sign-in** looks up "the account with this email" and logs you in.

Together: an attacker registers `victim@gmail.com` with a password they know.
Weeks later the victim clicks "Sign in with Google". Google proves the victim owns
the address, the backend finds the attacker's account, and logs the victim *into
it*. The victim connects their Gmail, uploads files — and the attacker, who still
has the password, sees all of it.

**Fix.** Track *proof* of the inbox: `UserProfile.email_verified_at`, set only by
things that actually reached the inbox (Google login, password reset OTP, email
change OTP). When Google links to an account whose email was never proven and that
has a password, the password is made unusable and every old session is ended. Also:
refuse a Google email where `email_verified` is not `true`.

```python
if profile.email_verified_at is None and user.has_usable_password():
    user.set_unusable_password()   # whoever set it is locked out
    revoke(user)                   # and their sessions end
```

**Interview framing:** "Linking accounts by email is only safe when *both* sides
have proven the email."

---

## Finding 2 — A password reset didn't sign anyone out (Medium)

JWTs are stateless: the server checks the signature and the expiry, nothing else.
With a 24 h access token and a 30-day refresh token, a stolen token kept working
after the owner reset their password — the one moment they are trying to lock
someone out.

**Fix: one timestamp per user.** `tokens_valid_after`. Every token carries `iat`
(issued at). A token with `iat` older than the cutoff is refused. Checked at all
three doors: REST auth, the refresh endpoint (or a revoked refresh token just mints
new access tokens), and the WebSocket handshake.

Why not a blacklist of token ids? Because nobody ever asks to revoke *one* token.
They ask "sign out everywhere". One column answers that.

Two details that matter:
- **Compare strictly-older, in whole seconds.** `iat` is whole seconds. The fresh
  pair handed back in the same second as the revocation must still work.
- **Cache it, but fail closed.** The cutoff is read on every request, so it's cached.
  The row is written first, then the cache. A cache failure reads the row. The cache
  can make a check slower; it can never let a revoked token through.

---

## Finding 3 — A setting that silently did nothing (S11)

```python
'ROTATE_REFRESH_TOKENS': True,
'BLACKLIST_AFTER_ROTATION': True,   # "a stolen refresh token is single-use"
```

The comment was false. Blacklisting needs the `token_blacklist` app installed.
Without it, simplejwt catches the `AttributeError` and carries on. A "used" refresh
token worked again, for 30 days.

**Lesson:** a config flag is a claim. Test the *behaviour*, not the flag: use a
refresh token twice and assert the second call is 401.

---

## Finding 4 — Tokens in URLs (Medium)

A global auth class accepted `?token=` on every GET. URLs end up in server logs,
browser history and the `Referer` header sent to other sites. The web app never
used it — it fetches files with the header and turns them into `blob:` URLs. So it
was pure risk. Deleted. (WebSockets still use `?token=`, because browsers can't set
headers on a WebSocket. That is a separate, narrower door.)

---

## Finding 5 — A webhook that woke everyone's agents (dormant)

The workspace job webhook looped over **every** `job.finished` trigger in the
database, not just the workspace owner's. A trigger with no job filter matched
every job. So anyone with their own workspace secret could start other users'
agents, spending their money.

Two more bugs hid behind it:
- The query named columns that don't exist (`event`, `filter` — they live inside
  `config`). It raised `FieldError` on every call, and `except Exception: pass`
  swallowed it. The feature never worked, and nobody could tell.
- It ran each agent **to completion inside the HTTP request**.

**Fix:** filter by owner and by job id, and start runs detached through the same
`launch()` the scheduler uses, so an event can't skip the gating a schedule gets.

**Lesson (again, see file 14):** a bare `except: pass` turns a bug into silence.

---

## Findings 6–10 — Smaller ones

| Problem | Fix | Why it matters |
|---|---|---|
| `CORS_ALLOW_ALL_ORIGINS=True` in prod, with credentials | Removed; allow-list only | Harmless only until some route reads a cookie |
| API keys stored in plain text, **and** returned by the list endpoint every time | Store SHA-256; plaintext shown once | A DB leak shouldn't be a key leak |
| OTP from `random.randint` | `secrets.randbelow` | Mersenne Twister is predictable |
| PDF preview frames a `blob:` URL (runs as our origin) | Re-type the blob to `application/pdf`; `CSP: sandbox` on file responses | Never let an HTML body render with our origin |
| Link cards `window.open` any model-supplied URL | Only `http:`/`https:` | `javascript:` and `data:` URLs run script |

**Why a fast, unsalted hash is right for API keys:** salts and slow hashes
(bcrypt) protect *low-entropy* secrets like passwords. An API key is 48 random
bytes — nobody can brute-force it. A plain SHA-256 keeps the lookup a single
indexed equality.

---

## Performance found on the same pass

- API-key auth wrote `last_used_at` on **every** request. On SQLite that's a write
  lock per call. Now written at most once a minute. (A timestamp for humans doesn't
  need millisecond freshness.)
- The webhook ran agents synchronously (above).
- Google sign-up picked a username with one query per collision; now one query.

The bigger "lag with several runs" work lives in file 13 and
`CONCURRENCY_LAG_FIX_PLAN.md`.

---

## Round Two — Following Every Request Out

A second pass asked one question of every place the server *fetches* something
or *receives* something: "what if the other side lies?"

### SSRF through a redirect (High)

`download_file` checked the URL, then called `requests.get(url)`. `requests`
follows redirects by default and does not re-check them. So:

```
agent reads a web page → page says "download https://evil.example/report.pdf"
evil.example answers 302 → http://169.254.169.254/latest/meta-data/iam/...
requests follows it → the EC2 metadata (maybe cloud credentials) is saved as a file
```

**The rule:** an SSRF check must run on *every hop*, not the first URL. The fix
reuses a redirect handler that re-runs the guard each time
(`core/safety/net.py::fetch_file`). The same bug existed in MCP OAuth discovery
(`follow_redirects=True`) and the image downloaders.

**Interview line:** "Validating the URL you were given is validating the wrong
thing. Validate the one you actually connect to."

### Zip bombs (Medium)

`.docx`, `.xlsx` and `.pptx` are zip files. The code did
`zipfile.ZipFile(f).read('word/document.xml')` — which inflates the whole part.
A 1 MB upload can declare 1 GB of zeros. On a 913 MB server, one upload kills the
backend.

**Fix:** read the zip's index first (cheap) and add up `file_size` of every
entry. Over 200 MB, refuse — before anything is inflated. Check at every door
where bytes enter (uploads, downloads, attachments), so every later reader is safe.

### Webhooks that trusted the URL (Medium)

Slack and Telegram were signature-checked. WhatsApp, SMS and Teams were not —
only the secret in the URL. The URL is shared with the provider, logged, and
sometimes pasted into chats. Each provider signs its requests (Meta:
`X-Hub-Signature-256`; Twilio: `X-Twilio-Signature` over the URL + sorted form
fields), so the fix is to check the signature and **fail closed** when the secret
isn't configured. Teams needs full JWT validation, so it is refused until that
exists — refusing is better than accepting unverified messages that agents read.

### A default that was both a bug and a guard (N5)

nginx's default `client_max_body_size` is **1 MB**. Nobody set it. So every
upload over 1 MB got a `413` in production — a bug. But it also accidentally
protected Django, which was configured to hold **100 MB** request bodies in
memory. Fixing the bug (raise nginx to 55 MB) meant fixing the guard it had
been hiding (lower Django to 20 MB). **Lesson:** when you remove an accidental
limit, find out what it was protecting.

### Small ones

- **Django admin** had no login throttle; DRF throttles don't apply to it.
- **SQLite `PRAGMA`** slipped past a keyword scan because the SQL parser labels
  it a *name*, not a keyword. Test the parser's view, not your assumption.

---

## Interview Questions

1. *What is a pre-account takeover and how do you prevent it?*
   → Attacker registers the victim's email before the victim does; a later social
   login links into the attacker's account. Prevent by verifying email before an
   account is usable, or by evicting unverified credentials when the real owner
   proves the inbox.

2. *JWTs are stateless. How do you "log out everywhere"?*
   → A per-user `tokens_valid_after` compared against the token's `iat`, checked at
   every door (API, refresh, WebSocket). Cheaper than a per-token blacklist when the
   only revocation is "all".

3. *Why is putting a token in a query string risky?*
   → URLs are logged, stored in history and leaked through `Referer`.

4. *Should API keys be hashed with bcrypt?*
   → No need: they're high-entropy random. SHA-256 is enough and keeps lookup O(1).
   Passwords are different.

5. *Why did your diff review miss all of these?*
   → Each bug is an interaction between old pieces (signup + Google login; a comment
   + a missing app; a global auth class + URLs in logs). You only see it by tracing
   what a stranger can do across the whole system.

6. *You validate a URL before fetching it. How can SSRF still happen?*
   → Redirects (validate every hop) and DNS rebinding (the name resolves
   differently at connect time; pin the IP to fully close it).

7. *What is a zip bomb and how do you defend against one?*
   → A small archive that inflates hugely. Read the central directory and cap the
   total declared uncompressed size before extracting anything.

8. *Is a secret in a webhook URL enough authentication?*
   → No — URLs leak through logs and sharing. Verify the provider's HMAC signature
   and fail closed if the signing secret isn't configured.
