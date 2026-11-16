# AIAAS mobile

The Android and iOS app for AIAAS, built with Expo (SDK 58) and expo-router. It
talks to the same backend as the web app. Native apps are not subject to browser
CORS, so the backend needs no origin change.

Most features are native screens. The rich editors (Docs, Sheets, Slides, PDF and
others) open the web app's own editor in a signed-in web view (`app/web.tsx`).

**Status:** the app has not been run on a real phone yet. [PARITY.md](PARITY.md)
lists what is not built and where it differs from the web app.

## Run it

```bash
cd mobile-native
npm install
npx expo start             # scan the QR code with Expo Go, on a phone on the same Wi-Fi
npx expo run:android       # development build; needs Android Studio and an SDK
npx expo run:ios           # needs a Mac. Without one, build in the cloud: npx eas-cli@latest build --platform ios
```

To point a dev build at a local backend, set the origin before starting:

```bash
EXPO_PUBLIC_API_ORIGIN=http://192.168.1.20:8000 npx expo start
```

The default origin is in `src/config.ts`.

## Checks

Run both before you call a change done:

```bash
npx tsc --noEmit           # typecheck (same as npm run typecheck)
npm run lint               # expo lint
```

## Layout

- `app/`: the routes (expo-router). `_layout.tsx` holds the providers and the
  sign-in gate. `app/(tabs)/` has the five tabs: **Chat**, **Activity** (folder
  `inbox/`), **Agents**, **Files** and **More**. Settings is reached from More;
  its route exists but is hidden from the tab bar.
- `src/features/`: one folder per feature (`chat`, `agents`, `runs`, `files`, ...).
- `src/components/`: the shared parts every screen uses (`Screen`, `Section`,
  `ListRow`, `Card`, `Text`, `Markdown`, `Sheet`, ...).
- `src/api/`: `client.ts` (JSON requests, refresh on 401), `sse.ts` (the chat
  stream reader), `auth.ts`, `tokens.ts` (secure token store).
- `src/auth/`, `src/notifications/`, `src/hooks/`, `src/lib/`.
- `src/theme.ts` (the web app's colours), `src/fonts.ts` (IBM Plex, bundled),
  `src/config.ts` (the API origin).

## Read before you change

- [DESIGN.md](DESIGN.md): the rules that keep every screen the same on Android and
  iOS, and close to the web app. For example, import `Text` from
  `src/components/Text`, never from `react-native`.
- [PARITY.md](PARITY.md): every place this app differs from the web app, and what
  is still to build.
- [AGENTS.md](AGENTS.md): rules for working in this Expo project. Read it before you
  use any Expo API, because Expo changes between SDK releases.
