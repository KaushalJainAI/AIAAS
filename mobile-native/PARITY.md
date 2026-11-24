# How the mobile app differs from the web app

The mobile app (`mobile-native/`) aims to do everything the web app
(`better-n8n-frontend/`) does, on Android and iOS alike. This file lists every
place it does not, so nobody has to rediscover them. Update it when you close a
gap or open a new one.

Last checked: 2026-11-13. **Nothing here has been run on a real phone yet**,
so expect layout and behaviour bugs that this list does not know about.

## How each area is served

| Area | On the phone |
|---|---|
| Chat, Activity, Agents, Files, Runs, Schedules, Missions, Connections, Credentials, Settings, Knowledge bases, Team knowledge, Explore, Skills, Tools, Evals, Imagine, Pages, Apps | Native screens |
| Docs, Sheets, Slides, PDF, LaTeX, Code, Notepad, Tasks, Web, Photos, Whiteboard, Media editors | The web app's own editor, opened in a signed-in web view (`app/web.tsx`). Same behaviour as the website by design |
| Dashboards | Native list (refresh, delete); opening one goes to the web Dashboards page, because the web has no address for a single dashboard |
| Public agent page (`/a/<slug>`) | Not built. The app needs sign-in; signed-in users install from Explore |

## Not built

- **Voice input** and **read aloud** in chat: they need audio recording and
  playback packages, which are not installed.
- **"Allow for this chat"** approval scope: the approval card offers
  *Approve once* and *Decline* only.
- **Staff-only model catalogue tools** (refresh the catalogue, edit fallbacks)
  and the **accent colour** picker in Settings.
- **Tools → My tools** (custom API and database tools from the Tools page).
  Data tools *are* available under Connections.
- **Evals → Quality** tab.
- **Imagine**: per-kind model switch in the agent composer, and the
  "refresh catalogue" action.
- **Team settings tab** (organisation people and settings) inside Team
  knowledge. Organisations are managed from Settings → Organisations instead.
- **Browser screen "I'm done" button**: the chat composer belongs to the chat
  screen, so the Browser screen cannot send a message. It shows the
  "needs you" notice and asks the person to go back and say so.
- **Chat stream frames** not drawn: `videos_update`, and the memory, cost,
  findings-detail and pause/resume command cards.
- **Run detail** does not draw the files, charts or team-task lanes stored on a
  run (`output_data`).
- **"Undo changes…"** on a chat answer that has `metadata.changes`, and its
  screen (groups, checkboxes, outcomes, like the web's `ChangesSheet`). Not
  built yet: it is the second half of `Backend/docs/UNDO_PLAN.md` Phase 8.

## Send window (pending sends)

At parity. A message the agent is holding before it goes out (`messaging`
send window, `Backend/docs/UNDO_PLAN.md` §5) shows in a bar above the chat
composer, with **Cancel** and **Send now** while it can still be stopped, and
the same outcome lines as the web (including "Might not have been sent").
Same routes and request shapes as `better-n8n-frontend/src/api/messaging.ts`
(`src/features/messaging/api.ts`). The list is re-read every 2 s only while a
row is `held` or `sending`, and only while the chat is focused and the app is
in the foreground (`src/hooks/usePendingSends.ts`). A send tool
(`message_send`, `gmail_send_message`) seen in the live turn re-reads the list
at once and once more after 2 s (`onSendTool` in `useChatTurn`). The run page
does not show the bar yet; the hook already takes an `executionId` for it.

## Works differently

| Where | Web | Phone | Why |
|---|---|---|---|
| Confirm dialogs | Styled in-app dialog | Same, drawn by the app (`components/confirm.tsx`) | Identical look on both OSes |
| Chat attachments | Uploaded when picked | Uploaded when the message is sent | So removing a chip really removes the file |
| Chat "Edit and resend" | Offered next to "Take back" | Only "Take back" | Same effect |
| Chat confirm cards (schedule, publish) | Confirm in place | Open the native Schedules / Pages screen | Simpler on a phone |
| Chart hover tooltip | Tooltip | Table view toggle | No hover on touch screens |
| Files multi-select, drag, cut/paste | Supported | One item at a time from its menu | Phone list pattern |
| Image preview zoom | Yes | No | Not built |
| Files still processing | Status updates live | Shown as "Processing", refreshed by pull-down | Not built |
| Schedule time and timezone | Pickers | Typed time (HH:MM), timezone text with common-zone chips | No native picker installed |
| Skills editor | Split view | Write and Preview tabs | Screen width |
| Video and audio results (Imagine) | Played in the page | Opened in the in-app browser | No native player installed |
| Cost on Agents screens | — | Shown in dollars, while Runs, Insights and Schedules show rupees like the web | To be unified |
| Mission detail, its runs | Server list | The newest 50 runs, filtered on the phone | The runs endpoint has no mission filter |
| Agents list, "last run" | Per agent | Taken from the newest 100 runs, so a long-idle agent shows "No runs yet" | Avoids a request per agent |
| Extraction schema edit | Resets field types to text | Keeps each field's type | The web behaviour looks like a bug |
| Rejecting an extracted row | No confirm | Asks first | Destructive action |
| Deleting an organisation | API exists, no button | Owner-only button | Brief asked for web rules incl. delete |
| Notification taps | Open the web page | Mapped to the native screen (`src/notifications/route.ts`), anything unknown opens in the web view | — |
| Browser calls of an answer | Not drawn yet (the browser pane is planned in `Backend/docs/PREVIEW_PANE_AND_BROWSER_PLAN.md`) | A "Browser · host" chip under the answer opens a Browser screen (latest picture, calls newest first, Watch live) | Screen width. Pictures are not zoomable, and Watch live opens the system browser |

## Needs setup or deployment before it works

- **Push notifications**: run `eas init` (the app needs an EAS project id),
  and deploy the backend `DeviceToken` route (`/api/notifications/push/devices/`).
- **Google sign-in and connecting accounts** from the phone: deploy the web
  app first. Google only returns to the website, and the website's callback
  pages hand the result back to the app (`better-n8n-frontend/src/lib/appHandoff.ts`).
- Connecting a **Google-backed** account card (as opposed to a remote MCP
  server) still uses a plain browser step and re-checks the status after.
