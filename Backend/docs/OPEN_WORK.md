# Open work

Everything still not done, in one list. Each line links to the doc with the
detail. When an item is finished, delete its line here and update the source
doc. Last reviewed 2026-11-25.

## Built, not yet checked

- **Undo** (built 2026-11-25, undeployed). Not checked by hand in a browser or on a phone. Open: an adapter refusal (for example the WhatsApp 24-hour window) shows about 20 seconds late as a failed hold; a chat turn that dies on an unusual error leaves its change set `open`; Google reversals, redo, code-workspace changes and calendar holds are out of scope. [UNDO_PLAN](UNDO_PLAN.md) §10.
- **Preview pane and browser** (built 2026-11-17, undeployed). Not checked in a real browser. Production has no browser engine, so the browser tools stay hidden there. [PREVIEW_PANE_AND_BROWSER_PLAN](PREVIEW_PANE_AND_BROWSER_PLAN.md)
- **Team knowledge K0–K7** (built 2026-11-11, undeployed). Not checked in a browser. [ORG_KNOWLEDGE_PLAN](ORG_KNOWLEDGE_PLAN.md)
- **Security review fixes S1–S11** (built, undeployed). S10 is a housekeeping step for the owner. [SECURITY_REVIEW_FIX_PLAN](SECURITY_REVIEW_FIX_PLAN.md)
- **ChatGPT plan provider** (built 2026-10-11). Never run against a real account. Also open: a per-user concurrent-call cap, the `reasoning.encrypted_content` round trip, 503 retry, and the hosted-site consent screen. [CHATGPT_PLAN_PROVIDER_PLAN](CHATGPT_PLAN_PROVIDER_PLAN.md)
- **UX overhaul** (Phases 0–11 and 13 built 2026-11-19, undeployed). Not checked on a real phone or with a live agent run. [UX_OVERHAUL_PLAN](UX_OVERHAUL_PLAN.md)
- **Agent config, specialists, schedules, tool configuration.** Browser click-throughs and acceptance checks are not recorded. [AGENT_CONFIG_IMPROVEMENT_PLAN](AGENT_CONFIG_IMPROVEMENT_PLAN.md), [SPECIALIST_AGENTS_PLAN](SPECIALIST_AGENTS_PLAN.md), [SCHEDULES_SIMPLIFICATION_PLAN](SCHEDULES_SIMPLIFICATION_PLAN.md), [TOOL_CONFIGURATION_PLAN](TOOL_CONFIGURATION_PLAN.md)
- **Sheets formulas.** Check in a browser that `=1+1` shows 2 without a reload. [OFFICE_SUITE_PLAN](OFFICE_SUITE_PLAN.md)
- **Mobile app.** Not yet run on a device. Also open: voice input and read-aloud, the "Allow for this chat" approval scope, `eas init`, the DeviceToken route, and Google connect (needs the website deployed). [MOBILE_APP_PLAN](MOBILE_APP_PLAN.md), [mobile-native/PARITY.md](../../mobile-native/PARITY.md)

## Not built yet

- **Code tab.** `/code` opens a placeholder page (`better-n8n-frontend/src/pages/Code.tsx`). The real tab needs a workspace engine, and `Backend/workspaces/engine.py` raises on every call. [CODING_AGENTS_PLAN](CODING_AGENTS_PLAN.md)
- **Run-view upgrades** (live view, P8). [PLATFORM_CAPABILITIES_PLAN](PLATFORM_CAPABILITIES_PLAN.md)
- **Admission-wait telemetry.** The backend sends `workflow_queued` (`agents/agent/stream.py`), but no screen reads it yet. [ORCHESTRATOR_LATENCY_OPTIMIZATION_PLAN](ORCHESTRATOR_LATENCY_OPTIMIZATION_PLAN.md)
- **Orchestrator latency.** The `cached=0` prefix chase, Phase 7 (on-demand loading and warming), Phase 8 Problem B (speculative dispatch). [ORCHESTRATOR_LATENCY_OPTIMIZATION_PLAN](ORCHESTRATOR_LATENCY_OPTIMIZATION_PLAN.md)
- **Evals.** Remove chat from the agent page so evals are owned by the orchestrator; starter-kit coverage for every agent type; the create-dataset wizard. [EVAL_EXPANSION_PLAN](EVAL_EXPANSION_PLAN.md)
- **Solution memory.** The S5 benchmark suite; a per-org choice of capture model. [SOLUTION_MEMORY_PLAN](SOLUTION_MEMORY_PLAN.md)
- **Team knowledge, later items.** Share agents with an org, topic owners, export before deleting an org. [ORG_KNOWLEDGE_PLAN](ORG_KNOWLEDGE_PLAN.md)
- **Vision agent.** Rasterised visual documents (needs a PDF rasterizer); lift `chat/vision/` into a shared `perception/` package. [VISION_AGENT](VISION_AGENT.md)
- **Agent config.** The draft switch needs a data migration; a per-message cost breakdown. [AGENT_CONFIG_IMPROVEMENT_PLAN](AGENT_CONFIG_IMPROVEMENT_PLAN.md)
- **Specialists.** Screenshots to `ask_vision`; charts inside `.docx`. [SPECIALIST_AGENTS_PLAN](SPECIALIST_AGENTS_PLAN.md)
- **UI redesign.** B3 (edit a request before approving it) and B12 (live turn cost) are deferred. [UI_REDESIGN_PLAN](UI_REDESIGN_PLAN.md)
- **Schedules.** Optional Phase 5 (the same claim-then-run fix for the other sweeps). [SCHEDULES_SIMPLIFICATION_PLAN](SCHEDULES_SIMPLIFICATION_PLAN.md)
- **Connector catalogue.** Phases 1–8 and 11–14 not started (0, 9 and 10 are built). Each of the 23 API cards needs a live `connector_check` with a test key. Cal.com: the `cal-api-version` header mechanism is built, but `calcom.json` has no dates yet; check them against Cal.com's reference. [CONNECTOR_CATALOGUE_PLAN](CONNECTOR_CATALOGUE_PLAN.md), [DESIGN_HISTORY.md](../../DESIGN_HISTORY.md) (H-179)

## Found in the 2026-11-25 reviews

- **Evals send for real, with no AI disclosure and no allowlist,** outside the environment suites. Never held, because an eval has no one watching. A decision for the owner. [SAFETY_AND_GUARDRAILS](SAFETY_AND_GUARDRAILS.md) (send window)
- **Workers started from chat never hold a send.** They call as `orchestrator`, which counts as unattended, so a send a person is watching goes out at once. Decide whether they should hold. [UNDO_PLAN](UNDO_PLAN.md) §11 Q2
- **A reused session key can hide a stop.** A new chat turn on the same session key can hide an earlier stop from the hold check (`messaging/holds.py::_stop_reason`). [SAFETY_AND_GUARDRAILS](SAFETY_AND_GUARDRAILS.md) (send window)
- **Binary `call_api` responses are not scrubbed.** A binary response saved to the user's files (`_save_binary`) is not checked for secrets. [SAFETY_AND_GUARDRAILS](SAFETY_AND_GUARDRAILS.md) §2 Layer 4
- **OCR of scanned PDFs.** A PDF with no text layer taints the turn but is never read. [INJECTION_GAPS_PLAN](INJECTION_GAPS_PLAN.md)
- **Vision injection check: hit rate unmeasured.** The labelled run (clean and planted screenshots) is a paid model run and needs the owner's go-ahead. [INJECTION_GAPS_PLAN](INJECTION_GAPS_PLAN.md) Phase 3

## Production

- **No HSTS header** on the public site.
- **Backups stay on the VM.** The nightly dump and uploads are not copied off the VM, and there is no disk snapshot schedule. [DEPLOYMENT.md](../../DEPLOYMENT.md) §7
- **Backups are world-readable** on the VM.
- **`SECRET_KEY` is short.** Rotating it logs everyone out, so plan the rotation.
- **`.env` still sets `DEBUG` and CORS to True.** Compose overrides both, but fix the file so it is not wrong. [DEPLOYMENT.md](../../DEPLOYMENT.md) §5

## Paid runs (needs the owner's go-ahead)

- Eval baseline, judge calibration, and proof that the smoke deploy gate works. [EVALUATION_PRODUCTION_PLAN](EVALUATION_PRODUCTION_PLAN.md)
- E-6 proof runs of judge-built test worlds. [EVAL_ENVIRONMENTS_PLAN](EVAL_ENVIRONMENTS_PLAN.md)
- The `work-code-team` benchmark (also needs the workspace engine). [CODING_AGENTS_PLAN](CODING_AGENTS_PLAN.md)
- τ²-bench (deferred: needs a simulated-user loop). [EVALUATION_PRODUCTION_PLAN](EVALUATION_PRODUCTION_PLAN.md)
- Eval scoring on real traffic (Phase 7) and the open decisions (deploy-gate tolerance, smoke retry rule, first data-analysis dataset, AgentDojo, a second model under test). Defaults are proposed; the owner confirms. [EVALUATION_PRODUCTION_PLAN](EVALUATION_PRODUCTION_PLAN.md), [EVAL_EXPANSION_PLAN](EVAL_EXPANSION_PLAN.md)
- The browser proof run (preview plan Phase 6). Needs a browser provider. [PREVIEW_PANE_AND_BROWSER_PLAN](PREVIEW_PANE_AND_BROWSER_PLAN.md)

## Decisions still open

- **Compute isolation:** which provider runs a private machine per user (D1), and the owner questions in §6. [COMPUTE_ISOLATION_PLAN](COMPUTE_ISOLATION_PLAN.md)
- **Concurrency:** Phase 6 (more than one process), only if measurements call for it. Phase 5 helps only after the server is resized. [CONCURRENCY_LAG_FIX_PLAN](CONCURRENCY_LAG_FIX_PLAN.md)

## Gaps register

The app-flow review's gaps have a status column: [APP_FLOW_GAP_REVIEW](APP_FLOW_GAP_REVIEW.md).
