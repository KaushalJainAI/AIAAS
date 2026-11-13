# Mobile app plan

Status: **changed 2026-11-12 — the app is React Native, not Capacitor.**

## Decision (2026-11-12): a separate React Native app

The user chose a native codebase over wrapping the web frontend. It lives in
`mobile-native/` at the repo root: **Expo SDK 58 + expo-router**, TypeScript,
one codebase for Android and iOS. Built so far (typechecks and bundles for both
platforms, **not yet run on a device**):

- Foundation: `src/api/client.ts` (fetch + bearer token + one refresh through
  `/api/auth/token/refresh/`), `src/api/sse.ts` (POST SSE through `expo/fetch`,
  because React Native's own `fetch` cannot stream a body), tokens in
  `expo-secure-store`, `src/auth/AuthContext.tsx`.
- Four tabs, each a folder under `app/(tabs)/` with its logic in
  `src/features/<tab>/`: **Chat** (sessions, streaming turn, stop/steer,
  approval and question cards, plan, re-attach), **Inbox** (pending approvals
  and questions, notifications), **Agents** (list, run, follow a run, steer,
  cancel), **Settings** (profile name, memory, reminder preferences).
- **Full parity pass (2026-11-13):** every web area now has a screen — Files,
  Apps, Pages, Dashboards, Runs (with Insights), Schedules, Missions,
  Connections, Credentials, full Account/Settings, Knowledge bases and
  extraction, Team knowledge, Explore (install + publish), Skills, Tools,
  Evals, the agent builder (wizard + all sections + history) and Imagine;
  Chat gained attachments, mode/model pickers, slash commands, charts
  (react-native-svg, the web's 8-hue ramp), HTML artifacts, message actions.
  Sign-up, forgot password, Google sign-in and push (Expo) are in the app.
  The rich editors (Docs, Sheets, Slides, PDF, LaTeX, Code, Whiteboard…) open
  the web app's own editor in a signed-in web view (`app/web.tsx`), so they
  behave exactly as on the web.
- **Same look everywhere:** `src/theme.ts` holds the web's own colour tokens,
  `src/fonts.ts` bundles IBM Plex Sans/Mono, `src/components/Text.tsx` maps
  weights to font files (Android ignores `fontWeight` on custom fonts), a root
  navigation theme styles every header and tab bar, and `confirm()` /
  `Switch` are drawn by the app, not the OS. Rules: `mobile-native/DESIGN.md`.
- **Google sign-in and connect without a backend change:** the website's
  callback pages hand the code to `aiaas://` (`better-n8n-frontend/src/lib/
  appHandoff.ts`) — sign-in by an `app.`-marked state, connect when no web flow
  in that browser started it. Needs the website deployed first.
- Not built: voice input and read-aloud (no audio packages), the web's
  "Allow for this chat" approval scope, staff-only model catalogue tools.
- **Needs before release:** `eas init` (push is off without a project id), and
  the backend `DeviceToken` route (uncommitted) kept and deployed.

What changes against the plan below:

- **No CORS change is needed.** CORS is enforced by browsers; a native app's
  requests are not checked against it. Phase 2 step 3 does not apply.
- **The drift rule now applies here.** This is a second UI, the shape BrowserOS
  drifted in. Keep the mobile app to the flows a phone needs, mirror the web
  app's request bodies exactly (each feature module names the web file it
  copied from), and treat a backend change to those routes as a mobile change.
- Phase 3 (sign-in) becomes `expo-auth-session` / `expo-web-browser` with an
  `aiaas://` scheme or App Links; Phase 4 (push) becomes `expo-notifications`
  with the same `DeviceToken` + FCM backend design; Phase 6 uses EAS Build
  (iOS builds without a Mac).
- The first attempt's Capacitor scaffold (`mobile/`, `better-n8n-frontend/.env.mobile`)
  was never committed and was deleted on 2026-11-13.

The Capacitor plan below is kept for the reasoning; its phases 1 (PWA), 4
(backend half) and 6 still apply.

## What we were building, in one paragraph (Capacitor, superseded)

An Android and iOS app that is the **same web frontend** (`better-n8n-frontend/`)
running inside a native shell (Capacitor). It is not a second UI. BrowserOS is
parked because a second UI drifted away from a backend that changes every week,
and this plan exists so the mobile app does not repeat that. The native shell
adds only what a website cannot do well: reliable push notifications, sign-in
that returns to the app, the share sheet, and biometric unlock.

## Why this shape

| Option | Cost | Verdict |
|---|---|---|
| Installable web app (PWA) | ~1 day | Do it anyway (Phase 1). Android push works; iOS push only after "Add to Home Screen". No store listing. |
| **Capacitor wrapper around the existing frontend** | ~2–3 weeks | **Chosen.** One codebase. Native push, deep links, share sheet. |
| React Native / Flutter rewrite | months | No. A second UI to keep in step: the BrowserOS problem. |

Rule for every phase: **a feature is built in the web frontend first.** The
mobile build may only add native plumbing (push, deep links, sharing, storage),
never its own screens.

---

## Phase 0 — the web app stops assuming it is a website (done 2026-11-12)

- `src/lib/origins.ts`: `SITE_ORIGIN` / `siteUrl()` for links that leave the
  app, `API_ORIGIN` for REST, SSE and sockets. Both are same-origin unless a
  build sets `VITE_PUBLIC_SITE_URL` / `VITE_API_ORIGIN`. The web image sets
  neither.
- `src/lib/oauthFlow.ts`: connecting an account tries a popup and falls back to
  a full-page redirect. `/oauth/callback` returns to the page the flow started
  on. Phones were blocking these popups anyway.
- Google sign-in builds its return address from `SITE_ORIGIN`.

What Phase 0 did **not** do: make a sign-in come back to the *app*. In the app,
the provider still returns to the website. Phase 3 fixes that.

---

## Phase 1 — installable web app (~1 day)

Small, useful on its own, and it tests the push path before any native code.

1. Add `public/manifest.webmanifest` (name, icons 192/512 already exist,
   `display: standalone`, theme colour `#0E6170`) and link it in `index.html`.
2. Check the existing service worker (`public/sw.js`) still handles push when
   the app is launched from the home screen.
3. In standalone mode, `oauthFlow.prefersRedirect()` already picks the redirect.
   Check Connections → Google end to end on an Android phone and an iPhone.

Done when: "Install app" appears in Chrome on Android, and an approval request
shows a notification with the app closed.

## Phase 2 — the Capacitor shell (~3 days)

Decided 2026-11-12: **Android first**, and the native project lives in its
**own folder, `mobile/`** at the repo root, not inside `better-n8n-frontend/`.
The frontend gets no Capacitor dependency; `mobile/` is a small npm project
whose `webDir` is `../better-n8n-frontend/dist`. iOS is added to the same
folder later with `npx cap add ios`.

1. `mobile/`: `@capacitor/core`, `@capacitor/android`, `@capacitor/cli`
   (exact versions), `capacitor.config.ts` (app id `com.kaushaljain.aiaas`),
   and `npx cap add android`, which generates `mobile/android/` from
   Capacitor's template. No hand-written native code.
2. **Mobile build settings.** `better-n8n-frontend/.env.mobile` (committed,
   with a `!.env.mobile` exception in `.gitignore`) holds only the two public
   addresses (`VITE_PUBLIC_SITE_URL`, `VITE_API_ORIGIN`). `mobile/`'s
   `npm run build` runs `vite build --mode mobile` in the frontend, then
   `cap sync android`. These are public URLs, not secrets. The web `build`
   script stays untouched, so the web image still sets nothing.
3. **Backend: let the app's origin in.** The app's page origin is
   `capacitor://localhost` (iOS) and `https://localhost` (Android).
   - Add both to `CORS_ALLOWED_ORIGINS` in production.
   - **First, decouple `credentials/oauth.py::ALLOWED_REDIRECT_ORIGINS` from
     `CORS_ALLOWED_ORIGINS`.** Today the redirect allow-list *extends itself
     with every CORS origin*, so adding the app's origins would also let an
     OAuth code be sent to `https://localhost`. Give it its own setting
     (`OAUTH_REDIRECT_ORIGINS`) and a test that a CORS-only origin is refused.
   - WebSockets: `asgi.py` does not check `Origin` today (it authenticates by
     token), so no change. Re-check this if an origin validator is ever added.
   - SSE and REST send `Authorization: Bearer`, not cookies, so CORS
     preflight is the only change needed.
4. **Token storage.** Tokens live in `localStorage`. iOS can clear web view
   storage under storage pressure. Move them behind a small `tokenStore`
   interface in `api/client.ts` that uses `@capacitor/preferences` in the app
   and `localStorage` on the web. Keep the interface synchronous-looking with a
   cache, because the axios interceptor reads the token on every request.
5. Status bar, splash screen, Android back button (→ `navigate(-1)`, or exit on
   the home route). Safe-area insets are already handled (`viewport-fit=cover`,
   `env(safe-area-inset-bottom)` in `App.tsx`).

Done when: the app installs on a test phone, signs in with email and password,
streams a chat answer, and shows the Inbox updating live.

## Phase 3 — sign-in that comes back to the app (~4 days)

Google forbids sign-in inside embedded web views, so the provider page must open
in the **system browser** (Custom Tabs on Android, `ASWebAuthenticationSession`
via `@capacitor/browser` on iOS) and come back through a link the app owns.

1. **App Links / Universal Links** for the public site: serve
   `/.well-known/assetlinks.json` (Android) and
   `/.well-known/apple-app-site-association` (iOS) from the frontend's nginx,
   claiming only `/auth/google/callback` and `/oauth/callback`. Then a redirect
   to `https://<site>/oauth/callback?...` opens the app instead of the browser,
   when the app is installed.
2. In the app, `startOAuth` gets a third mode, **`external`**: open the
   provider URL with `@capacitor/browser`, store the pending flow as today, and
   wait for `App.addListener('appUrlOpen')`. On the link, close the browser and
   route to the same `/oauth/callback` page in the app, which already runs the
   exchange and returns to `returnTo`. `/auth/google/callback` works the same
   way for login.
3. **No backend change for the exchange.** The return address stays the https
   site URL, which Google and the backend already accept, so the code exchange
   (`/api/auth/google/`, `/api/credentials/oauth/google/complete/`, MCP
   `oauth/callback`) is unchanged.
4. If the app is not installed, the same link opens the website, which already
   finishes the flow (Phase 0). Nothing breaks.
5. ChatGPT plan sign-in stays out: it exists only on self-hosted installs.

Done when: Connections → Gmail and "Continue with Google" both finish inside the
app on Android and iOS, with no browser tab left behind.

## Phase 4 — native push (~4 days)

This is the main reason to have an app. An agent waiting on an approval is only
useful if the person sees the request.

1. **Backend: one more channel behind the same door.** Every notification today
   goes through `notifications/webpush.py::send_web_push` (called from
   reminders, scheduled reminders, workspace jobs and e-sign). Keep that one
   door. Add:
   - a `DeviceToken` model (`user`, `platform` android|ios, `token` unique,
     `app_version`, timestamps), and
     `POST/DELETE /api/notifications/push/devices/` to register and remove one.
   - `notifications/fcm.py`, sending through **Firebase Cloud Messaging HTTP
     v1** (one API for both platforms; iOS goes through FCM with an APNs key
     uploaded to Firebase). Service-account JSON in a settings var, off when
     blank, like VAPID.
   - `send_web_push` fans out to both channels (rename it `send_push` once the
     callers are moved). Drop a token when FCM answers "unregistered".
   - Update `Backend/docs/API.md` and `NOTIFICATION_SERVICE.md` in the same
     change.
2. **App:** `@capacitor/push-notifications`. Ask permission **after** sign-in
   and only when the user first turns on notifications in Settings, never on
   first launch. Register the token, and send it again on every app start
   (tokens rotate).
3. **Tapping a notification** opens its `action_url`, checked against the same
   allow-list `NotificationsTab` already uses, never a raw stored URL.
4. `useWebPush` must not try Web Push inside the app (no service worker there);
   it reports "use the app's notification setting" instead.

Done when: with the app closed, an agent pausing for approval shows a
notification within seconds, and tapping it opens that request in the Inbox.

## Phase 5 — phone features worth having (~3 days, pick per value)

- **Share into the app** (Android intent filter / iOS share extension): a PDF or
  a link shared from another app opens a new chat with it attached. The share
  extension on iOS is native code; start with Android.
- **Biometric unlock** (`@capacitor-community` biometric plugin, or the
  current maintained equivalent): ask on app resume after N minutes, gating the
  stored refresh token. Off by default.
- **Haptics** on approve / reject.
- Not now: home-screen widgets, Siri / Assistant shortcuts, offline chat. Each
  is native code per platform.

## Phase 6 — stores and release (~1 week, much of it waiting)

1. Accounts: Google Play (one-time fee), Apple Developer (yearly fee). Signing
   keys stored outside the repo.
2. Store listing: icons, screenshots, privacy policy (exists at `/privacy`),
   data-safety form. The data-safety answers must match
   `SAFETY_AND_GUARDRAILS.md` (what is stored, retention, AI disclosure).
3. Apple review: a plain website wrapper is often rejected (guideline 4.2).
   Native push, the share extension and biometric unlock are what make this
   more than a wrapper, so ship Phase 4 before submitting to Apple.
4. In-app purchases: none planned. If paid tiers are ever sold in the app,
   store billing rules apply; do not add a payment link without checking them.
5. Release flow: Android internal testing track and iOS TestFlight first.

## Keeping it from drifting (the BrowserOS lesson)

- One codebase: `better-n8n-frontend/`. The native projects (`android/`,
  `ios/`) hold only config and plugins.
- **API compatibility.** A store app cannot be updated instantly, so old app
  versions call the live backend for weeks. Send the app version in a header
  (`X-App-Version`); when a route's shape must change, keep the old shape until
  no supported version uses it, the way `/api/nodes/models/` survives for
  BrowserOS. Add a minimum-supported-version check that shows "please update"
  rather than failing.
- **Live updates.** Web-code-only changes can ship without store review through
  a Capacitor live-update service. Decide at Phase 6; it changes the release
  process, and store rules allow it only for web code, not native changes.
- CI: add `npm run build:mobile` to CI so a change that breaks the mobile build
  fails the PR, even before the app is in a store.

## Open questions for the user

1. App name and bundle id (`com.kaushaljain.aiaas`?).
2. ~~iOS from the start, or Android first?~~ **Android first** (decided
   2026-11-12).
3. Firebase for push is the simplest route for both platforms. Is a Google
   (Firebase) dependency acceptable?
4. Live updates: worth adding, or ship every change through the stores?

## Estimate

| Phase | Work |
|---|---|
| 0. Web app stops assuming it is a website | done |
| 1. Installable web app | ~1 day |
| 2. Capacitor shell + backend origins | ~3 days |
| 3. Sign-in back to the app | ~4 days |
| 4. Native push | ~4 days |
| 5. Share, biometrics, haptics | ~3 days |
| 6. Stores and release | ~1 week, much of it review time |

About **3 weeks of work** to a store-ready Android app, plus review time; iOS
adds the share extension and Apple review.
