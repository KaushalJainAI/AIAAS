# `browsing/`: a real browser the AI can drive

The user sees this as the `browse_page` (read a page) and `browser_act` (click,
type) tools in chat and agents. The tools are defined in `chat/tools/browser.py`.
**Off by default:** with `BROWSER_ENGINE=none` the tools are not offered at all.

## Data (`models.py`)

| Model | What it is |
|---|---|
| `BrowserSession` | A saved browser profile for one user and one website |

## Files

| File | What it does |
|---|---|
| `engine.py` | The one door to a remote browser. Steps arrive as data (`check_steps`); the model never sends raw JavaScript |
| `sessions.py` | Opens, reuses, touches and closes sessions. `sweep()` closes idle or over-age ones |
| `tasks.py` | `sweep_browser_sessions`, the periodic job that calls `sweep()` |
| `frames.py` | The last picture of a browser call, kept in the cache for `BROWSER_FRAME_TTL_SECONDS` under the owner's id. `put` refuses a picture over 600 KB; `get` returns nothing for another user's id, a made-up id or an expired one |
| `costs.py` | `record_browser_minute`: the one estimated browser minute on the spend ledger. Shared by the agent tools and the preview, so the tool library is not imported from here |
| `views.py` | The three HTTP routes under `/api/browser/`: `status/`, `frames/<id>/`, `preview/` (see API.md section 26). Owner only |
| `urls.py` | Mounts `views.py` (included at `/api/browser/` in the root URLconf) |
| `management/commands/sweep_browser_sessions.py` | The same sweep, run by hand |

## What a browser call returns

Both tools (`browse_page`, `browser_act`) return the page text, links and `elements`. `browser_act` also returns `session`, `steps`, `needs_user`, `saved_files` and `extracted` when they apply.

- **`browser_view`** (on every successful call): `{frame_id, url, title, session, live_url, steps, needs_user}`. `frame_id` is `''` when no picture could be kept. `steps` is `[{action, selector, ok}]` for the steps that ran, selectors cut to 120 characters, at most 15. It never carries `text`, a typed value, or a vault value.
- **`elements`**: up to 80 visible interactive elements, each `{ref, role, name, selector}` (`ref` is `e1`, `e2`, ...). `elements_truncated` says when there were more. An input's `value` is never read; the only `value` read in the script is the label of a submit, button or reset input.
- **`steps`** (the raw step results): each is `{action, ok}`, or for a failure `{action, ok: false, code, error}`. `code` is one of `not_found`, `not_visible`, `timeout`, `navigated_away`, `failed`. A call refused before it ran returns a top-level `code: 'blocked'` instead. `error` is cut to 200 characters, and a failed `type` or `fill_secret` says only that it could not type.
- **`viewport`**: `desktop` (1280×900, the default) or `phone` (390×844, touch, a phone user agent). Anything else is refused.
- **Session resume**: `browser_act` may leave out `url` when `session` names an open session. It then starts at that session's `last_url`, which is checked against `browserDomains` like any start URL. `BrowserSession.last_url` (max 2,000 characters) is saved when a session call finishes.

## Step verbs

`click`, `type`, `select`, `press`, `wait`, `scroll`, `fill_secret`, `download`, `extract` (the first set), plus:

- `navigate` (`text` = a web address, http or https only). Checked like a start URL: the agent's `browserDomains` first (empty means no navigation), then `core.safety.net`. A refusal is a call-level `blocked`.
- `back`: no selector, no text. Fails with `failed` if the page did not change.
- `hover`, `check`, `uncheck` (each needs a selector). `check` and `uncheck` read the box's state first and click only when it is wrong, then read it again. A click that does not change it is a `failed`.
- `upload` is still refused.

`submit` detection (`looks_submitting`) reads `click` and `press` steps only, so a `navigate` to a URL containing "pay" is not flagged.

## Link preview

`POST /api/browser/preview/` opens one link with no steps (read only), keeps its picture as a frame, and returns its title and a 2,000-character excerpt. It is throttled at 20 an hour per user (`browser_preview` in `DEFAULT_THROTTLE_RATES`), and each successful preview records one browser minute.

## Rules

- An agent may *act* (click, type) only on domains in its `browserDomains`. Empty means read-only.
- `looks_submitting` marks steps that would submit, pay or send. Auto mode never frees them (`chat/turn/reviewer.py`).
- Nothing solves CAPTCHAs. A person does it through `ask_user`.
- A picture of a page is kept only in the cache, for its owner, for `BROWSER_FRAME_TTL_SECONDS`. It is saved to the user's files only when the call asks (`screenshot: true`).
- Step results and elements never carry typed text, a vault value or an input's value. `clean_steps` and `clean_elements` drop any other key the remote sends.
- A `navigate` step is refused unless its address passes `core.safety.net` and, for an agent, its `browserDomains`.

## Tests

- `browsing/tests/test_sessions.py`: sessions, vault logins, downloads, the submit gate.
- `browsing/tests/test_frames.py`: the frame store (owner only, cap, TTL).
- `browsing/tests/test_actions.py`: elements, the new verbs, viewport, session resume, step codes.
- `browsing/tests/test_preview.py`: the preview route (404, address checks, read only, billing, throttle).
- `chat/tests/test_browser.py`: the tools over the engine (safety design, element pass-through).
- `chat/tests/test_browser_view.py`: `browser_view` contents, the frame and status routes, the ten-view cap.
- `chat/tests/test_turn_output_e2e.py`: a browser call reaches the stream and the stored message.

The remote browser is faked at the HTTP boundary (`workflow_backend.httpclient.shared_client`) or at `browsing.engine.run`. No test calls a real browser.
