# AIAAS Learning Files

Study notes derived from real code you wrote. Each file covers a concept end-to-end —
what it is, how it works in this codebase, and how to answer interview questions on it.

---

## Files

| # | File | Core Concept | Key Topics |
|---|------|-------------|------------|
| 01 | [Google OAuth + JWT](./01_google_oauth_jwt.md) | Social login, token verification, secure cookies | id_token vs access_token, verify_oauth2_token, HttpOnly, SameSite, JWT structure |
| 02 | [Security Hardening](./02_security_hardening.md) | Auth security, input sanitization, cache safety | SSRF, XSS regex fix, OWASP Top 10, LRU cache, audit logging |
| 03 | [BrowserOS Django Architecture](./03_browseros_django_architecture.md) | OS-like desktop in Django | ModelViewSet, user-scoped QuerySet, JSONField, custom @action, z-index management |
| 04 | [Buddy AI Screen Control](./04_buddy_ai_screen_control.md) | AI controlling a live UI | screen context capture, data-buddy-id, WebSocket push, dispatchEvent, NLP command parsing |
| 05 | [MCP — Model Context Protocol](./05_mcp_model_context_protocol.md) | AI ↔ tool standard | stdio vs SSE, credential injection, tool caching, Q objects |
| 06 | [React Hooks & WebSocket Patterns](./06_react_hooks_websocket_patterns.md) | Frontend patterns | useRef vs useState, useCallback, WebSocket lifecycle, exponential backoff, StrictMode race condition |
| 07 | [WebSocket Overuse & Polling Fixes](./07_websocket_overuse_and_polling_fixes.md) | Performance & transport design | MutationObserver anti-pattern, conditional polling, WS vs REST choice, hardcoded URL pitfall |
| 08 | [Agentic Security Hardening](./08_agentic_security_hardening.md) | Securing AI agents | HITL bypass, env leakage, shell timeouts, path validation |
| 09 | [Dependency Conflicts & Mocks](./09_dependency_conflicts_and_mock_workarounds.md) | Environment stability | MRO conflict, local mock package pattern, sys.path priority |
| 10 | [Performance, Caching & Query Optimization](./10_performance_caching_and_query_optimization.md) | Scaling list views and server state | keyset pagination, React Query, payload trimming, cache strategy |
| 11 | [Docker WSL Storage Relocation](./11_docker_wsl_storage_relocation.md) | Moving Docker Desktop data off C: | Lxss registry, `wsl --export/--import`, engine vs data distro, sparse VHDX |
| 12 | [Docker Build Speed & Deploy](./12_docker_build_speed_and_deploy.md) | Shrinking 10-min builds and 30-min deploys | BuildKit cache mounts, multi-stage `--no-cache-dir` trap, `docker save \| gzip \| scp`, patch-layer hotfix, vpnkit large-blob failure |
| 13 | [Async Django Concurrency Bottlenecks](./13_async_django_concurrency_bottlenecks.md) | Why one user could make the server lag | DB pool held across waits, `thread_sensitive`, event-loop blocking, SQLite checkpointer, in-process state vs scaling out |
| 14 | [The Auto-Mode Judge That Never Ran](./14_auto_mode_judge_that_never_ran.md) | A fail-safe that hid a broken import | mocks that skip the broken seam, broad `except` hiding bugs, `gather` then act in order, replay-safe memoization, choosing a judge model |
| 15 | [Whole-Project Security Review](./15_whole_project_security_review.md) | What a diff review can't see | pre-account takeover, JWT revocation via `iat` cutoff, blacklist app silently missing, tokens in URLs, cross-tenant webhook, hashing API keys, `blob:` origin, SSRF via redirects, zip bombs, webhook signatures, accidental limits |
| 16 | [Deploy Downtime and Background Work](./16_deploy_downtime_and_background_work.md) | What users, streams, runs, the scheduler and cron experience during a restart | measured 44 s boot, one-off work in `CMD`, cgroup OOM from stacked cron `exec`s, leader lease takeover, at-least-once vs at-most-once, unscheduled run recovery, expand/contract migrations, blue-green limits on a 913 MB box |

---

## How to Use These Notes

- Each file has an **Interview Questions** section at the bottom — answer those out loud
- Code snippets are real code from this project — trace through them to understand execution flow
- The "Why" explanations are what interviewers actually want to hear — not just "what it does" but "why this approach"

---

## Topics by Interview Category

### System Design
- BrowserOS data model (03) — multi-tenant desktop state in a relational DB
- MCP integration architecture (05) — pluggable AI tool protocol
- Buddy WebSocket push architecture (04) — real-time AI ↔ browser control

### Security
- Google OAuth flow (01) — token verification, PKCE, cookie security
- OWASP Top 10 mitigations (02) — SSRF, XSS, IDOR, injection
- Credential cache with eviction (02) — bounded TTL cache for sensitive data
- Agentic HITL and tool security (08) — preventing autonomous destruction
- Pre-account takeover and email-proof linking (15)
- "Log out everywhere" for stateless JWTs (15)
- Config flags that silently do nothing (15)
- SSRF through redirects; zip bombs; verifying webhook signatures (15)

### Backend (Django/Python)
- DRF ModelViewSet + custom actions (03)
- User-scoped QuerySets / IDOR prevention (03, 05)
- Django Channels WebSocket push (04)
- async_to_sync, sync_to_async patterns (04)
- Q objects for complex ORM queries (05)
- LRU + TTL cache eviction (02)
- Managing library crashes via mocks (09)

### Frontend (React/TypeScript)
- Custom hooks pattern (06)
- useRef vs useState (06)
- useCallback for stable references (06)
- WebSocket in React: connect, receive, cleanup (06)
- Exponential backoff reconnect + StrictMode race condition fix (06)
- dispatchEvent for programmatic React input updates (04, 06)
- Partial<T>, generic API clients (06)
- Overlay vs flex sidebar responsive patterns (06)

### Infra & Tooling
- Docker Desktop on WSL2: engine vs data distro, relocating to another drive (11)
- WSL Lxss registry and `wsl --export`/`--import` mechanics (11)
- BuildKit cache mounts for apt and pip; multi-stage `--no-cache-dir` trap (12)
- Deploy via `docker save | gzip | scp | docker load` when vpnkit chokes on push (12)
- Patch-layer hotfix: `FROM existing-image` + one `COPY` on the destination host (12)

### Performance & Transport Design
- MutationObserver anti-pattern for context sync (07)
- Conditional polling intervals (07)
- WebSocket vs REST vs SSE — when to use each (07)
- Lazy capture vs continuous push (04, 07)
- Dead code in Django routing (07)
- Keyset pagination over offset pagination (10)
- React Query for server-state caching and infinite lists (10)
- Compact list serializers vs full detail serializers (10)
- Connection-pool exhaustion from holding connections across waits (13)
- `thread_sensitive=True` vs `False`, and the hidden global thread (13)
- Finding event-loop blockers with a loop-lag ticker (13)
- Why in-process state blocks horizontal scaling (13)
