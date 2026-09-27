# Google OAuth + JWT Authentication

> Source: `Backend/core/auth_views.py`, `Backend/workflow_backend/settings.py`
> Commit: `e5191fa` — feat(auth): integrate allauth for social authentication

---

## The Full Flow (Interview Answer)

```
Browser → "Sign in with Google" → Google issues id_token (JWT signed by Google)
→ Frontend sends that token to your backend (POST /auth/google/)
→ Backend verifies signature against Google's public certs
→ Backend issues its own JWT (access + refresh)
→ Browser stores tokens in HttpOnly cookies
```

---

## id_token vs access_token

| Token | Issued by | Contains | Used for |
|-------|-----------|----------|----------|
| `id_token` | Google | User identity (email, name, sub) | Proving who the user is |
| `access_token` | Google | Scopes (e.g., drive.readonly) | Calling Google APIs on user's behalf |
| Your `access_token` | Your backend | User ID, roles | Authenticating subsequent API calls |

You only need the `id_token` from Google for login — you don't need to call any Google API on their behalf initially.

---

## How Verification Works

```python
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

idinfo = id_token.verify_oauth2_token(
    token,
    google_requests.Request(),  # fetches Google's public certs
    client_id                   # must match aud claim in the token
)
```

`verify_oauth2_token` does three things internally:
1. Downloads Google's JSON Web Key Set (JWKS) — the public keys
2. Verifies the token signature with those keys
3. Validates `aud` (audience) == your client_id and `exp` (expiry)

**Why you must validate `aud`:** Without it, a token minted for another app's client_id would be accepted by your server.

---

## get_or_create Pattern for Social Login

```python
user, created = User.objects.get_or_create(
    email=email,
    defaults={
        'username': email.split('@')[0],
        'first_name': first_name,
        'last_name': last_name,
    }
)
if created:
    user.set_unusable_password()  # social-only users have no password
    user.save()
```

`defaults` only applies on CREATE, not on GET. So existing users are never overwritten with stale Google profile data.

`set_unusable_password()` sets the password hash to `!` — Django's `check_password()` always returns False for it. This prevents brute-force attacks on social-only accounts.

---

## HttpOnly Cookies vs localStorage

```python
response.set_cookie(
    key='access_token',
    value=str(access),
    httponly=True,      # JS cannot read this — XSS proof
    secure=not DEBUG,   # HTTPS only in production
    samesite='Lax',     # CSRF protection (blocks cross-origin POSTs)
    max_age=3600
)
```

**Interview Q: Why HttpOnly?**
JavaScript (including injected malicious scripts) cannot read HttpOnly cookies. If you store JWTs in `localStorage`, any XSS attack can steal them. HttpOnly cookies mitigate this entirely.

**Interview Q: What does SameSite=Lax do?**
It prevents cookies from being sent on cross-origin POST/PUT/DELETE requests (triggered by other sites). Allows GET navigations (e.g., clicking a link). `Strict` would break OAuth redirects. `None` (requires Secure) sends on all cross-origin requests — avoid it.

---

## JWT Structure (Refresher)

```
header.payload.signature
```

- Header: `{"alg": "RS256", "typ": "JWT"}`
- Payload: `{"sub": "12345", "email": "user@example.com", "exp": 1234567890}`
- Signature: `HMAC(base64(header) + "." + base64(payload), secret)`

JWTs are **signed, not encrypted**. Anyone can decode the payload (base64), but only the server with the secret can generate a valid signature.

---

## Key Interview Questions

**Q: How do you prevent token replay attacks?**
Short `exp` (1 hour for access, 7 days for refresh) + refresh token rotation. When a refresh token is used, issue a new one and invalidate the old one.

**Q: Where do you store tokens on the frontend?**
HttpOnly cookies for security. Never localStorage for auth tokens.

**Q: What's the difference between allauth and manual id_token verification?**
Allauth handles the full OAuth2 redirect dance (state, PKCE, code exchange). Manual verification (like in this codebase) is for "one-tap" Google Sign-In where the frontend gets an `id_token` directly from the Google JS SDK — simpler, no redirect needed.
