# Specialist agents — record

## Status

**All seven phases built (2026-09-20).** Office outputs, specialist
templates, publishing, media generation, browser actions — code-complete.
The browser phase (7) is **off in production until a hosted browser is
configured** (`BROWSER_ENGINE=remote` + URL + token) — that decision (D3)
belongs to the owner. D1/D2 were taken as recommended. The office
benchmark (`work-office` suite, nine office graders) is written but **never
run live** — it spends real tokens.

## What it delivered

- **Real office files from chat.** `office/` (`deck`, `workbook`,
  `document`, `themes`, `spec`), grant `office`; our code renders the real
  `.pptx` / `.xlsx` / `.docx` — the model never writes markup. Live Excel
  formulas, native charts, themes. Office preview (`OfficePreview.tsx`)
  draws from the stored spec.
- **File output contract.** `files` contract in `agents/contracts.py`;
  every specialist declares `outputContract: files`, returning
  `{summary, files}` with file cards on `/runs`.
- **`RUN_PYTHON_ON_FILES`** (`run_python_on_files`, grant `codeExecution`)
  over the same sandbox engine — files in, new files out; outputs never
  overwrite (a taken name becomes `name (2).ext`). Kept separate from
  `execute_python` because that one is `read` so `plan` mode keeps it.
- **Specialist templates.** `analyst`, `slides`, `writer` in
  `agents/gallery/` (`fileAccess: read_all_write_own`, `autonomy: auto`);
  seven more (super-agent, designer, report-publisher, competitor-analysis,
  lead-research, content-writer, meeting-prep) plus a `research` pack.
  `POST /api/orchestrator/templates/install-pack/` (idempotent; installs the
  office pack) with an "Install the office pack" card on `/templates`.
- **Published pages.** `PublishedPage` + `publish_page` tool (`sensitive`,
  `irreversible`) + public read routes under `/p/:slug` (uniform 404, CSP)
  and `/pages` to list/withdraw.
- **Media generation.** `generate_image` (`chat/tools/media.py`, grant
  `media`) over the Imagine OpenRouter service, saved into the file scope.
- **Browser tools.** `browse_page` / `browser_act` (grant `browser`) against
  a Browserless-compatible `/function` API; closed verb list; scoped by
  `browserDomains` (empty = read-only); unit-tested at the HTTP boundary
  only — never exercised against a live engine.
- **Office benchmark.** `eval/office_files.py` (readers + formula
  evaluator), nine graders, suite `work-office` — never run live.

## Decisions worth remembering

- **Two layers, one orchestrator.** Specialists are templates over the same
  agent loop — grants, scopes, autonomy, spend caps — not a second runtime.
- **Render tools are not `sensitive`** in chat (D1); image generation is
  `irreversible` (it spends) but not `sensitive`; chat has them directly
  (D2).
- **HTML never runs with our origin.** Published pages render marked-down;
  any HTML in an iframe sandboxed without `allow-same-origin` under a
  no-network CSP (D4).
- **The model writes specs, never file bytes.** Code renders; limits refuse
  rather than shrink.
- **Agent runs from chat carry the chat's org** and can read but not save
  team solutions (see ORG_KNOWLEDGE_PLAN).

## Open

- **Charts inside `.docx`** — deferred (needs a server-side chart render).
- **Screenshots to `ask_vision`** — deferred: `ask_vision` takes
  attachment ids, not file paths; screenshots are saved to the user's files
  instead.
- **Browser tools against a live engine** — never exercised.
- **Office benchmark `work-office`** — never run (paid).
