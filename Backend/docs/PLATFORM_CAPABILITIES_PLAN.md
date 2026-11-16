# Platform Capabilities — record

## Status

**Built** (P0–P10, 2026-09-21, working tree at the time of the build).
Payments are out of scope. The heavy capabilities all sit behind one-door
engine switches with `none` as the default.

## What it delivered

- **P0 — foundations:** secret references (`credentials/refs.py`), cost
  ledger (`logs/costs.py`, `CostEntry`), egress guard, capability registry.
- **P1 — messaging:** `messaging/` app (Slack, WhatsApp, Teams, SMS);
  `chat/tools/talk.py` with 20/run + 5/recipient caps and an unattended
  `recipients` gate; inbound webhooks; retention sweep.
- **P2 — browser pro:** `BrowserSession`, session-scoped `browser_act`,
  `fill_secret` from the vault, `ask_user` OTP/CAPTCHA pause, downloads to
  the VFS, submit gate. Uploads still refused by design.
- **P3 — auto mode:** chat autonomy ladder (Ask · Auto · Full auto · Plan),
  account default, action reviewer, argument-shaped trust rules, pause-all.
- **P4 — data:** `datasources/` app — read-only parsed `query_sql` (read-only
  txn, row cap, CSV spill), opt-in `execute_sql`, OpenAPI-driven `call_api`.
- **P5 — compute:** `workspaces/` app (models, one-door engine, views, hooks
  → `job.finished`, sweep); `workspace_exec`, `start_job` (up to 6 h) in
  `chat/tools/compute.py`; `compute` grant end to end.
- **P6 — coding:** `shell` grant served — 12 `ws_*`/`git_*` tools
  (`chat/tools/code.py`), `CodeProject`/`CodeChange`.
- **P7 — missions:** `missions/` app, run chaining across days,
  `caller='mission'`, mission tools (`start_mission`, `mission_status`,
  `wait_for`, `complete_mission`, `report_progress`).
- **P8 — dashboards:** `render_dashboard` / `save_dashboard`,
  `inference.Dashboard` (visibility link < platform < public).
- **P9 — voice + documents:** `voice/` (STT/TTS, one-door `none` default),
  `esign/` app, `ocr_document`, behind `voice`/`esign` grants.
- **P10 — slash commands:** the `chat/commands/` registry, `/goal`,
  `/code-review`, `/memory`, `/agent`, confirm sheets, `CommandPalette`.

## Decisions worth remembering

- **No heavy process runs on the app box.** No Chromium, no per-user VM, no
  Whisper. Every heavy capability is `<ENGINE>=none` by default; production
  uses a remote provider.
- **A tool is one `@tool(schema)` declaration.** It declares `effect`,
  `sensitive`, `parallel`, `requires=`; anything that sends, publishes,
  deletes or spends is `irreversible` + `sensitive`.
- **A grant says whether, a scope says which.** Empty scope means
  unrestricted only for scopes existing agents may already hold; empty means
  none for new scopes. Both doors are checked: descriptors (what is
  offered) and dispatch (what runs).
- **One door for heavy engines.** `<ENGINE>=none` means the tools are not
  offered — never offered-then-refusing. No silent fallback between engines.
- **Secrets never pass through the model.** Tools name a `secret_ref`;
  resolution happens at dispatch through the one `CredentialManager` door.
- **Refuse, don't truncate.** Oversized payloads are split or spilled via
  `tool_output.spill`, so the model can still fetch them.
- **Payments are out.** No payment links, no Razorpay/Stripe/UPI.

## Open

- **`/code` page** (the Code tab) — needs the workspace engine; not built.
- **Mission board** — missions are visible as an Activity-page section; the
  standalone board is not built.
- **Run-view upgrades** (P8: live view) — not built.
