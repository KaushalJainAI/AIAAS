# `browsing/`: a real browser the AI can drive

The user sees this as the `browse_page` (read a page) and `browser_act` (click,
type) tools in chat and agents, plus the link preview. The tools are defined in
`chat/tools/browser.py`. **Off by default:** with `BROWSER_ENGINE=none` the
tools are not offered at all.

## Data (`models.py`)

| Model | What it is |
|---|---|
| `BrowserSession` | A saved browser profile for one user and one website. Keeps `last_url` (max 2,000 characters) |

## Files

| File | What it does |
|---|---|
| `engine.py` | The one door to a remote browser. Steps arrive as data and are checked first (`check_steps`). The model never sends raw JavaScript. `looks_submitting` flags steps that would submit, pay or send |
| `sessions.py` | Opens, reuses, touches and closes sessions. `sweep()` closes idle or over-age ones |
| `frames.py` | The last picture of a browser call, kept in the cache for `BROWSER_FRAME_TTL_SECONDS`, under the owner's id. `get` returns nothing for another user's id |
| `costs.py` | `record_browser_minute`: writes the estimated browser minute to the spend ledger |
| `views.py`, `urls.py` | `/api/browser/`: `status/`, `frames/<id>/` and `preview/`. Owner only |
| `tasks.py`, `management/commands/sweep_browser_sessions.py` | The periodic sweep, and the same sweep run by hand |

## What a browser call returns

- **`browser_view`** (on every successful call): `frame_id`, `url`, `title`, `session`, `live_url`, `steps` and `needs_user`. It never carries typed text or a vault value.
- **`elements`**: up to 80 visible interactive elements, each `{ref, role, name, selector}`. An input's value is never read.
- **`steps`**: each is `{action, ok}`. A failed step adds `code` (`not_found`, `not_visible`, `timeout`, `navigated_away` or `failed`) and a short `error`. A call refused before it ran returns `code: 'blocked'`.
- **`viewport`**: `desktop` (default) or `phone`. Anything else is refused.
- **Session resume**: `browser_act` may leave out `url` when `session` names an open session. It then starts at that session's `last_url`, checked like any start URL.

## Step verbs

`click`, `type`, `select`, `press`, `wait`, `scroll`, `fill_secret`, `download`,
`extract`, `navigate`, `back`, `hover`, `check` and `uncheck`. `upload` is
refused. `navigate` takes http or https only, and it is checked against the
agent's `browserDomains` and then `core.safety.net`.

## Link preview

`POST /api/browser/preview/` opens one link with no steps (read only), keeps
its picture as a frame, and returns its title and a short excerpt. It is
throttled at 20 an hour per user, and each successful preview records one
browser minute.

## Rules

- An agent may *act* (click, type) only on domains in its `browserDomains`. Empty means read-only.
- Steps that would submit, pay or send are never freed by auto mode (`chat/turn/reviewer.py`).
- Nothing solves CAPTCHAs. A person does it through `ask_user`.
- A picture is kept only in the cache, for its owner. It is saved to the user's files only when the call asks (`screenshot: true`).
- Step results and elements never carry typed text, a vault value or an input's value. `clean_steps` and `clean_elements` drop any other key the remote sends.

## Tests

`browsing/tests/`: `test_sessions.py`, `test_frames.py`, `test_actions.py`,
`test_preview.py`. The chat side is in `chat/tests/test_browser.py` and
`chat/tests/test_browser_view.py`.

No test calls a real browser. The remote browser is faked at the HTTP boundary
(`workflow_backend.httpclient.shared_client`) or at `browsing.engine.run`.
