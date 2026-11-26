# Keyboard shortcuts plan

**Status:** proposed 2026-11-26; K1–K4 built 2026-11-26 (`lib/shortcuts.ts`, `hooks/useShortcuts.ts`, `components/layout/ShortcutsHelp.tsx`; the single-key switch lives in the help sheet until K9). K5–K10 open. Web app. Phone app only for
hardware keyboards, later.

## 1. Aim

Make every common job doable from the keyboard, using the keys people already
know from Gmail, GitHub, Linear, Slack, Notion, ChatGPT and VS Code. **No
invented keys where a standard one exists**, and never take a key from the
browser or the operating system.

## 2. What exists today

| Keys | Where | File |
|---|---|---|
| Ctrl/⌘+K | Command menu, anywhere | `App.tsx`, `lib/commandMenu.ts` |
| Enter / Shift+Enter | Send / new line in the chat composer | `StandaloneChat.tsx` |
| Shift+Tab | Chat composer: cycle mode | `StandaloneChat.tsx` |
| `/` at the start of a message | Slash-command palette | `CommandPalette.tsx` |
| Ctrl/⌘+S, Ctrl/⌘+Z, Ctrl/⌘+Y (or ⇧Z) | Save, undo, redo in the editors | `lib/editorKeys.ts` |
| Esc | Close dialogs, menus, panes | many |
| Arrows, Home, End | Lists, menus, Activity tabs | many |

## 3. Rules every shortcut follows

1. **One table.** Every global shortcut is one entry in `lib/shortcuts.ts`
   (keys, label, group, where it applies, what it does). The key handler and
   the help sheet both read that table, so a shortcut cannot exist without
   being documented, or be documented without working. Same idea as the tool
   registry: registration *is* the documentation.
2. **⌘ on Mac, Ctrl elsewhere**, shown that way in every hint.
3. **Single-letter keys never fire while typing**: in inputs, text areas,
   selects, contenteditable or the code and office editors
   (`editorKeys.isEditableTarget`), or with Ctrl/⌘/Alt held.
4. **Accessibility (WCAG 2.1.4):** single-letter shortcuts can be **turned
   off** in Settings → Shortcuts, because they can misfire for speech-input
   users. Modifier shortcuts stay on.
5. **Never taken from the browser or OS:** Ctrl+T, W, N, L, R, D, H, J, P, F,
   G, Tab, Shift+T, 1–9, PageUp/PageDown, Alt+←/→, F5, F11, F12. Back and
   forward stay with the browser.
6. **Nothing destructive or outgoing on one key.** Delete, send and approve
   always open a confirmation, or need a modifier plus a confirm.
7. **Discoverable:** hints appear in tooltips (`New agent  C`), in the
   command menu rows, and on the help sheet.

## 4. The shortcuts

### Everywhere

| Keys | Action | Standard from |
|---|---|---|
| Ctrl/⌘+K | Command menu (search pages, chats, agents, actions) | Slack, Linear, GitHub, Notion |
| `?` (or Ctrl/⌘+/) | Shortcuts help sheet | Gmail, GitHub, Linear / Slack |
| `/` | Focus this page's search or filter box | GitHub, Gmail, YouTube |
| Esc | Close the top dialog, menu or pane; clear the selection | universal |
| Ctrl/⌘+\ | Show or hide the sidebar | Notion |
| Ctrl/⌘+Shift+O | New chat | ChatGPT |
| Ctrl/⌘+K, Enter | Back to the previous page: the menu opens on "Recent" with the last page highlighted ([RECENT_PAGES_PLAN.md](RECENT_PAGES_PLAN.md)) | VS Code (Ctrl+P), Linear, Slack |

### Go to (press `g`, then a letter within 1.5 s)

From Gmail, GitHub and Linear. A small "g …" hint shows after the first key.

| Keys | Page |
|---|---|
| `g` `c` | Ask (chat) |
| `g` `r` | Activity (runs) |
| `g` `a` | Agents |
| `g` `e` | Explore (templates) |
| `g` `f` | Files |
| `g` `k` | Connections |
| `g` `s` | Settings |

### On a page with tabs (Agents, Library, Connect, Activity, Settings)

| Keys | Action | Standard from |
|---|---|---|
| `[` / `]` | Previous / next tab | (common in Linear/Jira-style apps) |
| ← / → | Move between tabs when the tab strip has focus | WAI-ARIA tabs (built for Activity) |

### Lists (agents, runs, files, connections, keys, skills)

| Keys | Action | Standard from |
|---|---|---|
| `j` / `k` | Next / previous row | Gmail, GitHub, X |
| ↓ / ↑ | Same, for people who don't use j/k | universal |
| Enter or `o` | Open the selected row | Gmail |
| `x` | Select or deselect the row (for bulk actions) | Gmail |
| `c` | Create (new agent, new file, new key…) | Linear, Gmail |
| Delete | Delete the selected rows, **after a confirmation** | Finder/Explorer |

### Chat

| Keys | Action | Standard from |
|---|---|---|
| Enter / Shift+Enter | Send / new line | ChatGPT, Claude, Slack (built) |
| Shift+Esc | Focus the message box | ChatGPT |
| Esc (while a reply streams) | Stop generating | ChatGPT, Claude |
| ↑ in an empty message box | Edit your last message | Slack, Claude |
| Ctrl/⌘+Shift+C | Copy the last reply | ChatGPT |
| Ctrl/⌘+Shift+; | Copy the last code block | ChatGPT |
| `/` at the start | Slash commands | Slack (built) |

### Editors (documents, sheets, slides, code, agent builder)

| Keys | Action | Standard from |
|---|---|---|
| Ctrl/⌘+S | Save | universal (built) |
| Ctrl/⌘+Z / Ctrl/⌘+Y or ⇧Z | Undo / redo | universal (built) |
| Ctrl/⌘+B / I / U | Bold / italic / underline | Word, Docs |
| Ctrl/⌘+F | Find in the document (only inside an editor; the browser's otherwise) | Docs, VS Code |
| Ctrl/⌘+Enter | Run the agent (builder) / run the cell or code | Jupyter, Postman |
| Esc | Leave the editor's focus | universal |

### Approvals (Activity → Now)

| Keys | Action |
|---|---|
| `j` / `k` | Move between waiting requests |
| Enter | Open the selected request's details |
| Ctrl/⌘+Enter | Approve the open request, **after its confirmation** |

Rejecting stays a mouse action with a reason box.

## 5. Build steps

| Step | What | Tests |
|---|---|---|
| K1 | `lib/shortcuts.ts`: the table, `matches(event, shortcut)`, Mac/other key labels, the "is typing" guard, and the reserved-key list as a test so no entry can take a browser key | vitest: every entry matched; no entry hits the reserved list; no two entries share keys in one scope |
| K2 | `hooks/useShortcuts.ts`: one window listener in the shell, `g`-sequence state with a 1.5 s timeout, scopes (`global`, `list`, `chat`, `editor`), and the Settings switch for single-letter keys | vitest with fake timers |
| K3 | Help sheet (`?`, Ctrl/⌘+/), rendered from the table and grouped like §4 | component test: every table entry appears |
| K4 | Go-to sequences + Ctrl/⌘+\ + Ctrl/⌘+Shift+O + `/` focus search | — |
| K5 | `[` / `]` tab switching for hub tabs and PageTabs | — |
| K6 | List keys on the shared list rows (agents, runs, files, connections first) | per list |
| K7 | Chat keys in the composer | `chatPieces.test.tsx`-style |
| K8 | Editor keys (formatting, Ctrl/⌘+Enter run) | per editor |
| K9 | Settings → Shortcuts: single-letter toggle and the full list | — |
| K10 | Tooltips and command-menu rows show each action's keys | — |

K1–K4 alone give the command menu, help sheet, go-to and new chat: the part
most people notice first.

## 6. Open questions

1. ~~Recent pages key~~ — settled 2026-11-26: no dedicated key, recents live in Ctrl/⌘+K.
2. Should **`c`** create on every list page, or only Agents and Files?
3. Phone app: support iPad/Android hardware keyboards later, or not at all?
