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
| `management/commands/sweep_browser_sessions.py` | The same sweep, run by hand |

## Rules

- An agent may *act* (click, type) only on domains in its `browserDomains`. Empty means read-only.
- `looks_submitting` marks steps that would submit, pay or send. Auto mode never frees them (`chat/turn/reviewer.py`).
- Nothing solves CAPTCHAs. A person does it through `ask_user`.

## Tests

`browsing/tests/test_sessions.py`. The tool-level tests are `chat/tests/test_browser.py`.
