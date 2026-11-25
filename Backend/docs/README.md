# Backend docs: what to read

The **reference** docs describe how the code works today. The **plan** docs
are records of built work and open proposals. They are useful for the "why",
but when a plan and the code disagree, the code is right.

New to the codebase? Start with [`../../START_HERE.md`](../../START_HERE.md).

**Open items across all plans are in OPEN_WORK.md (the last reference row
below).** Read it before you pick up a plan.

## Reference: how it works now

| Doc | What it explains |
|---|---|
| [CHAT_AGENT.md](CHAT_AGENT.md) | The chat assistant: one message, end to end, and the AI loop |
| [SLASH_COMMANDS.md](SLASH_COMMANDS.md) | Slash commands: the three kinds, the pipeline, the full list |
| [CONTEXT_AND_ATTACHMENTS.md](CONTEXT_AND_ATTACHMENTS.md) | What the model sees each turn, and how attached files reach it |
| [CONTEXT_LIFECYCLE.md](CONTEXT_LIFECYCLE.md) | How a long run stays inside the model's memory limit |
| [AGENT_OBSERVABILITY.md](AGENT_OBSERVABILITY.md) | How a run is recorded: run → turns → steps, plus agent revisions |
| [SAFETY_AND_GUARDRAILS.md](SAFETY_AND_GUARDRAILS.md) | Every guardrail, the known gaps, and the settings that control them |
| [MCP_ARCHITECTURE.md](MCP_ARCHITECTURE.md) | The MCP runtime: sessions, pooling, memory budget, credentials |
| [RAG_STRATEGY.md](RAG_STRATEGY.md) | How knowledge-base search works |
| [EVALUATION.md](EVALUATION.md) | How agents are tested and scored |
| [TESTING.md](TESTING.md) | How tests are written: the scripted model, recorded provider HTTP, the frozen clock, what is still fake |
| [NOTIFICATION_SERVICE.md](NOTIFICATION_SERVICE.md) | Notifications, HITL reminders, device push |
| [WEBHOOK_TRIGGERS.md](WEBHOOK_TRIGGERS.md) | How a webhook starts an agent run |
| [IMAGINE.md](IMAGINE.md) | Image, video and audio generation |
| [VISION_AGENT.md](VISION_AGENT.md) | How a text-only model gets answers about an image |
| [SANDBOX_EXECUTION.md](SANDBOX_EXECUTION.md) | How AI Python code runs safely |
| [ENGINEERING_DECISIONS.md](ENGINEERING_DECISIONS.md) | The hardest problems and why each was solved the way it was |
| [API.md](API.md) | Every HTTP route: access, cost, tables touched. **Update it when you change a route.** |
| [OPEN_WORK.md](OPEN_WORK.md) | Everything still not done, across all plans, in one list |

## Plans

Each plan opens with a **Status** line. The table gives the same status in
one line, so you do not have to open the file to see where it stands.

| Doc | What it covers | Status |
|---|---|---|
| [PLATFORM_CAPABILITIES_PLAN.md](PLATFORM_CAPABILITIES_PLAN.md) | P0–P10: messaging, data, browser, missions, auto mode | Built 2026-09-21. The Code tab and run-view live view are not built |
| [ORG_KNOWLEDGE_PLAN.md](ORG_KNOWLEDGE_PLAN.md) | Team knowledge: invites, curators, shared KBs, citations | Built 2026-11-11 (K0–K7), undeployed, not checked in a browser |
| [SOLUTION_MEMORY_PLAN.md](SOLUTION_MEMORY_PLAN.md) | Organisations and the solution library | Built 2026-09-28 (S0–S4), undeployed. S5 benchmark not built |
| [SPECIALIST_AGENTS_PLAN.md](SPECIALIST_AGENTS_PLAN.md) | Office files, specialist agents as templates | Built 2026-09-20. Live-engine checks not run |
| [CODING_AGENTS_PLAN.md](CODING_AGENTS_PLAN.md) | The coding team | Built 2026-09-22. Cannot run until a workspace engine exists |
| [OFFICE_SUITE_PLAN.md](OFFICE_SUITE_PLAN.md) | Docs, Sheets and Slides apps, autosave, version history, previews | Built 2026-09-26 (phases A–F) |
| [SCHEDULES_SIMPLIFICATION_PLAN.md](SCHEDULES_SIMPLIFICATION_PLAN.md) | Triggers and schedules | Built (phases 1–4, 2026-09-22). Phase 5 optional |
| [PROMPT_AND_MEMORY_PLAN.md](PROMPT_AND_MEMORY_PLAN.md) | Chat transcript bounding, user memory, system prompts | Built 2026-09-28 |
| [GAP_CLOSURE_PLAN.md](GAP_CLOSURE_PLAN.md) | Gaps found in a codebase sweep | Built 2026-09-24. The Code tab was deferred |
| [EVALUATION_PRODUCTION_PLAN.md](EVALUATION_PRODUCTION_PLAN.md) | Making evals production-grade | Implemented 2026-09-19. Paid runs pending |
| [EVAL_ENVIRONMENTS_PLAN.md](EVAL_ENVIRONMENTS_PLAN.md) | Judge-built test worlds for evals | E-1–E-5 built 2026-09-24. E-6 paid runs pending |
| [EVAL_EXPANSION_PLAN.md](EVAL_EXPANSION_PLAN.md) | Eval datasets for every agent | Partly built. Per-agent datasets and chat removal not built |
| [ORCHESTRATOR_LATENCY_OPTIMIZATION_PLAN.md](ORCHESTRATOR_LATENCY_OPTIMIZATION_PLAN.md) | Faster agent orchestration | Mostly shipped. Open items at the end |
| [CONCURRENCY_LAG_FIX_PLAN.md](CONCURRENCY_LAG_FIX_PLAN.md) | Server concurrency and lag | Phases 0–5 built 2026-09-24. Phase 6 open |
| [AGENT_CONFIG_IMPROVEMENT_PLAN.md](AGENT_CONFIG_IMPROVEMENT_PLAN.md) | Audit and rebuild of agent settings | Built 2026-09-18. Browser click-through pending |
| [SECURITY_REVIEW_FIX_PLAN.md](SECURITY_REVIEW_FIX_PLAN.md) | The whole-project security review and its fixes | Built (S1–S11, N1–N8), undeployed |
| [VFS_HARDENING_PLAN.md](VFS_HARDENING_PLAN.md) | Virtual filesystem hardening | Built 2026-09-26 |
| [CUSTOM_TOOLS_PLAN.md](CUSTOM_TOOLS_PLAN.md) | User-made tools | Built (last change 2026-11-11). Two-user manual run not recorded |
| [TOOL_CONFIGURATION_PLAN.md](TOOL_CONFIGURATION_PLAN.md) | The Tools page and per-user tool switches | Partly built. The Overview merge became Activity; not verified |
| [RUN_VISIBILITY_AND_REMINDERS_PLAN.md](RUN_VISIBILITY_AND_REMINDERS_PLAN.md) | Run visibility and reminder fixes | Built, undeployed. Phase C manual checks not recorded |
| [ACTIVITY_PAGE_PLAN.md](ACTIVITY_PAGE_PLAN.md) | The Activity page | Built 2026-09-28. Missions are a section of it |
| [UNDO_PLAN.md](UNDO_PLAN.md) | Undo a chat message or run, and a short hold on sends | Built 2026-11-25 (gap fixes H-181), undeployed, not checked by hand |
| [INJECTION_GAPS_PLAN.md](INJECTION_GAPS_PLAN.md) | Closing the injection gaps: one envelope tag across a pause, scanning raw files and images | Phases 1–3 built 2026-11-24/25. Scanned-PDF OCR open |
| [PREVIEW_PANE_AND_BROWSER_PLAN.md](PREVIEW_PANE_AND_BROWSER_PLAN.md) | Tabbed side pane (phone and desktop), and the agent's browser | Built 2026-11-17 (phases 0–10), undeployed. Paid proof run pending |
| [CONNECTOR_CATALOGUE_PLAN.md](CONNECTOR_CATALOGUE_PLAN.md) | Retire custom MCP servers; one catalogue, a "Get started" panel, a conformance check | Proposed 2026-11-23. Phases 0, 9 and 10 built; the rest not started |
| [CONNECTOR_CATALOGUE.md](CONNECTOR_CATALOGUE.md) | Every planned connector: engine, what we need, the user's setup steps | Research list (2026-11-23) |
| [UX_OVERHAUL_PLAN.md](UX_OVERHAUL_PLAN.md) | Phone and desktop UX overhaul | Phases 0–11 and 13 built 2026-11-19, undeployed. Phase 12 optional |
| [CHATGPT_PLAN_PROVIDER_PLAN.md](CHATGPT_PLAN_PROVIDER_PLAN.md) | "Continue with ChatGPT" provider | Built 2026-10-11. Never run against a real account |
| [COMPUTE_ISOLATION_PLAN.md](COMPUTE_ISOLATION_PLAN.md) | A private machine per user | Proposed (for discussion). Nothing built |
| [MOBILE_APP_PLAN.md](MOBILE_APP_PLAN.md) | The React Native (Expo) mobile app | Built and bundling. Not run on a device |
| [UI_REDESIGN_PLAN.md](UI_REDESIGN_PLAN.md) | The UI redesign | Proposed 2026-11-11. Not started |
| [APP_FLOW_GAP_REVIEW.md](APP_FLOW_GAP_REVIEW.md) | The app-flow review, as a gap register | C19 fixed 2026-11-16. The rest open |
