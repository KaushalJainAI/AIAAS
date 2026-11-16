# Google sign-in: prove the email before you trust it

## What happened

We added "Sign in with Google" next to the app's own email and password login. Two
things were each reasonable on their own:

- Sign-up created an account for any email address and never checked that the
  person owned it.
- Google sign-in looked up "the account with this email" and logged the user into it.

Put together, a stranger could register a victim's address with a password they
chose. When the real owner later signed in with Google, they were logged into the
stranger's account. The full story is in file 15 (pre-account takeover).

The sign-in itself is an OAuth authorization-code flow, run by the server:

1. The browser gets a one-time `code` from Google.
2. The frontend posts the code to `POST /api/auth/google/`.
3. The backend exchanges the code for a Google access token, then asks Google for
   the user's profile.
4. The backend issues the app's own JWT pair and returns it in the JSON body.

## The fix

The backend now refuses to link by email unless Google says the address is verified:

- `GoogleLoginView` (`Backend/core/views.py`) rejects any profile where
  `email_verified` is not `true`.
- It finds the user by email, case-insensitively, or creates one with
  `create_user` and no password. A Django user created without a password cannot
  log in with a password.
- `_claim_verified_email` records `UserProfile.email_verified_at`. If the account
  had a password and its email had never been proven, that password is made
  unusable and every older token is revoked (`Backend/core/auth/revocation.py`).
- Tokens are issued with `rest_framework_simplejwt`.

One gap is still open. The original plan was HttpOnly cookies, so JavaScript could
not read the tokens. The code does not do that. Tokens come back in the response
body, and the web client keeps them in `localStorage`
(`better-n8n-frontend/src/api/client.ts`). That makes XSS prevention the main
protection for the tokens. Decide whether to move them to cookies. Listed in
`Backend/docs/OPEN_WORK.md`.

## The lesson

- **Linking accounts by email is safe only when both sides proved the email.**
  Check `email_verified` on the Google side and record proof on the local side.
- **A token is proof of one thing.** Google's token says who the user is, for the
  scopes asked. It does not say the app may trust anything else.
- **Exchange the code on the server.** The browser never handles Google's access
  token, and the client secret stays on the backend.
- **A signed JWT is readable, not secret.** Anyone can decode the payload. Keep
  secrets out of it, and keep it short-lived.
- **A stateless token stays valid until it expires.** To end sessions early you
  need a server-side cutoff. See file 15 for `tokens_valid_after`.

## Code

- `Backend/core/views.py`: `GoogleLoginView`, `_claim_verified_email`
- `Backend/credentials/oauth.py`: `GoogleOAuthProvider` (`exchange_code`, `get_user_info`)
- `Backend/core/auth/revocation.py`: token cutoff
- `Backend/workflow_backend/settings/base.py`: JWT and Google OAuth settings
- `better-n8n-frontend/src/api/client.ts`: token storage and refresh
