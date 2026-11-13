# AIAAS mobile

The native Android and iOS app for AIAAS, built with Expo and expo-router.
This is the foundation: sign-in, a secure session, the API client, the chat
stream reader, and four tab placeholders (Chat, Inbox, Agents, Settings).
Feature screens are built on top of it.

The app talks to the same backend as the web app (`https://aiaas.kaushaljain.com/api`).
Native apps are not subject to browser CORS, so the backend needs no origin change.

## Run it

```bash
npm install
npx expo start          # scan the QR code with Expo Go on a phone on the same Wi-Fi
npx expo run:android    # builds a development build; needs Android Studio and an SDK
npm run typecheck       # tsc --noEmit
```

iOS builds need a Mac (`npx expo run:ios`). Without a Mac, build in the cloud
with EAS: `npx eas-cli@latest build --platform ios`.

To point a dev build at a local backend, set the origin before starting:

```bash
EXPO_PUBLIC_API_ORIGIN=http://192.168.1.20:8000 npx expo start
```

## Layout

- `app/` - routes (expo-router). `_layout.tsx` holds the providers and the sign-in gate.
- `app/(tabs)/` - the bottom tabs. Each tab folder has its own `_layout.tsx` Stack for detail screens.
- `src/api/` - `client.ts` (JSON requests, refresh on 401), `sse.ts` (chat stream reader), `auth.ts`, `tokens.ts` (secure token store).
- `src/auth/AuthContext.tsx` - the signed-in user and sign-in/sign-out.
- `src/components/` - Screen, Button, TextField, ErrorText, EmptyState.
- `src/theme.ts` - colours (light and dark), spacing, font sizes; `useTheme()`.
- `src/config.ts` - the API origin.

## Read next

- `DESIGN.md` - the rules that keep every screen looking like the web app on Android and iOS.
- `PARITY.md` - every place this app differs from the web app, and what still needs setup.
