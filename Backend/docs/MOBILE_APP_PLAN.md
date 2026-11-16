# Mobile app — record

## Status

**Changed 2026-11-12: the app is React Native, not Capacitor.** Lives in
`mobile-native/` at the repo root — **Expo SDK 58 + expo-router**,
TypeScript, one codebase for Android and iOS. Built and bundling for both
platforms, **not yet run on a device.**

The old Capacitor plan is superseded; its phases 1 (PWA), 4 (backend half)
and 6 (store release) still apply. The React Native build was done in its
place over 2026-11-12/13.

## What it delivered

- **Foundation** — `src/api/client.ts` (fetch + bearer token + one refresh
  via `/api/auth/token/refresh/`), `src/api/sse.ts` (POST SSE via
  `expo/fetch`; RN's own `fetch` cannot stream a body), tokens in
  `expo-secure-store`, `src/auth/AuthContext.tsx`.
- **Four tabs** — Chat (sessions, streaming turn, stop/steer, approval and
  question cards, plan, re-attach), Inbox (pending approvals and questions,
  notifications), Agents (list, run, follow, steer, cancel), Settings
  (profile, memory, reminder preferences).
- **Full parity pass (2026-11-13)** — every web area has a screen: Files,
  Apps, Pages, Dashboards, Runs (with Insights), Schedules, Missions,
  Connections, Credentials, full Account/Settings, Knowledge bases +
  extraction, Team knowledge, Explore (install + publish), Skills, Tools,
  Evals, the agent builder (wizard + all sections + history), Imagine,
  Chat attachments, mode/model pickers, slash commands, charts, HTML
  artifacts, message actions. Sign-up, forgot password, Google sign-in and
  push (Expo) are in the app. The rich editors open the web app's own
  editor in a signed-in web view (`app/web.tsx`), so they behave exactly
  as on the web.
- **Same look everywhere** — `src/theme.ts` holds the web's colour tokens;
  IBM Plex Sans/Mono bundled; a root navigation theme styles every header
  and tab bar; rules in `mobile-native/DESIGN.md`.
- **Google sign-in and connect without a backend change** — the website's
  callback pages hand the code to `aiaas://` (`better-n8n-frontend/src/lib/
  appHandoff.ts`). Needs the website deployed first.

## Decisions worth remembering

- **Not a wrapper, not a rewrite** — a separate UI means drift; the app is
  kept to the flows a phone needs and mirrors the web's request bodies
  exactly (each feature module names the web file it copied from). A
  backend change to those routes is a mobile change.
- **Phase 0 (the web app stops assuming it is a website) is done** —
  `src/lib/origins.ts` (`SITE_ORIGIN` / `API_ORIGIN`), OAuth popup →
  redirect fallback, and Google sign-in building its return address from
  `SITE_ORIGIN`.
- **Android first** (decided 2026-11-12). Google sign-in and push are
  already in the app.
- **The first Capacitor attempt was never committed** and was deleted
  2026-11-13.
- **Store reality:** a store app cannot be updated instantly — old versions
  call the live backend for weeks. Send the app version in a header; keep
  old route shapes until no supported version uses them; show "please
  update" rather than failing.

## Open

- **Not yet run on a device** — verification, not correctness, is the gap.
- **Voice input and read-aloud** — not built (no audio packages).
- **The "Allow for this chat" approval scope** — not built; **staff-only
  model catalogue tools** — not built.
- **`eas init`** — push is off without a project id.
- **Backend `DeviceToken` route** (uncommitted) — kept and deployed for
  native push; Expo push is the chosen path (no FCM/APNs credentials on our
  side).
- **Google connect needs the website deployed first** — the callback hands
  to `aiaas://` from the deployed pages.
- **App name and bundle id** — undecided (`com.kaushaljain.aiaas`?).
- **Live updates** — decide at release time (web-code-only changes without
  store review, if store rules allow).
- **Estimate:** ~3 weeks to a store-ready Android app plus review time;
  iOS adds the share extension and Apple review.
