# Safety and guardrails

How AIAAS keeps its agents from harming users, third parties, the platform,
or the law — what exists, where it lives, what it is measured against, and
what is still open. A **reference** doc: it describes the code as it is.
The account- and login-level security review is `SECURITY_REVIEW_FIX_PLAN.md`.

## 1. The principle: contain, don't just detect

**No filter reliably stops prompt injection.** A guardrail product that
"blocks 95% of attacks" fails — in security 95% is a failing grade. The
platform assumes the model *can* be fooled and limits what a fooled model
can do. Filters exist as extra layers, never the main defence.

Three ideas carry the design:

1. **Least privilege.** An agent gets only the tools and data its job needs
   (OWASP LLM06 *Excessive Agency*, ASI02 *Tool Misuse*).
2. **Break the lethal trifecta.** Danger needs private data, untrusted
   content, and a way to send data out — together. Remove any one and an
   injection has nowhere to go.
3. **A person decides what cannot be undone.** Risky actions pause for a
   human; every decision is recorded.

**The human is the boss, the chat orchestrator is the manager, subagents are
the workhorses.** The chat cannot be configured, so it holds only basic,
mostly read-only tools. Real power lives in subagents, which the user
configures tool by tool.

## 2. The layers

### Layer 1 — What an agent can reach

| Control | What it does | Code |
|---|---|---|
| Chat is a manager | Read tools, planning, delegation, agent authoring, memory. Anything that writes, sends, publishes or spends belongs to a subagent. Enforced at both doors: tools withheld from the list, refused at dispatch. | `chat/tools/__init__.py`, `execute_chat_tool` |
| Grants | A subagent unlocks tool groups one by one. | `agents/grants.py::GRANT_TOOLS` |
| Scopes | Within a grant, *which* things: knowledge bases, file folders (`fileAccess`), connections and per-connection mode, agents it may delegate to, browser domains, API/DB hosts, file paths, command classes. | `agents/connector_scope.py`, `agents/agent/runtime.py` |
| Tool scope and permissions | Narrow to named tools; set each tool allow / ask / deny. Flows parent → worker, most-restrictive-wins. | `agent_context['toolScope']`, `['toolPermissions']` |
| Team knowledge bases | An owner may share a KB read-only with one of their organisations; only a chat reads it; membership checked on every read; hidden eval corpora never pass. | `inference/kb_access.py`, `chat/tools/knowledge.py` |
| Team solutions, unattended | Schedules, triggers, missions and delegated workers can search and read team solutions, never save or review one. | `chat/tools/solutions.py::_refuse_if_unattended` |
| Egress guard | Every outbound request passes the SSRF guard (no private IPs, metadata endpoints, redirects re-checked), then the per-scope host allowlist. | `core/safety/net.py` |

### Layer 2 — Who approves

| Control | What it does | Code |
|---|---|---|
| Declared effect | Every tool declares `read`, `reversible` or `irreversible`. Unknown tools (every MCP tool) count as irreversible. | `@tool(effect=…)`, `chat/tools/registry.py` |
| Autonomy ladder | `plan` (read-only) · `review` · `ask` · `auto` · `full`. | `agents/grants.py::AUTONOMY_LADDER` |
| Credentialed MCP calls | Gated unless the tool name starts with a read-only verb. Unattended runs gate reads too. | `chat/tools/permissions.py` |
| Auto, one meaning | A call that can be undone runs; one that cannot is reviewed. Handing work to an agent is the manager's own call. Money, public publishing, unnamed recipients, and any turn that read injection-shaped text are never freed by rule. | `chat/turn/reviewer.py::rule_allow`, `agents/agent/runtime.py::sensitive_tools_for` |
| Auto reviewer | A fast judge model may approve an un-undoable call when it clearly follows from the request; it can only relax ask → allow; a slow or failed judge means "ask". | `chat/turn/reviewer.py` |
| Full auto (chat) | A chat mode the person picks per conversation; no approval cards for the chat or the `ask`/`auto` workers it starts. A turn that read injection-shaped text falls back to `auto`; per-tool `ask` rules still hold; grants, scopes, spend caps, the daily send cap and content policy are untouched. | `chat/turn/reviewer.py::full_policy`, `agents/agent/runtime.py::lifted_autonomy` |
| Worker mode | A worker saved as `ask`, started from a chat in `auto`, works at `auto`. `plan`/`review` workers, per-tool `ask` rules and evals are unchanged. | `agents/agent/runtime.py::lifted_autonomy` |
| Worker requests | A subagent's approval comes to the chat. In `ask` the person decides on a card; in `auto` the manager decides, under the same floor. | `chat/tools/agents.py::answer_subagent` |
| Approval scopes | once / this chat / always; worker requests have no "always". | `chat/turn/agent.py::approve_tool_call` |
| Readable cards | A call is described in words on the server, secrets redacted by key. | `chat/tools/describe.py` |
| Questions | Agents ask structured questions instead of guessing; unattended runs proceed on a stated assumption. | `chat/tools/ask.py` |

### Layer 3 — Prompt injection

| Control | Threat | Code |
|---|---|---|
| Input sanitizer | *Direct* attempts — read through disguises (look-alike letters, invisible characters, leetspeak, spacing, base64). Refuses the whole message; never rewrites it. | `core/safety/security.py`, `core/http/middleware.py` |
| Taint flag | A tool result that addresses an AI marks the turn; `auto` then asks before anything irreversible, and memory becomes read-only. | `core/safety/provenance.py::instruction_shaped` |
| URL provenance | Stops the "open `evil.example/?d=<your data>`" leak: a composed URL carrying data is refused unless the user or a tool result supplied it. | `provenance.check_fetch` |
| No auto-loading images | A remote image in a reply is a link, never an `<img>`. | `MarkdownMessage.tsx` |
| Memory guard | No memory writes in a tainted turn; a "fact" that is an instruction is refused. | `chat/tools/memory.py` |
| Solution library guard | No saves or reviews in a tainted turn; an exchange that read instruction-shaped text is never auto-captured; "fixes" addressed to an AI are refused; secrets and contact details are scrubbed; results are framed as a colleague's evidence, never instructions. | `solutions/api.py`, `solutions/capture.py`, `solutions/access.py` |
| MCP tool pinning | Third parties write MCP tool descriptions. New tools that address an AI are quarantined; tools changed after connection are withheld until the user approves them (tool poisoning, rug pull). Refused at dispatch too. | `mcp_integration/pinning.py`, `MCPToolPin` |
| Data, not instructions | Both system prompts say it for *every* tool result: only the user gives instructions. Defence in depth behind the taint flag — a prompt rule is not a control. | `chat/turn/prompts.py::CORE_RULES`, `agents/agent/runtime.py::build_system_prompt` |

### Layer 4 — Containment

| Control | What it contains | Code |
|---|---|---|
| Python sandbox | A separate hardened container: no network, no root, read-only filesystem, memory and process limits, killed on timeout. | `sandbox_service/`, `sandbox/engine.py` |
| Virtual filesystem | Agents see paths but they are database rows; nothing reaches the host disk. Deletes go to the recycle bin. | `inference/vfs.py` |
| Secrets never reach the model | Tools take `secret_ref`s, resolved after approval and scrubbed from results. MCP subprocesses get an allow-listed environment. | `credentials/refs.py`, `mcp_integration/client.py` |
| Sandboxed rendering | HTML artifacts and published pages render in iframes without same-origin access, under a no-network CSP. File responses carry `CSP: sandbox`. | frontend `HtmlArtifact`, `/p/:slug` |
| App-wide CSP | `connect-src 'self'` refuses fetch/XHR/WebSocket to other hosts; no remote scripts; `object-src 'none'`; `frame-ancestors 'none'`. `script-src` keeps `'unsafe-inline'` because artifacts run inline scripts in `srcdoc` frames; removing it needs artifacts on a separate origin. | `better-n8n-frontend/nginx.conf` |

### Layer 5 — Limits and the kill switch

| Control | Code |
|---|---|
| Spend cap per agent, enforced on the recorded number | `agents/spend.py`, `check_guardrails` |
| Iteration cap, wall-clock limit, graceful last answer | `TurnContext.max_iterations`, `agents/budget.py` |
| Delegation depth, budget split up front, result-size caps | `agents/agent/orchestrator.py` |
| Tool output bounded; the rest archived, not silently cut | `chat/tools/tool_output.py` |
| Team solutions: automatic saves and imports capped per person per day, because each is paid model calls. A cache failure refuses the save. | `solutions/capture.py`, `solutions/importer.py` |
| Outbound messages: per run, per recipient, **and a daily cap per account across all channels** | `chat/tools/talk.py`, `core/safety/outbound.py` |
| API throttling by tier | `core/http/throttling.py` |
| **Storage quota per account** (bytes by tier and file count), checked at every door bytes come in by. A full account gets a refusal that tells a model to stop, not retry. | `inference/quota.py` |
| Uploads: one size/executable/zip-bomb check for the library and chat attachments, an upload throttle, avatars limited to small real images, a cap on files per chat | `inference/utils.py::validate_file_upload`, `core/http/throttling.py::UploadThrottle` |
| Indexing runs a fixed number of documents at once | `inference/indexing.py` |
| A ChatGPT plan pays only for runs a person started: schedules, missions and evals are refused | `llm/chatgpt_plan.py::REFUSED_CALLERS`, `agents/config.py` |
| **Pause everything** (account-wide), cancel a run, stop a worker | `UserProfile.paused_until`, `cancel_agent_run`, `stop_task` |

### Layer 6 — Content and the law

| Control | What it does | Code |
|---|---|---|
| Content policy | The platform's floor for three categories where **we** carry the legal duty: sexual content involving minors, sexual deepfakes of real people, mass-casualty (CBRN) weapon instructions. Runs on chat and agent requests, image prompts, outbound messages and published pages. Deterministic, disguise-aware, logged by category, never quotes the request back. | `core/safety/content_policy.py` |
| Model moderation | A second opinion on image prompts and published pages only (not chat). `openai/gpt-oss-safeguard-20b` classifies against our own three-category policy. Can only refuse more; fails open; verdicts cached 10 min. `CONTENT_MODERATION_MODEL` blank = off. | `core/safety/moderation.py` |
| AI labels on images | Every generated image gets a visible "AI-generated" tag and metadata. | `core/safety/labels.py` |
| AI notices | Published pages say they may be AI-generated; unreviewed messages end with "Sent by an AI assistant on behalf of the account owner." | `PublishedPageView.tsx`, `outbound.disclose` |
| Team search log | Searches in a team are logged, scrubbed and cut to 300 chars; insights show counts only, curators only, never who searched; rows deleted after 90 days. Personal searches not logged. | `solutions/search.py`, `solutions/insights.py`, `solutions/stale.py` |
| No CAPTCHA bypass | Browser steps may not touch a CAPTCHA; a person solves it through `ask_user`. | `chat/tools/browser.py` |
| Retention | After 180 days a finished run's reasoning and tool payloads are cleared; the run record stays. Runs daily. | `logs/retention.py`, `agents/scheduler.py` |
| Audit trail | Every run records turns (with reasoning), every tool call, every approval and who decided, and the exact agent configuration it ran under. | `logs/models.py`, `logs/revisions.py` |

## 3. Credential storage

- **Encryption at rest.** All credential data is encrypted with Fernet
  (`cryptography.fernet`: AES-128 in CBC mode with an HMAC). `CREDENTIAL_ENCRYPTION_KEY` lives in
  `.env`, never in source control. Binary fields hold the ciphertext to
  avoid encoding issues.
- **Ownership.** Every `Credential` has a mandatory `User` FK; queries
  filter by `user=request.user`. A resolver that throws is reported as
  `{ok: false, errors: [...]}`, a dry run writes nothing.
- **OAuth lifecycle.** `get_valid_access_token()` detects expired tokens and
  refreshes from the provider before the call. Atomic via `select_for_update`
  so concurrent runs cannot double-refresh.
- **Audit.** `CredentialAuditLog` records access (decrypt for a run) and
  updates (user change or auto-refresh) with user, timestamp, IP and the
  workflow that triggered it.

## 4. Measured against

### OWASP Top 10 for Agentic Applications (2026)

| Risk | Main controls | Status |
|---|---|---|
| ASI01 Goal hijack | Sanitizer, taint flag, approvals, URL provenance | Covered; injection can still *change the answer*, not act unapproved |
| ASI02 Tool misuse | Grants, scopes, effects, autonomy ladder | Covered |
| ASI03 Identity & privilege abuse | Per-user credentials, secret refs, scoped connectors, JWT revocation | Covered |
| ASI04 Supply chain | MCP tool pinning, stdio off in production, allow-listed env | Covered (TOFU: day-one server is trusted) |
| ASI05 Code execution | Sandbox container | Covered |
| ASI06 Memory poisoning | Memory guard, taint flag, solution library guard | Covered for user memory and the org solution library |
| ASI07 Inter-agent comms | Workers run in-process; a worker's output is a tool result, so the taint flag applies | Covered by design |
| ASI08 Cascading failures | Depth, budget split, caps, recovery sweep | Covered |
| ASI09 Human trust exploitation | Plain-language cards, no "always" for worker requests, amber Auto | Partly: approval fatigue is a human limit |
| ASI10 Rogue agents | Kill switch, audit trail, revisions, spend caps | Covered |

### Laws and rules

| Rule | How it is met | Status |
|---|---|---|
| India IT Act s.67B, POCSO | Content policy on every generation path | ✅ |
| India IT Rules (in force Feb 2026) | Content policy; visible + metadata AI labels | ✅ no C2PA manifest |
| India DPDP Act 2023 + Rules 2025 (duties from May 2027) | Encryption, access control, retention sweep | 🟡 consent notice, self-service export/delete, breach runbook to do |
| TRAI commercial-communication (Sept 2026) | Recipient allowlists for unattended runs, per-run and daily caps, AI disclosure | 🟡 no voice calls; marketing consent is the user's duty |
| EU AI Act Art. 50 (Aug 2026) | Page notice, outbound disclosure, image metadata | ✅ for content we generate |
| EU AI Act Art. 12/26 (high-risk) | Audit trail; retention floor 180 days | ✅ |
| Anti-circumvention / site terms | CAPTCHA rule, domain-scoped browser acting | 🟡 no robots.txt or paywall check |

## 5. Known gaps and residual risk

Stated plainly, so nobody reads this as "solved":

1. **Chat messages get only the pattern check.** Image prompts and published
   pages also get the model check; chat does not (a second model call on
   every turn costs latency where users wait most). The model check fails
   open, so a moderation outage falls back to patterns.
2. **Chat holds two legs of the trifecta** (it reads the user's data and the
   web). The third (sending) is closed by URL provenance and chat having no
   send tools, but a few bits can leak via a short composed URL or which
   link the model follows.
3. **Tool pinning trusts on first use.** A server malicious from the start
   with a plain-looking description is trusted until it changes.
4. **Approval fatigue.** A person who clicks Approve on everything defeats
   layer 2.
5. **No C2PA manifest** on images; labels can be cropped or stripped.
6. **DPDP readiness** (before May 2027): consent notice, self-service export
   and delete, breach-notification runbook.
7. **Robots.txt and paywalls** are not checked by the read tools.
8. **A wrong solution can spread in an org.** An honest mistake saved as a
   fix is offered to colleagues until flagged. Ranking demotes failures;
   owners/admins/curators can retract.

## 6. Settings

| Setting | Default | Meaning |
|---|---|---|
| `RUN_DETAIL_RETENTION_DAYS` | 180 | When a finished run's reasoning and tool payloads are cleared |
| `OUTBOUND_DAILY_CAP` | 100 | Messages an account's agents may send in 24 h |
| `STORAGE_QUOTA_FREE_MB` / `_PRO_MB` / `_ENTERPRISE_MB` | 1024 / 10240 / 102400 | MB an account may keep by tier. 0 switches the byte quota off |
| `MAX_DOCUMENTS_PER_USER` | 10000 | Files per account, trash included |
| `INDEXING_CONCURRENCY` | 2 | Documents extracted and embedded at once, process-wide |
| `OUTBOUND_AI_DISCLOSURE` | `unattended` | `unattended` (no person reviewed it), `always`, `never` |
| `AUTO_REVIEWER_MODEL` / `_TIMEOUT_S` | llama-4-scout / 3 | The Auto judge; slower means "ask" |
| `MCP_ALLOW_STDIO` | False in production | Local-process MCP servers |
| `CHATGPT_PLAN_ENABLED` | False in production | Off, its routes 404 and the provider is not offered |
| `SANDBOX_ENGINE` | `service` in production | The hardened container, never the dev fallback |
| `SOLUTION_CAPTURE_DAILY_CAP` | 30 | Automatic team-solution saves per person per day. 0 = off |
| `SOLUTION_IMPORT_DAILY_CAP` | 5 | Document imports of team solutions per person per day. 0 = off |
| `SOLUTION_STALE_SWEEP_SECONDS` | 604800 (one week) | How often the "may be out of date" digest and the 90-day search-log cleanup run |

## 7. Adding a tool safely

1. Declare `effect` honestly. If unsure, `irreversible`.
2. Put it behind a **grant**, not in `ALWAYS_AVAILABLE`, unless it truly
   reads or writes nothing of the user's.
3. Do **not** add it to `CHAT_ORCHESTRATOR_EXTRA` if it writes, sends,
   publishes or spends.
4. If it fetches a URL: call `provenance.refusal_for` and the egress guard.
5. If it sends to a person: call `outbound.check` and `outbound.disclose`.
6. If it generates media: call `content_policy` first and `labels` after.
7. If it takes secrets: accept `secret_ref`, never raw values.
8. Give it a `describe` phrase so its approval card reads as a sentence.
9. Refuse with a reason the model can act on ("do not retry; tell the user").

## Tests

| Area | Tests |
|---|---|
| Sanitizer | `core/tests/test_sanitizer.py` |
| Provenance, taint, URLs | `core/tests/test_provenance.py`, `chat/tests/test_injection_defences.py` |
| Content policy, labels, outbound | `core/tests/test_content_policy.py` |
| Memory, image prompts, CAPTCHA, publishing | `chat/tests/test_safety_guards.py` |
| MCP pinning | `mcp_integration/tests/test_tool_pins.py` |
| Org boundary, solution guards | `solutions/tests/`, `core/tests/test_orgs.py` |
| Retention | `logs/tests/test_retention.py` |
| Chat as manager | `chat/tests/test_orchestrator_scope.py` |
| Approvals, Auto | `chat/tests/test_permissions.py`, `test_auto_mode.py`, `test_auto_reviewer.py`, `agents/tests/test_autonomy.py` |
| Scopes | `agents/tests/test_connector_scope.py`, `test_delegation_scope.py`, `test_tool_permissions.py` |
| Guardrail benchmark (100% bar) | `eval/benchmarks/suites/guardrails.py`, `guard_work.py` |
