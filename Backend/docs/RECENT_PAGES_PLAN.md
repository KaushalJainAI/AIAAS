# Recent pages plan

**Status:** proposed 2026-11-26; R1–R5 built 2026-11-26 (web, not yet checked in a browser). R6–R8 open. Web first, then mobile.

## 1. The idea

Move between the pages you actually used, the way a phone's recent-apps
screen or Alt+Tab does: the last few places you touched, newest first, one
key or one tap away. Today you get back to an agent you were editing, a file
you had open or a run you were watching by going through the sidebar and the
list again.

"Touched" means a page you **did something on**, not every page you passed
through. Opening Activity on the way to a run, then the run, then an agent
should list the run and the agent, and Activity only if you stayed or acted
there.

## 2. What counts as a recent page

An entry is `{path, title, kind, icon, touchedAt}`:

| Kind | Example path | Title comes from |
|---|---|---|
| chat | `/ai-chat?session=…` | the chat's title |
| agent | `/agents/12` | the agent's name |
| run | `/runs/…` (run detail) | agent name + "run" + time |
| file / app | `/documents/…`, `/apps/…` | the file or app name |
| page | `/connections`, `/runs?tab=history`, `/settings?tab=…` | the page title + tab |

Rules:
- **A visit counts after 3 seconds on the page, or at once on any action**
  (a click on a control, typing, a save). Passing through doesn't count.
- **One entry per place.** Visiting it again moves it to the top. Query
  strings that only change scrolling or filters are dropped. `tab` and
  `session` are kept, because they name a different place.
- **At most 12 entries**, newest first. Older ones fall off.
- **Never recorded:** sign-in, `/oauth/callback`, guest pages, and pages that
  failed with 404/403. Only the path and a title are kept. Never page content,
  ids that aren't already in the URL, or anything from a form.
- **Titles come from the page.** Each page sets its title once through a small
  hook (`useRecentTitle('Sales digest')`), so we never fetch just to label an
  entry. A page that sets nothing falls back to its nav label from
  `lib/navigation.ts`.

## 3. Where it is stored

- **Per browser, per account**: `localStorage` key `aiaas_ui:recentPages`.
  Like other per-viewer conveniences, it is wrapped in try/catch and the app
  works without it.
- It must be added to `lib/accountData.ts` `LOCAL_KEYS`, so that **signing
  out or switching accounts clears it**. Otherwise one account's recent pages
  would show to the next person on a shared browser. A test pins this.
- No server storage in v1. Syncing recents across devices
  (`GET/POST /api/me/recent-pages/`) is a later, separate step, and only if
  people ask for it.

## 4. How you use it (web)

1. **The Ctrl/⌘+K menu is the switcher.** With an empty query it opens on a
   "Recent" section (icon, title, "5 min ago"), and typing searches recents
   by title along with everything else. This is the pattern people already
   know from Linear, Notion, Slack ("Jump to"), GitHub and VS Code (Ctrl+P).
   `lib/commandMenu.ts` already has sections and ranking; this adds one
   source, read from storage (the menu still never fetches).
2. **Back to the last page: ⌘K then Enter.** The highlighted row on open is
   the *previous* page (the current one is skipped), so two keystrokes flip
   between your two most recent places, as Ctrl+P → Enter does in VS Code.
3. **No dedicated key.** `Alt+Q` was considered and dropped (2026-11-26): no
   product uses it for this, on a Mac Option+Q types "œ" and sits next to
   ⌘+Q (quit the browser), and on Windows Office uses it for search.
   Ctrl+Tab belongs to the browser.
4. **Sidebar:** a small "Recent" group under the main nav with the last 3
   entries, collapsible, off on phones (the sidebar is a drawer there).

Shortcuts are shown in the Cmd+K menu's help row and in Settings →
Shortcuts (if that page exists by then), never as a surprise.

## 5. Mobile app

The phone app has bottom tabs, and its stack screens are the "pages". Same
list and rules, kept in `AsyncStorage` under the same per-account clearing:
- **A Recent sheet**, opened from a clock button in the header of the More
  tab (and from long-pressing a tab, if `DESIGN.md` allows it).
- Each row deep-links through expo-router to the same place the web path
  names. Paths that exist only on the web open the web editor in the signed-in
  web view, as rich editors do today.

## 6. Build steps

| Step | What | Tests |
|---|---|---|
| R1 | `lib/recentPages.ts` (pure): `record(list, entry, now)`, `normalisePath`, dedupe, cap, drop excluded paths; storage read/write with try/catch | vitest: dedupe, order, cap, excluded paths, query-param rules, bad storage JSON |
| R2 | `hooks/useRecentPages.ts` + `useRecentTitle(title)`; a tracker in the shell (`App.tsx`) that starts the 3-second timer on route change and records at once on the first pointer or key event inside `<main>` | vitest with fake timers |
| R3 | Add the key to `accountData.ts` `LOCAL_KEYS` | the existing account-switch test, extended |
| R4 | Cmd+K "Recent" source in `commandMenu.ts` | `commandMenu.test.ts` cases |
| R5 | Open the menu on the previous page (skip the current path), so ⌘K → Enter goes back | `commandMenu.test.ts`: initial highlight, current page skipped, empty list |
| R6 | Sidebar "Recent" group | snapshot of the rows |
| R7 | Page titles: chat, agent builder, run detail, file/app, Settings tab, Activity tab | — |
| R8 | Mobile: store, sheet, deep links | `npx tsc --noEmit`, `npm run lint` |

Each step leaves the app working. R1–R4 alone already give a useful Cmd+K
"Recent" list.

## 7. Open questions for you

1. ~~Shortcut~~ — settled 2026-11-26: no dedicated key; recents live in
   Ctrl/⌘+K (see §4).
2. **Sidebar group:** yes or no? It is the most visible part but takes room.
3. **Cross-device sync:** leave it for later (recommended)?
