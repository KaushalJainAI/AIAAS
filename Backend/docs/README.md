# Backend docs: what to read

The **reference** docs describe how the code works today. The **plan** docs
are records of built work and open proposals — useful for the "why", but when
a plan and the code disagree, the code is right.

New to the codebase? Start with [`../../START_HERE.md`](../../START_HERE.md).

**Open items across all plans live in [OPEN_WORK.md](OPEN_WORK.md)** — read
that before picking up a plan.

## Reference: how it works now

| Doc | What it explains |
|---|---|
| [CHAT_AGENT.md](CHAT_AGENT.md) | The chat assistant: one message, end to end, and the AI loop |
| [SLASH_COMMANDS.md](SLASH_COMMANDS.md) | Slash commands: the three kinds, the pipeline, the full list |
| [CONTEXT_AND_ATTACHMENTS.md](CONTEXT_AND_ATTACHMENTS.md) | What the model sees each turn, and how attached files reach it |
| [CONTEXT_LIFECYCLE.md](CONTEXT_LIFECYCLE.md) | How a long run stays inside the model's memory limit |
| [AGENT_OBSERVABILITY.md](AGENT_OBSERVABILITY.md) | How a run is recorded: run → turns → steps, plus agent revisions |
| [SAFETY_AND_GUARDRAILS.md](SAFETY_AND_GUARDRAILS.md) | Every guardrail: what an agent can reach, who approves, injection defences, containment, limits, legal duties, known gaps, credential storage |
| [MCP_ARCHITECTURE.md](MCP_ARCHITECTURE.md) | The MCP runtime: sessions, pooling, memory budget, credentials |
| [RAG_STRATEGY.md](RAG_STRATEGY.md) | How knowledge-base search works |
| [EVALUATION.md](EVALUATION.md) | How agents are tested and scored |
| [TESTING.md](TESTING.md) | How tests are written: the scripted model, recorded provider HTTP, the frozen clock, what runs for real, what is still fake |
| [NOTIFICATION_SERVICE.md](NOTIFICATION_SERVICE.md) | Notifications, HITL reminders, device push |
| [WEBHOOK_TRIGGERS.md](WEBHOOK_TRIGGERS.md) | How a webhook starts an agent run |
| [IMAGINE.md](IMAGINE.md) | Image / video / audio generation |
| [VISION_AGENT.md](VISION_AGENT.md) | How a text-only model gets answers about an image |
| [SANDBOX_EXECUTION.md](SANDBOX_EXECUTION.md) | How AI Python code runs safely |
| [ENGINEERING_DECISIONS.md](ENGINEERING_DECISIONS.md) | The hardest problems and why each was solved the way it was |
| [API.md](API.md) | Every HTTP route: access, cost, tables touched. **Update it when you change a route.** |

## Plans

Each plan opens with **Status**, so you don't need to read the whole file to
know where it stands. Built plans carry three sections: what was delivered,
decisions worth remembering, and what is still open.

| Doc | What it covers |
|---|---|
| [PLATFORM_CAPABILITIES_PLAN.md](PLATFORM_CAPABILITIES_PLAN.md) | P0–P10: messaging, data, browser, missions, auto mode |
| [ORG_KNOWLEDGE_PLAN.md](ORG_KNOWLEDGE_PLAN.md) | Team knowledge: invites, curators, shared KBs, citations |
| [SOLUTION_MEMORY_PLAN.md](SOLUTION_MEMORY_PLAN.md) | Organisations and the solution library |
| [SPECIALIST_AGENTS_PLAN.md](SPECIALIST_AGENTS_PLAN.md) | Office files, specialist agents as templates |
| [CODING_AGENTS_PLAN.md](CODING_AGENTS_PLAN.md) | The coding team (needs a workspace engine to run) |
| [OFFICE_SUITE_PLAN.md](OFFICE_SUITE_PLAN.md) | Docs/Sheets/Slides apps, autosave, version history, previews |
| [SCHEDULES_SIMPLIFICATION_PLAN.md](SCHEDULES_SIMPLIFICATION_PLAN.md) | Triggers and schedules |
| [PROMPT_AND_MEMORY_PLAN.md](PROMPT_AND_MEMORY_PLAN.md) | Chat transcript bounding, user memory, system prompts |
| [GAP_CLOSURE_PLAN.md](GAP_CLOSURE_PLAN.md) | Gaps found in a codebase sweep |
| [EVALUATION_PRODUCTION_PLAN.md](EVALUATION_PRODUCTION_PLAN.md) | Making evals production-grade |
| [EVAL_ENVIRONMENTS_PLAN.md](EVAL_ENVIRONMENTS_PLAN.md) | Judge-built test worlds for evals |
| [EVAL_EXPANSION_PLAN.md](EVAL_EXPANSION_PLAN.md) | Eval datasets for every agent |
| [ORCHESTRATOR_LATENCY_OPTIMIZATION_PLAN.md](ORCHESTRATOR_LATENCY_OPTIMIZATION_PLAN.md) | Faster agent orchestration |
| [CONCURRENCY_LAG_FIX_PLAN.md](CONCURRENCY_LAG_FIX_PLAN.md) | Server concurrency and lag |
| [AGENT_CONFIG_IMPROVEMENT_PLAN.md](AGENT_CONFIG_IMPROVEMENT_PLAN.md) | Audit and rebuild of agent settings |
| [SECURITY_REVIEW_FIX_PLAN.md](SECURITY_REVIEW_FIX_PLAN.md) | The whole-project security review and its fixes |
| [VFS_HARDENING_PLAN.md](VFS_HARDENING_PLAN.md) | Virtual filesystem hardening |
| [CUSTOM_TOOLS_PLAN.md](CUSTOM_TOOLS_PLAN.md) | User-made tools |
| [TOOL_CONFIGURATION_PLAN.md](TOOL_CONFIGURATION_PLAN.md) | The Tools page and per-user tool switches |
| [RUN_VISIBILITY_AND_REMINDERS_PLAN.md](RUN_VISIBILITY_AND_REMINDERS_PLAN.md) | Run visibility and reminder fixes |
| [ACTIVITY_PAGE_PLAN.md](ACTIVITY_PAGE_PLAN.md) | The Activity page |
| [UNDO_PLAN.md](UNDO_PLAN.md) | "Undo this run" (a change log per chat message and run, reverted without overwriting newer work) and "Undo send" (a short hold on outgoing messages) (built 2026-11-25, undeployed, not checked by hand) |
| [PREVIEW_PANE_AND_BROWSER_PLAN.md](PREVIEW_PANE_AND_BROWSER_PLAN.md) | Tabbed side pane (phone + desktop), showing and improving the agent's browser |
| [UX_OVERHAUL_PLAN.md](UX_OVERHAUL_PLAN.md) | Phone and desktop UX overhaul: five destinations, touch basics, calmer chat, failed-run retry, first run (proposed, not built) |
| [CHATGPT_PLAN_PROVIDER_PLAN.md](CHATGPT_PLAN_PROVIDER_PLAN.md) | "Continue with ChatGPT" provider |
| [COMPUTE_ISOLATION_PLAN.md](COMPUTE_ISOLATION_PLAN.md) | A private machine per user |
| [MOBILE_APP_PLAN.md](MOBILE_APP_PLAN.md) | The React Native (Expo) mobile app |
| [UI_REDESIGN_PLAN.md](UI_REDESIGN_PLAN.md) | The UI redesign |
| [APP_FLOW_GAP_REVIEW.md](APP_FLOW_GAP_REVIEW.md) | The app-flow review, as a gap register |
