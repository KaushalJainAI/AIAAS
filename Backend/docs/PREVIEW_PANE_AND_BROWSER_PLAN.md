# Preview pane and agent browser plan

**Status:** built 2026-11-17 (Phases 0–10), undeployed, not committed by this
work. Open: Phase 6's paid proof run against a real browser provider (needs the
user's go-ahead, CLAUDE.md "Paid runs"). **Production has no browser engine**
(the user, 2026-11-17), so in production the browser tools, the Browser tab,
the chip and the link Preview button stay hidden; the tabbed pane, every file
preview and "Run scripts" work everywhere. The proof run waits until a
provider is signed up for and `BROWSER_ENGINE=remote`, `BROWSER_REMOTE_URL`
and `BROWSER_API_TOKEN` are set.

**Progress** (newest last; update this table as each phase moves):

| Phase | State | Notes |
|---|---|---|
| 0 Facts | **done** 2026-11-17 | §3 holds. No browser engine locally (`Backend/.env` absent, so `none`); production unknown. See "Phase 0 results" |
| 1 Tabbed pane | **built** 2026-11-17 | `lib/paneTabs.ts` + `components/pane/`; `FilePreviewProvider` is a re-export. tsc, lint (0) and vitest (670) green. Not yet checked by hand at 390×844 / 1440×900. Decisions: header × and Escape hide (tabs kept), a tab's × closes it; `retitle` action; eviction = leftmost inactive tab; phone Back via a `pane: true` history entry |
| 2 Everything opens in the pane | **built** 2026-11-17 | Tab kind `image` became `media` (`mediaType`); `html` tabs carry their `srcDoc` and are not persisted. Media tabs open only for own-origin, non-blob URLs, so web-search pictures still open outside (no caller yet). Auto-open lives in `features/chat/components/AutoOpenFiles.tsx` + `lib/autoOpen.ts`, setting `chat.autoOpenPane`; "first file of the turn" is literal (an edit first means no auto-open). `isOwnOrigin` moved to `lib/ownOrigin.ts`, the artifact `srcDoc` builder to `features/chat/lib/htmlArtifact.ts` |
| 3 Run scripts in own HTML files | **built** 2026-11-17 | User decision: read-only `is_owner` on `DocumentSerializer`/`DocumentListSerializer`, fails closed without context. Every document view now passes the request (or `{'user': user}` for the page helpers and recents). `HtmlFrame` is a named export with `isOwner`. Tests: `inference/tests/test_document_is_owner.py` (incl. the owner gets `true` through the API), `components/files/__tests__/htmlFrame.test.tsx`. H-154 |
| 4 Phone and desktop polish | **built** 2026-11-17 | Swipe-down on the strip hides; arrows/Delete on tabs; plan rail collapses when the chat row would drop under 420px (ResizeObserver); "Pop out" on desktop; active tab scrolls into view. HtmlArtifact header buttons are now always visible and 44px on phones (they were hover-only, unreachable on touch) |
| — By-hand checks | **done** 2026-11-17 (local, seeded chat, no real browser engine) | Desktop (1440×900): file cards open the docked pane; four tabs (3 files + Browser) switch correctly; markdown table renders; "Run scripts" appears for the owner and the page's script runs only after the click; the Browser tab shows host, URL, "No picture was kept", the steps ✓/✗ and the hand-off card; no console errors. Phone (390×844, the app in a same-origin frame of that size): cards, hand-off card and chip fit with 44px targets; the pane opens full-height between the app header and the bottom tab bar, with earlier tabs restored hidden; Back closes the pane and stays on the chat. Not checked: a real `browser_update` stream (needs an engine) and the phone keyboard |
| 5 Show the agent's browser | **built** 2026-11-17 (backend + web) | Web: `api/browser.ts`, `lib/browserView.ts`, `components/pane/BrowserTabBody.tsx`, `BrowserChip.tsx`, `BrowserPicture.tsx` (frames fetched with the token by `hooks/useBrowserFrameUrl.ts`). The browser tab lives in the reducer as `{runKey, views, running}` and is never persisted; run keys are `live<turnSeq>`, `m<messageId>`, `run:<execution_id>` (the runs page shows the chip too). The first `browser_update` of a turn auto-opens the tab under the files rule. Backend: | `browsing/frames.py` (cache, owner-keyed, 600 KB cap, TTL read at call time), `GET /api/browser/frames/<id>/`, `Event.BROWSER_UPDATE` + `_on_browser` (10 views, newest last), `output_data.browser` on runs. `browse_page` now always takes a picture; saving it to files stays opt-in. Tests: `chat/tests/test_browser_view.py`, `browsing/tests/test_frames.py`, an e2e case in `test_turn_output_e2e.py` |
| 6 Better browser control | **built** 2026-11-17 (fake-engine tests only) | `elements` (80, ref/role/name/selector, never values), verbs `navigate`/`back`/`hover`/`check`/`uncheck`, `viewport: desktop|phone`, `BrowserSession.last_url` (migration 0002) to resume a session without a url, step error `code`s (`not_found`, `not_visible`, `timeout`, `navigated_away`, `failed`; `blocked` at call level). The fixed script passes `node --check`. **Paid proof run not done: needs the user's go-ahead** |
| 7 Take over and hand back | **built** 2026-11-17 | `components/pane/NeedsUserCard.tsx`, in the Browser tab and under the **newest** saved answer only (`isLatest`). "I'm done" sends "Done on <host>. Continue." through `sendHandOff` and restores the composer draft. Not shown while the answer is still streaming |
| 8 Link previews | **built** 2026-11-17 | Backend `POST /api/browser/preview/` (20/hour, billed as one browser minute) and `GET /api/browser/status/`. Web: a Preview button after external links on desktop only when the engine is on (`hooks/useBrowserAvailable.ts`, asked only when signed in), `LinkTabBody.tsx`; previews cached per URL for the session (20) so switching tabs does not bill twice |
| 9 Phone app | **built** 2026-11-17 (not run on a device) | `browser_update` in `useChatTurn.ts` (`frames.ts::parseBrowser`, replace not append), `BrowserScreen.tsx` at `app/(tabs)/chat/browser/[key].tsx` (views passed by an in-memory key; gone after an app restart), "Browser · host" chip in `AnswerExtras.tsx`, live view via `Linking.openURL` (the system browser). No "I'm done" button: a screen cannot send a chat message, so the notice says to reply in the chat (recorded in `PARITY.md`). tsc + lint green; the app has no test runner |
| 10 Docs | with each phase | |

**Who runs this plan:** smaller models, one phase at a time. Every phase says
which files to touch, what to build, which tests to write and how to know it is
done. Read §1–§4 before any phase. Do not skip ahead. Do not merge two phases
into one change.

---

## 1. What we want

The OpenCode desktop app has a side panel beside the chat. It holds tabs: files,
diffs, and a real browser that the agent can drive while the user watches. We
want the same feel in our web app, on a desktop **and** on a phone:

1. One **side pane** beside the chat, with **tabs**. Files, images, videos, HTML
   pages, published pages and the agent's browser all open there.
2. Every preview we have today keeps working inside it (PDF, Office, LaTeX, CSV,
   notebooks and the rest; see §3).
3. The user can **see what the agent's browser is doing**: the page, the URL and
   each step. The user can **take over** when a login, OTP or CAPTCHA is needed.
4. The agent gets **better browser control**. It gets a list of the elements on
   the page with ready-made selectors, a few more actions, a phone-sized
   viewport, and sessions that carry on between calls.

## 2. How OpenCode does it, and what we can and cannot copy

OpenCode desktop is an Electron app (researched 2026-11-17 from its changelog
and PR #63002):

| OpenCode | How | Can we copy it in a browser? |
|---|---|---|
| Side panel with tabs, split view, a bottom pane, reopen-closed-tab | App UI | **Yes.** Phase 1 |
| Browser tabs in the pane | Each tab is a real embedded Chromium (Electron `WebContents`) driven over CDP | **No.** A web page cannot embed another browser. Most sites also refuse to load in an `<iframe>` (`X-Frame-Options`, CSP `frame-ancestors`). We show the **remote** browser instead: its screenshots, plus the provider's live view when there is one. Phases 5 and 7 |
| Agent `browser.*` tools act on the tab the user sees | CDP on the local Chromium | **Partly.** Our agent drives a remote Chromium (`browsing/engine.py`). The user sees it through frames and the live view, not through a local tab |
| Workspace HTML and artifacts run on a random sandboxed origin (`oc-preview:`) | Custom protocol handler | **Yes, in spirit.** A sandboxed `<iframe>` without `allow-same-origin` gives a null origin. Phase 3 |
| Chat links open in the pane | `createWebLinks` | **Partly.** We cannot frame other sites. Phase 8 shows a snapshot card with "Open in new tab" |
| Browser annotations (mark a page part, send it to the composer) | Overlay in the pane | **Yes, for our own previews.** Listed as follow-up work in §6, not in this plan |
| ⌘W / ⇧⌘T tab shortcuts | Desktop app owns the keys | **No.** In a browser those keys close or reopen the *browser's* tab. Use buttons and a tab menu, with Escape only |
| One persistent profile, sign-ins imported from 15 browsers | Local profile | **No.** Our profile is per user, per domain, held by the provider (`BrowserSession`) |
| Preview of a `localhost` dev server | Local Chromium | **Not yet.** Needs a workspace engine (`workspaces/engine.py` is a stub). Out of scope |

OpenCode's own gaps show us what to do better: it does not open the pane by
itself when the agent makes something ([issue #60892]). We will (Phase 2).

[issue #60892]: https://github.com/anomalyco/opencode/issues/60892

## 3. What we have today (checked 2026-11-17)

**Side pane.** `components/files/FilePreviewProvider.tsx`. With `docked`
(the chat uses it) it sits beside the page from the `md` breakpoint up. It can
be resized by dragging, and its width is saved in `localStorage`
(`file-preview-pane-width`). Escape closes it. On a phone it is a full-screen
drawer. **It holds one file at a time**: opening another file replaces it.
It is used by `features/chat/components/StandaloneChat.tsx` (docked) and
`components/activity/HistoryList.tsx` (drawer).

**How things open it.** `components/files/filePreviewState.ts` exposes
`useFilePreview()`. It returns `open({documentId} | {path})`, or `null` outside a
provider. Callers are `MarkdownMessage.tsx::FilePathLink` and
`FileCards.tsx`.

**The header.** `components/files/PreviewFrame.tsx` gives every surface the same
header: name, folder, "Open in <app>", Download, Export ▸, Close.

**What a file shows as.** `lib/filePreview.ts::kindOf()` decides. The view is
drawn by `components/files/FilePreview.tsx`:

| Kind | How it is drawn |
|---|---|
| `pdf` | `PdfJsViewer.tsx` (pdf.js, lazy, continuous scroll, text layer, password prompt, remembers page and zoom). Works on phones |
| `office` (docx, xlsx, pptx) | `OfficePreview.tsx` (from the stored spec or extract) |
| `legacy_office` (doc, xls, ppt) | A notice and a download |
| `opendocument`, `email` | Extracted text |
| `converted_image` (tiff, bmp, heic) | PNG from `documents/<id>/preview-image/` |
| `media` (image, video, audio, other) | `AuthenticatedMediaPreview.tsx` (a blob URL, since `<img>` cannot send a token) |
| `archive` (zip) | A list of the files inside |
| `markdown`, `csv`, `json`, `notebook`, `latex` | Rendered view plus a Source toggle |
| `html` | `HtmlFrame`: `sandbox=""` (**no scripts**) plus a no-network CSP. This is deliberate: a file may be someone else's upload (see the note at the top of `FilePreview.tsx`) |
| `code`, `text` | `CodeView.tsx` |

**Other previews outside the pane.**
- `features/chat/components/HtmlArtifact.tsx`: HTML the model wrote into its
  answer. Runs scripts in a sandbox without `allow-same-origin`. Has its own
  maximise button.
- `components/content/MediaPreview.tsx`: images and videos in messages.
- `components/content/ChartArtifact.tsx`: charts.
- `pages/PublishedPageView.tsx`: published pages at `/p/:slug`.

**The agent's browser.** `browsing/engine.py` is one door to a **remote**
Chromium (a Browserless-compatible `/function` endpoint). It is off unless
`BROWSER_ENGINE=remote` and `BROWSER_REMOTE_URL` are set. The tools are
`chat/tools/browser.py::browse_page` (read, parallel) and `browser_act` (click
and type; `sensitive`, `irreversible`). Both sit behind the `browser` grant
(`agents/grants.py`). The steps are data, never JavaScript (`ACTIONS`,
`check_steps`). Acting needs the site to be in `browserDomains`; **empty means
read-only**. Logins live in `BrowserSession` (one per user per domain; idle 10
min, hard cap 60 min).

**Already built but never shown (found while writing this plan).**
`browser_act` returns `browser_live: {url, note}` when the provider gives a live
view URL (`chat/tools/browser.py:294`), and `BrowserSession.live_url` stores it.
**No frontend file reads `browser_live`.** This is the H-068 pattern ("a feature
that passes every test and reaches nobody"). Phase 5 fixes it.

**Screenshots** are saved to the user's files only when the model passes
`screenshot: true` or `trace: true`. There is no stream of frames for a viewer.

**The phone app** (`mobile-native/`) has its own `FilePreviewScreen.tsx` and
handles `files_update` frames in `useChatTurn.ts`. It copies the web's request
bodies, so any new SSE event must be handled or ignored there too (Phase 9).

## 4. Rules for every phase

Read these before writing any code. They come from `CLAUDE.md` and
`DESIGN_HISTORY.md`.

1. **Both screen sizes, every phase.** Test at 390×844 (phone) and 1440×900
   (desktop). On a phone the pane is full-screen. Touch targets are at least
   44px (`h-10`/`h-11`; see `PlanPanel.tsx` for the pattern). No sideways page
   scroll. The shell is `overflow-hidden`, so the pane owns its own scroller
   (memory: "Mobile layout contract"; `mobile-layout.spec.ts` checks this).
2. **No browser-owned shortcuts.** Never bind ⌘W, ⌘T, ⇧⌘T, Ctrl+W, Ctrl+Tab or
   ⌘L. Escape closes the pane. Everything else is a button.
3. **Only `src/api/` calls the backend.** Components get data through an
   `api/*.ts` function. Real-time data comes through `useSocket` or the chat
   SSE stream, never through a new `WebSocket`.
4. **Untrusted HTML never runs in our origin.** Every `<iframe>` that shows model
   or user HTML has a `sandbox` attribute **without** `allow-same-origin`. Never
   use `dangerouslySetInnerHTML` for such content.
5. **Unknown and foreign ids get the same 404.** Every new endpoint checks the
   owner and answers 404, never 403, for someone else's id.
6. **No unbounded lists.** Every list has a cap and says `truncated`.
7. **A tool is one `@tool(schema)` declaration.** Browser steps stay data. Never
   add a step that runs model-written JavaScript.
8. **Every route change updates `Backend/docs/API.md`** in the same change.
9. **New frontend code** that only the chat uses goes in `src/features/chat/`.
   Code two features use (the pane is used by chat and by Activity) goes in
   `src/components/pane/`.
10. **The gates must pass after every phase:**
    - Frontend: `npm run lint` (baseline is zero problems),
      `npx tsc -b --force` (plain `tsc --noEmit` checks nothing here), and
      vitest. On Windows, run vitest from a `C:\` path in PowerShell, not a
      lowercase `c:\` path.
    - Backend: `pytest <the app's tests>` and `lint-imports` from `Backend/`.
    - Mobile (Phase 9 only): `npx tsc --noEmit` and `npm run lint` in
      `mobile-native/`.
11. **Do not edit files with `sed -i`** (it breaks CRLF files). Use the editor
    tool.
12. **Stop and ask the user** when a step says so, when a test that was green
    turns red and you cannot see why, or when a change would touch approvals,
    grants, credentials or spend beyond what the phase says.
13. **Do not commit or push** unless the user asks.

---

## Phase 0 — Check the facts (no code)

Do this first. It takes minutes and keeps the later phases honest.

1. Open `FilePreview.tsx` and `lib/filePreview.ts`. Confirm the table in §3
   still matches. If a kind was added or removed, update §3.
2. Run `grep -rn "browser_live" better-n8n-frontend/src mobile-native/src`.
   Expect no results. If there are some, someone already started Phase 5:
   read their code first.
3. Check whether a browser provider is configured anywhere: look at
   `Backend/.env` (local) and ask the user about production. **Do not** call
   the provider; that costs money. Write the answer under "Phase 0 results"
   at the end of this file.
4. Read DESIGN_HISTORY H-067 (browser, pages) and H-069 (file cards):
   `grep -n "^## H-067\|^## H-069" DESIGN_HISTORY.md`.

**Done when:** "Phase 0 results" at the end of this file is filled in.

---

## Phase 1 — One side pane with tabs (frontend only)

**Goal:** the pane holds several tabs. Opening a file adds a tab (or focuses the
one already open) instead of replacing what is there. Nothing a user can do
today gets worse.

### 1a. The tab model, as pure code

Create `better-n8n-frontend/src/lib/paneTabs.ts`. Make it pure (no React, no DOM)
so vitest can test it.

```ts
export type PaneTab =
  | { id: string; kind: 'file'; title: string; target: FileTarget }
  | { id: string; kind: 'browser'; title: string; sessionKey: string }   // Phase 5
  | { id: string; kind: 'html'; title: string; artifactKey: string }     // Phase 2
  | { id: string; kind: 'image'; title: string; src: string }            // Phase 2
  | { id: string; kind: 'link'; title: string; url: string };            // Phase 8

export interface PaneState {
  tabs: PaneTab[];        // left to right
  activeId: string | null;
  open: boolean;          // pane visible
  closed: PaneTab[];      // recently closed, newest first
}

export const MAX_TABS = 8;
export const MAX_CLOSED = 5;

export type PaneAction =
  | { type: 'open'; tab: PaneTab }   // add, or focus if same id; opens the pane
  | { type: 'activate'; id: string }
  | { type: 'close'; id: string }    // closing the last tab hides the pane
  | { type: 'closeOthers'; id: string }
  | { type: 'closeRight'; id: string }
  | { type: 'reopen' }               // pops `closed[0]`
  | { type: 'hide' }                 // Escape: hide, keep tabs
  | { type: 'show' }
  | { type: 'restore'; state: PaneState }; // from sessionStorage

export function paneReducer(state: PaneState, action: PaneAction): PaneState;
export function tabIdFor(tab: Omit<PaneTab, 'id'>): string;
```

Rules the reducer must keep:
- **The tab id comes from the content**, so opening the same thing twice
  focuses the one tab. For a file: `file:<documentId>` when there is an id,
  else `file:path:<path>`. For a browser: `browser:<sessionKey>`.
- Opening a **ninth** tab closes the **oldest tab that is not active** and puts
  it in `closed`.
- `closed` holds at most `MAX_CLOSED`, newest first, with no duplicate ids.
- Closing the active tab activates its right neighbour, else its left one.
- Closing the last tab sets `open: false`.
- Re-opening a file tab that is already open must still **re-read the file**
  (an agent may have changed it). Keep a `nonce` counter in the file tab (bump
  it on every `open`) and use it as the React `key` of the file body, the
  same trick `FilePreviewProvider` uses today with `openCount`.

Test file: `src/lib/__tests__/paneTabs.test.ts`. Cover every rule above, one
`it` per rule.

### 1b. The pane component

Create `src/components/pane/`:

| File | What it holds |
|---|---|
| `paneState.ts` | The React context: `PaneContext` and `usePane()` → `{ state, dispatch, openFile(target), openTab(tab) }`, or `null` outside a provider. Only the context, no component, so fast refresh works (same reason as `filePreviewState.ts`) |
| `SidePane.tsx` | Replaces `FilePreviewProvider`. Owns `useReducer(paneReducer)`, the docked/drawer layout, the resize handle and Escape. Copy the layout, width, resize and Escape code from `FilePreviewProvider.tsx` **unchanged**; it already works on both screen sizes |
| `PaneTabStrip.tsx` | The row of tabs. Props only: `tabs`, `activeId`, `onActivate`, `onClose`, `onMenu`. Scrolls sideways when the tabs do not fit (`overflow-x-auto`, no visible scrollbar). Each tab: icon, title (truncated), × button. On a phone each tab is at least 44px tall |
| `PaneTabMenu.tsx` | A small menu (the ⋯ button at the end of the strip, and a right-click on a tab on desktop): Close, Close others, Close tabs to the right, Reopen closed tab (disabled when there is none). Use the same popover look as `ExportMenu` in `PreviewFrame.tsx` |
| `PaneBody.tsx` | Picks the body for the active tab by `kind`. In this phase only `file` exists: move `FileBody` out of `FilePreviewProvider.tsx` into here unchanged |

**Keep the old API working.** `useFilePreview()` in
`components/files/filePreviewState.ts` must keep its signature, so
`MarkdownMessage.tsx` and `FileCards.tsx` do not change. Make `SidePane` provide
`FilePreviewContext` too, with a value of `(t) => openFile(t)`. Then turn
`FilePreviewProvider.tsx` into a one-line re-export of `SidePane` (keep the
default export and the `docked` prop), so `StandaloneChat.tsx` and
`HistoryList.tsx` keep compiling. Delete the re-export only when nothing
imports it.

**Keep only one body mounted.** Render only the active tab's body. Inactive
tabs keep their state (title, target), not a live component. A PDF in a hidden
tab must not hold a pdf.js worker. Reopening it re-reads the file, and
`PdfJsViewer` already reopens at the saved page (`useViewState`).

**Remember tabs per conversation.** Save `PaneState` to `sessionStorage` under
`pane:<conversationId>` (wrap every read and write in try/catch). Restore it
when the same conversation opens again. Restore with `open: false` so a reload
never covers the chat on a phone. Pass the conversation id in as a prop
(`storageKey`). `HistoryList` passes none, so nothing is saved there.

### 1c. Phone behaviour

- The pane is full-screen (`fixed inset-0`) below `md`, as today.
- **The Back button closes the pane.** When the pane opens on a phone (check
  `window.matchMedia('(max-width: 767px)')`), push a history entry with
  `history.pushState({ pane: true }, '')`. On `popstate`, if the pane is open,
  dispatch `hide`. When the pane is closed with the × button, call
  `history.back()` only if the top entry is ours (`history.state?.pane`).
  Do not use the router for this; it would change the URL.
- Respect the notch and the home bar: the strip gets
  `pt-[env(safe-area-inset-top)]` and the body bottom padding gets
  `pb-[env(safe-area-inset-bottom)]`, on phones only.
- Use `h-[100dvh]`, not `h-screen`, for the full-screen pane (the address bar
  on mobile browsers changes the height).

### 1d. Tests and checks

- `paneTabs.test.ts` (above).
- `src/components/pane/__tests__/PaneTabStrip.test.tsx`: renders tabs, clicking
  a tab calls `onActivate(id)`, × calls `onClose(id)` and does not also
  activate.
- The existing `chatPieces.test.tsx` and `filePreview.test.ts` must stay green.
- By hand, at both sizes: open three files from a chat answer and switch
  between them, close one, reopen it from the menu, reload the page, press
  Escape, and (phone) press Back.

**Done when** all gates in §4.10 pass and the checks above work. Update
`better-n8n-frontend/BEGINNER_GUIDE.md` (the pane is a new folder) and
CLAUDE.md's "Frontend State" list (one line for `components/pane/`).

---

## Phase 2 — Everything previewable opens in the pane

**Goal:** a user never has to leave the chat to look at something the agent
made, on either screen size.

1. **Images and videos in messages** (`components/content/MediaPreview.tsx`).
   A click opens an `image` tab with the full-size picture: `object-contain`,
   pinch-zoom on phones (CSS `touch-action: pinch-zoom` on the `<img>`), and a
   "Open original" link. Videos use a `<video controls playsInline>` in the
   same tab kind (rename the kind to `media` if that reads better; update the
   reducer tests).
   Keep the rule from `MarkdownMessage.tsx::RemoteImage`: **a remote image in
   model output is a link, never an `<img>`**. Only own-origin images (checked
   with the existing `isOwnOrigin`) may open as an image tab.
2. **HTML artifacts** (`features/chat/components/HtmlArtifact.tsx`). Add an
   "Open in pane" button next to the maximise button. It opens an `html` tab
   that renders the **same** `srcDoc` with the **same** sandbox
   (`allow-scripts`, no `allow-same-origin`). Move the `srcDoc` builder into
   an exported function in the same file, so both places build it one way.
   `artifactKey` = the message id + the artifact index.
3. **Files the agent writes** already show as cards (`FileCards.tsx`) that open
   the pane. Add **auto-open**: when a `files_update` event arrives with a file
   whose `action` is `created`, and this is the first file of the turn, open it
   in the pane **only if** (a) the screen is `md` or wider, and (b) the user
   has not closed the pane during this turn. Never auto-open on a phone; it
   would cover the answer being written. Add a toggle in Chat settings
   (`ChatSettingsDialog.tsx`): "Open new files beside the chat", default on,
   saved in `localStorage` (`pane-auto-open`).
   Where to hook it: `features/chat/hooks/useChatStream.ts` handles
   `files_update` (line ~277). Do not open the pane from the reducer. Return
   the event to `StandaloneChat`, which calls `openFile` in an effect.
4. **The runs page and Activity.** Wherever a run's files are listed with
   `FileCards`, they should already open the pane, because `HistoryList` has a
   provider. Check `/runs` too. If it has no provider, wrap it in
   `<SidePane>` (drawer mode).

**Tests:** extend `paneTabs.test.ts` for the new kinds. Add a test for the
auto-open decision as a pure function, `shouldAutoOpen({ width, userClosed,
setting, isFirstCreated })`, in `src/features/chat/lib/autoOpen.ts`.

**Done when:** at both sizes, an image, an HTML artifact and a new file can be
opened beside the chat (desktop) or full-screen (phone), and closing returns to
the same scroll position in the chat.

---

## Phase 3 — HTML files: run scripts on request

**Background.** An HTML file in the pane shows with **no scripts**. That is
deliberate: a file may be an upload someone shared into the library (the note at
the top of `FilePreview.tsx`). But a chart page or small app the agent wrote
then looks broken.

**Change:** keep the default exactly as it is. Add a **"Run scripts"** button to
the HTML view, shown only when the file is the user's own (not shared to them).
When pressed:

- Re-render the frame with `sandbox="allow-scripts"`. **Never add
  `allow-same-origin`, `allow-forms`, `allow-popups` or
  `allow-top-navigation`.**
- Keep a CSP that blocks all network loads, but allows inline script:
  `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
  img-src data: blob:; font-src data:; media-src data: blob:`.
  Put it in `FilePreview.tsx` beside `HTML_CSP` as `HTML_CSP_SCRIPTS`.
- Show the line "Scripts are on. The page cannot reach the internet or your
  account." under the frame, and a "Turn off" button.
- The choice is **not** remembered. Every open starts with scripts off.

**How to know if the file is the user's own:** check what `Document` carries
in `api/documents.ts` (look for an owner or `shared`/`permission` field). If no
such field exists, **stop and ask the user** before adding one. It is a
serializer change, so `API.md` and the mobile app would need to follow.

**Tests:** a vitest test that the frame's `sandbox` attribute never contains
`allow-same-origin` in either mode, and that "Run scripts" is absent for a
shared file.

**Write a DESIGN_HISTORY entry** for this phase (the reason is not obvious, and
it relaxes an earlier decision on purpose).

---

## Phase 4 — Polish for phones and desktops

Small items, each its own change:

1. **Swipe to close on phones.** A downward swipe on the tab strip of more than
   80px closes the pane (pointer events, `touch-action: pan-x` on the strip).
   Do not add swipe gestures to the body: PDFs, sheets and maps need their own
   drags.
2. **The pane and the plan panel.** On desktop, the plan panel
   (`components/orchestration/PlanPanel.tsx`, 300px) and the pane can both be
   open. When both are open and the chat column would be narrower than 420px,
   collapse the plan panel to its pill. Read `MIN_PAGE_WIDTH` in the pane code
   and use the same number.
3. **Keyboard on desktop:** the tab strip uses `role="tablist"`. Left and right
   arrows move between tabs. Delete on a focused tab closes it. Nothing global.
4. **The phone keyboard** must not push the pane's header off screen: use
   `100dvh` (Phase 1) and check by focusing the PDF search box at 390×844.
5. **A "Pop out" button** in `PreviewFrame` for desktop. It opens the
   file's own page (`/documents?doc=<id>`, which already exists) in a new
   browser tab. Hide it on phones.

---

## Phase 5 — Show the agent's browser

**Goal:** when the agent uses `browse_page` or `browser_act`, the user can open
a **Browser** tab and see the page (latest picture), its URL, the steps taken,
and, when the provider offers one, a link to the **live view**.

### 5a. Backend: always keep the last picture, briefly

The engine can take a screenshot (`engine.run(..., screenshot=True)`). Today
it does so only when the model asks, and saves it as a user file.

1. In `chat/tools/browser.py`, ask the engine for a screenshot **on every call**
   of both tools, at the existing quality (JPEG 50–60). Saving it to the user's
   files stays opt-in (`screenshot: true`), unchanged.
2. Create `Backend/browsing/frames.py`:
   ```python
   FRAME_TTL_SECONDS = settings.BROWSER_FRAME_TTL_SECONDS  # default 3600
   MAX_FRAME_BYTES = 600_000

   def put(user_id: int, data: bytes) -> str | None:
       """Store one JPEG in the cache; return a random frame id, or None if too big."""
   def get(user_id: int, frame_id: str) -> bytes | None:
       """The frame, or None if unknown, expired, or someone else's."""
   ```
   The key is `browser:frame:<user_id>:<frame_id>`, so another user's id finds
   nothing. Use `secrets.token_urlsafe(12)` for the id. Use
   `django.core.cache` (it is Redis in production and LocMem in local dev,
   which is fine for one `runserver`).
3. Add `BROWSER_FRAME_TTL_SECONDS` to `settings/base.py` beside the other
   `BROWSER_*` settings, and to the env list in CLAUDE.md.
4. In both tools, after the call: `frame_id = frames.put(user_id, shot)` and add
   to the result JSON:
   ```json
   "browser_view": {
     "frame_id": "...", "url": "<final url>", "title": "...",
     "session": "<BrowserSession id or ''>",
     "live_url": "<provider live view or ''>",
     "steps": [{"action": "click", "selector": "...", "ok": true}],
     "needs_user": null
   }
   ```
   Keep `steps` to at most `MAX_STEPS` entries, with selectors cut to 120
   characters. **Never** put typed text in `steps`. `fill_secret` and `type`
   values may be passwords. Keep the existing `browser_live` key too, for
   older clients.
5. **Route:** `GET /api/browser/frames/<frame_id>/` → `image/jpeg`, owner only,
   404 for unknown or expired ids or another user's, `Cache-Control: private,
   max-age=3600`. Put the view in a new `browsing/views.py` and
   `browsing/urls.py`, and include it in the root URLconf. Add the row to
   `Backend/docs/API.md`.
   `lint-imports` must pass: `browsing` sits in the "providers and data" layer,
   so its views must not import `chat.tools` or `chat.turn`.

### 5b. Backend: tell the chat stream

1. Add `BROWSER_UPDATE = "browser_update"` to `chat/turn/events.py`.
2. In `chat/turn/agent.py`, add `_on_browser(parsed, args, meta, sink)` beside
   `_on_file`, and register it for `browse_page` and `browser_act` in the
   handler table (around line 1677). It keeps `meta['browser']`: a list of
   views, at most 10, newest last, one per call. It then sends
   `await sink(Event.BROWSER_UPDATE, {"browser": meta['browser']})`. Copy the
   shape of `_on_file`: whole list every time.
3. Agent runs (`/runs`): check how `files` reaches `output_data` (H-068) and do
   the same for `browser`.
4. Test `chat/tests/test_browser_view.py`:
   - The frame endpoint gives 404 for another user's frame and for a made-up
     id. The test must check that both answers are the same.
   - Typed text and `fill_secret` values never appear in `browser_view`.
   - `_on_browser` caps the list at 10.
   - **The e2e rule (H-068):** extend `chat/tests/test_turn_output_e2e.py`
     with a fake browser engine and assert that a `browser_update` event is
     emitted and that `meta['browser']` is left behind. A unit test per hop is
     not enough.

### 5c. Frontend: the Browser tab

1. `api/chat.ts`: add `browser_update` to the event union and a
   `BrowserView` type. `api/browser.ts`: `frameUrl(frameId)`. Since `<img>`
   cannot send the token, load it with the existing `hooks/useBlobUrl.ts`.
2. `useChatStream.ts`: store `browser` on the live turn like `files`.
   `ChatMessageItem.tsx`: show a small **"Browser · <host>"** chip under an
   answer that used the browser. A click opens the Browser tab.
3. `src/components/pane/BrowserTabBody.tsx` (props only):
   - A read-only address row: favicon placeholder, host in bold, full URL
     truncated, a "copy URL" button, and an "Open site" link (`target="_blank"
     rel="noopener noreferrer"`).
   - The latest picture, fitted to width, tap to zoom on phones.
   - A step list (newest first): action, selector and ✓/✗. A tap on a step
     shows that call's picture when one is still stored. If it has expired,
     say "This picture has expired."
   - When `live_url` is set: a **"Watch live / take over"** button. It opens
     the live view **in a new browser tab** (`window.open(url, '_blank',
     'noopener')`). Do not frame it: we do not control that page, and phones
     block popups opened after an `await`, so call `window.open` directly in
     the click handler.
   - While the turn is still running, show "The assistant is using this page"
     with a spinner. New `browser_update` events replace the picture without
     a reload.
4. **Auto-open:** the first `browser_update` of a turn opens the Browser tab,
   with the same rules as Phase 2 (desktop only, setting on, user has not
   closed the pane this turn).

**Done when:** with a fake engine in a test and a real engine (if Phase 0 found
one) by hand, a turn that browses shows the chip, the tab, the picture and the
steps on both screen sizes, and `grep -rn browser_live better-n8n-frontend/src`
finds the new code.

---

## Phase 6 — Better browser control for the agent

**Goal:** fewer failed clicks and fewer guessed selectors. **The safety model
does not change:** steps are data, `browser_act` stays `sensitive` and
`irreversible`, acting needs `browserDomains`, and `looks_submitting` still
forces approval.

Make each numbered item its own change, with its own tests in
`chat/tests/test_browser.py` and `browsing/tests/`.

1. **A list of elements with selectors (the biggest win).** In the fixed script
   in `engine.py`, after the steps run, collect up to **80** visible
   interactive elements (`a[href]`, `button`, `input`, `select`, `textarea`,
   `[role=button]`, `[role=link]`, `[contenteditable=true]`). For each one,
   return:
   `{ref: "e12", role, name (text, aria-label, placeholder or alt; max 80
   chars), selector}`. `selector` is a short unique CSS path built by the
   script: an `#id` if unique, else `[name=...]`, else `[data-testid=...]`,
   else a `:nth-of-type` path.
   - Return it as `elements` in both tools' results, and set
     `elements_truncated` when there were more than 80.
   - Update both tool descriptions: "Use a `selector` from `elements` rather
     than guessing one."
   - **Never return the `value` of an input.** It may hold a password.
2. **New step actions.** Add them to `ACTIONS`, `check_steps`, the script, and
   the tool schema enum, together:
   - `navigate` (`text` = a URL). Check it with `core.safety.net` like the
     start URL. If the agent has `browserDomains`, the target must be in them;
     otherwise refuse with a `BrowserError` that says why.
   - `back`.
   - `hover` (needs `selector`). Menus that open on hover.
   - `check` / `uncheck` (needs `selector`). Checkboxes, without guessing
     whether a click toggles.
   Add `navigate` to the words `looks_submitting` should **not** scan (a URL
   containing "pay" is not a payment). Add a test for that.
3. **A phone-sized viewport.** A `viewport` argument on both tools: `desktop`
   (1280×900, today's default) or `phone` (390×844, touch, a mobile user
   agent). The script reads it from its context. Validate it as one of the two
   strings.
4. **Carry on where the last call stopped.** Today every call starts from `url`.
   When a call names a `session` and gives no `url`, start from the session's
   last URL. Store `last_url` on `BrowserSession` (a new field, a migration,
   `max_length=2000`). Check it against `browserDomains` again before use.
5. **Clear errors the model can act on.** Return a short `code` with every step
   failure: `not_found` (no element matches), `not_visible`, `timeout`,
   `navigated_away` (the page changed under the step), `blocked` (refused by
   our rules). Today the model gets free text only. Put the codes in the tool
   description too.

**Paid proof run (needs the user's go-ahead):** one short `browser_act` session
against a public test page (for example a form on `httpbin.org`), checking that
`elements` is filled and that a `selector` from it can be clicked. Write the
result under "Phase 6 results" below.

**Do not** add: raw JavaScript, file upload from our storage (the engine
refuses it for a reason; see `ACTIONS`), CAPTCHA solving, or cookie import.

---

## Phase 7 — The user takes over, then hands back

Today, when a step needs an OTP or a CAPTCHA, the tool returns `needs_user` and
tells the model to ask. Make that a proper hand-off:

1. When `browser_view.needs_user` is set, the Browser tab and the chat show a
   card: "The assistant needs you on <host>: <what>". It has two buttons:
   **"Open the live page"** (only if `live_url` is set; opens a new tab) and
   **"I'm done"**.
2. "I'm done" sends a normal chat message, "Done on <host>. Continue.", through
   the existing send path. It needs no new endpoint and no new state, and the
   model already knows to call `browser_act` again with the same `session`
   (the tool note says so).
3. When there is no live view, the card says so plainly and offers the
   `ask_user` path instead (type the code into the chat).
4. On phones the live page opens in a new tab. The user comes back to our tab
   and presses "I'm done".

No change to approvals. A human-approved call is still needed for submitting
steps.

---

## Phase 8 — Link previews in the pane (optional)

Only build this if the user asks for it after Phase 5. It costs a remote
browser call per preview.

- A link in a chat answer keeps opening in a new tab (today's behaviour).
- On desktop, a small "Preview" icon beside external links opens a `link` tab.
  It calls a new `POST /api/browser/preview/` with `{url}`. That runs
  `engine.run(url, screenshot=True)` (read only, no steps), checks the URL
  with `core.safety.net`, and is **rate limited** (a DRF throttle, 20 per hour
  per user) and counted toward spend like `_record_browser_cost`. It returns
  `{title, frame_id, text_excerpt (max 2,000 chars)}`.
- When the browser engine is `none`, the icon is not shown at all (the same
  "not offered" rule the tools follow).

---

## Phase 9 — The phone app (`mobile-native/`)

The native app copies the web app's request bodies and frames. Read
`mobile-native/AGENTS.md` and `mobile-native/DESIGN.md` before starting.

1. `useChatTurn.ts`: handle `browser_update` like `files_update`, storing
   `browser` on the turn. Unknown events must already be ignored. Check that,
   and add a test if there is a test setup.
2. Add a **Browser** screen (an expo-router route) that shows the latest frame
   (fetch with the bearer header, as `FilePreviewScreen.tsx::PictureView`
   does), the URL and the steps. "Watch live" opens `live_url` in the system
   browser. Check `AGENTS.md` for the right Expo API before using one.
3. A "Browser · <host>" chip under answers, like the web.
4. Gates: `npx tsc --noEmit` and `npm run lint` in `mobile-native/`.

---

## Phase 10 — Docs and history (with each phase, not at the end)

Every phase updates, in the same change:

- `Backend/docs/API.md`: every new or changed route.
- `browsing/README.md`: `frames.py`, `views.py`, `urls.py`, the new actions.
- `Backend/docs/SAFETY_AND_GUARDRAILS.md`: Phase 3 (scripts in HTML files),
  Phase 5 (frames hold screenshots of the user's pages; TTL and owner check),
  Phase 6 (new actions and their checks).
- `better-n8n-frontend/BEGINNER_GUIDE.md` and `FRONTEND_STRUCTURE.md`: the
  `components/pane/` folder.
- `DESIGN_HISTORY.md`: a new `## H-NNN` entry for Phase 1 (tabs, one body
  mounted, no browser-owned shortcuts), Phase 3 and Phase 5 (why frames are
  cached rather than saved as files).
- The **Status** line at the top of this file.

---

## 5. Order and size

| Phase | Area | Size | Depends on |
|---|---|---|---|
| 0 | Facts | 15 min | — |
| 1 | Tabbed pane | Large | 0 |
| 2 | Everything opens in the pane | Medium | 1 |
| 3 | Run scripts in own HTML files | Small | 1, may need a user decision |
| 4 | Phone and desktop polish | Small, 5 changes | 1 |
| 5 | Show the agent's browser | Large (backend + frontend) | 1 |
| 6 | Better browser control | Medium, 5 changes | 5 for viewing; paid proof run |
| 7 | Take over and hand back | Small | 5 |
| 8 | Link previews | Medium | 5, user asks |
| 9 | Phone app | Medium | 5 |
| 10 | Docs | With each phase | — |

Phases 2, 3 and 4 can be done in any order after Phase 1. Phase 5 can start as
soon as Phase 1 is in.

## 6. Not in this plan (and why)

- **A real embedded browser.** Not possible in a web page (§2).
- **A `localhost` dev-server preview.** Needs a workspace engine
  (`COMPUTE_ISOLATION_PLAN.md`). When that exists, add a `devserver` tab kind
  that frames a proxied URL on a **separate origin**.
- **Annotations** (mark part of a page, PDF or sheet and send it to the chat).
  This is good follow-up work once tabs exist. The pane gives it a home.
- **Split view and a bottom pane.** Useful on wide screens only. Revisit after
  Phase 4 if users ask.
- **Streaming video of the browser (screencast).** It needs a long-lived
  connection to the provider, and the per-call pictures from Phase 5 may be
  enough. Measure first.

---

## Found along the way (not part of a phase)

- **2026-11-17, pre-existing:** `components/content/MediaPreview.tsx` renders
  `<img src={url}>` for an image with no thumbnail, and the live media strip in
  `StandaloneChat` and the image grid in `ChatMessageItem` pass it remote
  web-search URLs. The browser fetches them with no click, which breaks the
  "a remote image in model output is a link" rule
  (`MarkdownMessage.tsx::RemoteImage`). **The user accepted this as it is
  (2026-11-17):** image search results keep loading their pictures. Do not
  "fix" it without asking.
- **2026-11-17, fixed:** a new account signing in on the same browser saw the
  previous account's last conversation, painted from the browser's cached
  copy (sign-out cleared only the tokens). Fixed by `lib/accountData.ts`
  (forget at sign-out, claim by user id before pages render) and clearing a
  conversation the server answers 404 for. H-177.

## Phase 0 results

- 2026-11-17 Kinds: `PreviewKind` has 16 kinds, and all 16 appear in the §3 table. `FilePreview.tsx` draws each one as the table says. Two details the table leaves out: `legacy_office` also shows any recovered text under its notice, and `html` also has a Preview/Source toggle. §3 is not wrong, so it is unchanged.
- 2026-11-17 `AuthenticatedMediaPreview.tsx` lives in `components/documents/`, not `components/files/`. The table names no folder, so nothing to fix.
- 2026-11-17 `browser_live`: no hits in `better-n8n-frontend/src` or `mobile-native/src`. Phase 5 has not started. Only one backend line produces it: `Backend/chat/tools/browser.py:295` (the plan said :294). `live_url` is stored on `BrowserSession` at `chat/tools/browser.py:380`.
- 2026-11-17 Browser, local: `Backend/.env` does not exist. `BROWSER_ENGINE` is absent there and in this shell. The code default is `none` (`workflow_backend/settings/base.py:340`), so the browser is off. `BROWSER_REMOTE_URL`: absent. `BROWSER_API_TOKEN`: absent. Nothing was called.
- 2026-11-17 Browser, production: unknown, ask the user.
- 2026-11-17 H-067: the browser is a remote Chromium behind `BROWSER_ENGINE`, and the tools are not offered when it is `none`. Steps are data, never JavaScript. An empty `browserDomains` means read-only. Phases 5 and 6 must keep all three.
- 2026-11-17 H-068: a feature that no component reads passes every unit test. `chat/tests/test_turn_output_e2e.py` drives the real graph and checks the events and metadata a client reads. `browser_live` is this exact gap, so Phase 5 needs that kind of test, not only unit tests.
- 2026-11-17 H-069: every file surface previews through one body, `FilePreview.tsx`. HTML files use an empty `sandbox` and a CSP that blocks all network, because a file may be another user's upload. A plain click inside a `FilePreviewProvider` opens the drawer. Phase 3 (scripts on request) must not turn this frame into a scripted one.
- 2026-11-17 Facts: `useFilePreview()` is called only from `MarkdownMessage.tsx` (`FilePathLink`) and `FileCards.tsx`. Correct.
- 2026-11-17 Facts: `FilePreviewProvider` is used by `StandaloneChat.tsx` (`docked`, line 1946) and `components/activity/HistoryList.tsx` (not docked, line 214). Correct.
- 2026-11-17 Facts: `pages/Runs.tsx` has no provider of its own. It imports `HistoryList`, which wraps its content in the provider, so `/runs` does get the pane. Correct in effect, but the wrapper is in `HistoryList`. `FileCards` is also used by `RunDetail.tsx` and `ChatMessageItem.tsx`.
- 2026-11-17 Difference: the `open()` target type is `FileTarget = {documentId, path?} | {path}`, not `{documentId} | {path}` as §3 says. Minor.
- 2026-11-17 Note: this file had 16 more lines when I re-read it (Phase 0 at line 705, not 689). I changed nothing outside this section.

## Phase 6 results

_(fill in)_
