# Open work

Every item still not done, in one place. Each links to the doc that has the
detail. When you finish one, delete its line here and update the source doc.
Compiled 2026-11-16 from the plan docs.

## Not built yet
- **Undo:** built 2026-11-25 (undeployed). Not yet checked by hand in a browser or on a phone. Open: adapter refusals (WhatsApp 24 h window) surface ~20 s late as a failed hold; a chat turn that dies on an unusual error leaves its set `open` (harmless after 10 idle minutes); Google reversals, redo, code-workspace changes and calendar holds are out of scope (§10). [UNDO_PLAN](UNDO_PLAN.md)
- **Off-VM backups.** The nightly database dump and the uploads volume stay on the production VM's own disk; nothing copies them to a bucket, and there is no disk snapshot schedule. [DEPLOYMENT.md §7](../../DEPLOYMENT.md)
- **`/code` page** (the Code tab for the coding team). Needs a workspace engine, which is also not built. [PLATFORM_CAPABILITIES_PLAN](PLATFORM_CAPABILITIES_PLAN.md), [CODING_AGENTS_PLAN](CODING_AGENTS_PLAN.md), [GAP_CLOSURE_PLAN](GAP_CLOSURE_PLAN.md)
- **Mission board.** Missions show as a section of the Activity page instead. [PLATFORM_CAPABILITIES_PLAN](PLATFORM_CAPABILITIES_PLAN.md)
- **Run-view upgrades** (P8: live view). [PLATFORM_CAPABILITIES_PLAN](PLATFORM_CAPABILITIES_PLAN.md)
- **Admission-wait telemetry** in the run stream. [ORCHESTRATOR_LATENCY_OPTIMIZATION_PLAN](ORCHESTRATOR_LATENCY_OPTIMIZATION_PLAN.md)
- **Solution memory:** the S5 benchmark suite; per-org choice of capture model. [SOLUTION_MEMORY_PLAN](SOLUTION_MEMORY_PLAN.md)
- **Team knowledge, later items:** share agents with an org, topic owners, export before deleting an org. [ORG_KNOWLEDGE_PLAN](ORG_KNOWLEDGE_PLAN.md)
- **Evals:** remove chat from the agent page so evals are owned by the orchestrator (§7); starter-kit coverage for every agent type and the create-dataset wizard. [EVAL_EXPANSION_PLAN](EVAL_EXPANSION_PLAN.md)
- **Orchestrator latency:** the `cached=0` prefix chase (diff the serialized request between iterations); Phase 7 (on-demand loading + speculative warming); Phase 8 Problem B (speculative dispatch). [ORCHESTRATOR_LATENCY_OPTIMIZATION_PLAN](ORCHESTRATOR_LATENCY_OPTIMIZATION_PLAN.md)
- **Vision agent:** Phase 2 (rasterised visual documents — needs a PDF rasterizer) and Phase 3 (lift `chat/vision/` into a shared `perception/` package). [VISION_AGENT](VISION_AGENT.md)
- **Agent config:** the draft switch needs a data migration; a per-message cost breakdown. [AGENT_CONFIG_IMPROVEMENT_PLAN](AGENT_CONFIG_IMPROVEMENT_PLAN.md)
- **Specialists:** screenshots to `ask_vision`; charts inside `.docx`. [SPECIALIST_AGENTS_PLAN](SPECIALIST_AGENTS_PLAN.md)
- **UX overhaul (phone + desktop):** Phases 0–11 and 13 built 2026-11-19 (undeployed, not committed); Phase 12 run replay is optional. Not checked on a real phone or with a live agent run. [UX_OVERHAUL_PLAN](UX_OVERHAUL_PLAN.md)
- **UI redesign:** B3 (edit a request before approving it), B12 (live turn cost). [UI_REDESIGN_PLAN](UI_REDESIGN_PLAN.md)
- **Schedules:** optional Phase 5 (the same claim-then-run fix for the other sweeps). [SCHEDULES_SIMPLIFICATION_PLAN](SCHEDULES_SIMPLIFICATION_PLAN.md)
- **Sheets app:** formulas now calculate on the main thread (the worker was never wired; fixed 2026-11-17). Check in a browser that `=1+1` shows 2 without a reload; a proper worker entry is optional future work for very large workbooks.

## Built, never verified
- **ChatGPT plan provider:** the spike (`Backend/scripts/chatgpt_plan_spike.py`) has never run against a real account (§10 is empty). Also open: per-user concurrent-call cap, `reasoning.encrypted_content` round-trip, 503 retry, hosted-site consent screen. [CHATGPT_PLAN_PROVIDER_PLAN](CHATGPT_PLAN_PROVIDER_PLAN.md)
- **Team knowledge (K0–K7):** not yet checked in a browser. [ORG_KNOWLEDGE_PLAN](ORG_KNOWLEDGE_PLAN.md)
- **Agent config:** browser click-through of the builder changes. [AGENT_CONFIG_IMPROVEMENT_PLAN](AGENT_CONFIG_IMPROVEMENT_PLAN.md)
- **Specialists:** browser tools never exercised against a live engine. [SPECIALIST_AGENTS_PLAN](SPECIALIST_AGENTS_PLAN.md)
- **Schedules:** acceptance checklist not ticked. [SCHEDULES_SIMPLIFICATION_PLAN](SCHEDULES_SIMPLIFICATION_PLAN.md)
- **Tool configuration:** Phase 2 (merge into Overview) unverified. [TOOL_CONFIGURATION_PLAN](TOOL_CONFIGURATION_PLAN.md)

## Waiting on a paid run (needs the owner's go-ahead)
- Eval baseline, judge calibration, and proof that the smoke deploy gate works. [EVALUATION_PRODUCTION_PLAN](EVALUATION_PRODUCTION_PLAN.md)
- E-6 paid proof runs of judge-built test worlds. [EVAL_ENVIRONMENTS_PLAN](EVAL_ENVIRONMENTS_PLAN.md)
- `work-code-team` benchmark (also needs the workspace engine). [CODING_AGENTS_PLAN](CODING_AGENTS_PLAN.md)
- τ²-bench (deferred: needs a simulated-user loop). [EVALUATION_PRODUCTION_PLAN](EVALUATION_PRODUCTION_PLAN.md)
- Eval scoring on real traffic (Phase 7) and the eval-production open decisions (deploy-gate tolerance, smoke retry rule, first data-analysis dataset, AgentDojo, a second model under test) — defaults proposed, owner to confirm. [EVALUATION_PRODUCTION_PLAN](EVALUATION_PRODUCTION_PLAN.md), [EVAL_EXPANSION_PLAN](EVAL_EXPANSION_PLAN.md)

## Built, not deployed
- Security review fixes S1–S11; S10 is a housekeeping step for the owner. [SECURITY_REVIEW_FIX_PLAN](SECURITY_REVIEW_FIX_PLAN.md)
- Team knowledge K0–K7. [ORG_KNOWLEDGE_PLAN](ORG_KNOWLEDGE_PLAN.md)

## Decisions still open
- **Compute isolation:** which provider runs a private machine per user (D1), and the owner questions in §6. [COMPUTE_ISOLATION_PLAN](COMPUTE_ISOLATION_PLAN.md)
- **Concurrency:** Phase 6 (more than one process), only if measurements call for it; Phase 5 helps only after the server is resized. [CONCURRENCY_LAG_FIX_PLAN](CONCURRENCY_LAG_FIX_PLAN.md)

## Mobile app
Not yet run on a device; voice input and read-aloud; the "Allow for this chat" approval scope; `eas init`; the DeviceToken route; Google connect needs the website deployed. [MOBILE_APP_PLAN](MOBILE_APP_PLAN.md), [mobile-native/PARITY.md](../../mobile-native/PARITY.md)

## Gaps found in reviews
The app-flow review's gaps are a register with a status column: [APP_FLOW_GAP_REVIEW](APP_FLOW_GAP_REVIEW.md).
