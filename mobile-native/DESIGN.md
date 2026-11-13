# Design rules for the mobile app

Every screen in `mobile-native` must look and behave the same on Android and iOS.
These rules are how that stays true when many people build screens.

## Build screens from the shared parts

- Every screen starts with `Screen` (`src/components/Screen.tsx`).
- Lists of things are `Section` (grouped, with an optional header and footer) holding `ListRow` rows. Use `Card` for one self-contained item.
- Loading, errors and empty lists use `LoadingState`, `ErrorState` and `EmptyState`. Never write a bare spinner or a plain text error.
- Status words use `StatusPill`. Counts and small labels use `Badge`.
- Filters use `SegmentedControl`. Search uses `SearchBar`.
- Icons come from `Icon` (Ionicons). Pass a name, not a component.
- Anything that asks a question or takes a choice opens in a `Sheet` (bottom sheet). Do not use `Alert` for forms.
- Destructive or irreversible actions use `confirm({ title, message, destructiveLabel })`. It resolves to a boolean.
- Markdown from the assistant uses `Markdown`.

## Data on screen

- Pull to refresh: `useRefresh(query.refetch)` gives `refreshing` and `onRefresh` for `RefreshControl`.
- Refetch on an interval: `usePolling(ms)` returns the value to pass as `refetchInterval`. It only ticks while the screen is focused and the app is in the foreground.
- Calls go through `api<T>()` in `src/api/client.ts`. Do not call `fetch` directly.

## Same look as the web app

The app is a near copy of the website on every platform. The colours in `theme.ts` are the
web's own tokens, the font is the web's (IBM Plex Sans and Mono, bundled in `src/fonts.ts`),
corners are the web's 6px, and sizes follow its Tailwind scale (body text 14).

- **Import `Text` from `src/components/Text`, never from `react-native`.** It draws the web's
  font on Android and iOS alike and turns `fontWeight` into the right font file, which Android
  will not do on its own. A `TextInput` sets `fontFamily: fontFamily.regular` itself.
- Use the same words, order and icons as the matching web screen, so someone who knows the
  website already knows the app.

## Colour and type

- Colours come from `useTheme().colors` only. No hex or rgb literals in feature code.
- Semantic colours: `success`, `warning`, `danger`, `info` (each with a `...Bg` tint), plus `primary`, `text`, `mutedText`, `border`, `surface`, `background`, `scrim`.
- Text uses the `typography` presets: `title`, `heading`, `body`, `label`, `caption`, `mono`. Do not set font sizes by hand unless a preset cannot fit.
- Spacing and radius come from `spacing` and `radius`.

## Touch and feedback

- Every touchable is at least 44pt tall. `ListRow` and `SegmentedControl` already meet this.
- Pressed state is `pressedOpacity` (0.7). Use `Pressable` with it, not a custom effect.
- Haptics (`src/lib/haptics.ts`): `success()` when an action went through (approve, send, save), `warning()` when a destructive action is confirmed or a request is refused, `tap()` for a light press. Use them on approve, reject, send and delete.

## Accessibility

- Every pressable has `accessibilityRole` and `accessibilityLabel`.
- Headers use `accessibilityRole="header"`. Alerts use `accessibilityRole="alert"`.

## Opening a web-only editor

Some editors are not built natively yet. Open them in the embedded web app so the web behaviour is kept:

```ts
router.push({ pathname: '/web', params: { path: '/documents', title: 'Files' } });
```

`path` must start with a single `/`. `app/web.tsx` refuses anything else. The web app keeps the signed-in session: tokens are seeded into the web view and copied back when the web app refreshes them.

## Folders

- `app/` holds routes only: `app/(tabs)/<area>/<screen>.tsx`. Each route file is thin and renders a screen component.
- `src/features/<area>/` holds the logic for one area: queries, types, formatting.
- `src/components/` holds shared, feature-free UI.
- `src/hooks/` holds shared hooks. `src/lib/` holds plain helpers.
- Request bodies: copy the shape from the named web file in `better-n8n-frontend/src/` and keep the same field names.

## Platforms

- Test on both platforms before you call a screen done.
- The only allowed `Platform.OS` branches are keyboard behaviour (`KeyboardAvoidingView`) and the monospace font name in `theme.ts`. Do not add others. Back handling is already done by the shared parts (`Sheet` and `WebApp` handle Android back).

## Tabs

The bar has five tabs: Chat, Activity, Agents, Files, More. Settings is reached from More. Add new areas to `src/features/more/areas.ts`, not to the tab bar.
