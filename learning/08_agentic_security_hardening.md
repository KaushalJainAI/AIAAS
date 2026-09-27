# Agentic AI Security Hardening

## Overview
When moving from standard LLM applications to Agentic systems capable of using tools and modifying the environment, the attack surface expands significantly. This document captures the core vulnerabilities addressed in the system and the structural patterns implemented to prevent them.

## Key Vulnerabilities & Mitigations

### 1. The HITL (Human-In-The-Loop) Bypass
**Vulnerability:** Even if the main agent orchestration loop (`LangGraph`) requires user approval for sensitive tools (e.g., `execute_shell`), direct API endpoints exposed to frontends (like `/api/chat/execute-tool/` used for auxiliary apps) might execute tools immediately, completely bypassing the graph's interrupt logic.
**Solution:** The direct execution endpoint must mirror the graph's security logic. We explicitly check incoming tool requests against the `SENSITIVE_TOOLS` registry and block them if they require HITL approval, forcing those actions back through the chat interface.

### 2. Subprocess Environment Leakage
**Vulnerability:** Shell execution tools (e.g., `asyncio.create_subprocess_shell`) inherit the host process's environment variables by default. This exposes production secrets like `AWS_SECRET_ACCESS_KEY` or `DATABASE_URL` to the agent, which could leak them or be tricked into sending them elsewhere.
**Solution:** Explicitly construct and pass a sanitized `env` dictionary containing only benign variables (like `PATH` and `HOME`) to any subprocess execution.

### 3. Resource Exhaustion (Denial of Service)
**Vulnerability:** Tools that execute arbitrary code (`execute_shell` or `execute_python_code`) are susceptible to infinite loops or fork bombs, which will lock up the server thread or exhaust memory.
**Solution:** Always wrap unbounded execution environments with hard timeouts (e.g., `asyncio.wait_for(process.communicate(), timeout=30.0)`).

### 4. "Read-Only" Secret Exposure
**Vulnerability:** While writing files requires HITL, reading files is often fully autonomous. However, allowing the agent to read `.env`, `.git/config`, or credential files allows it to ingest those secrets into its context window, making them vulnerable to extraction via prompt injection.
**Solution:** Implement a strict Path Validation and Blacklist (`_is_safe_path`). The tool must recursively ensure the path belongs to the workspace and reject reads/lists on sensitive file names or extensions (`.pem`, `.key`).

### 5. Tool Masking via Prompt Injection
**Vulnerability:** If an attacker injects a prompt that causes the agent to run `echo "Safe command" && rm -rf /`, the user reviewing the HITL prompt might only glance at the start of the command or misinterpret its intent.
**Solution:** The frontend UI responsible for rendering the HITL approval must statically analyze the `args` payload. If the tool is a shell executor, the UI scans for chaining or redirection operators (`&`, `;`, `|`, `>`) and aggressively flags them to the user before they approve.

## Conclusion
Agentic security requires defense-in-depth:
1. **Graph Layer:** LangGraph interrupts for stateful pausing.
2. **API Layer:** Block direct access to sensitive tools.
3. **Execution Layer:** Scrub environments, enforce timeouts, blacklist paths.
4. **UI Layer:** Expose deceptive tool arguments transparently to the human approver.