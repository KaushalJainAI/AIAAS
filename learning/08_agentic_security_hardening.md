# Agent security: the checks that must hold when a model can use tools

## What happened

A chat model is a text generator. Once it can call tools (run Python, fetch URLs,
read the user's files, send messages, call connectors), each tool is a way in for
anyone who can get text in front of the model. Five risks showed up early:

- **A side door around approval.** The approval gate sat in the agent loop. A
  direct tool endpoint used by the frontend ran the tool without it.
- **Secrets in child processes.** A tool that spawned a process inherited the host
  environment, including the platform's keys.
- **Runaway execution.** Code that loops forever or allocates without limit can hold
  a worker thread or exhaust memory.
- **Secrets read into context.** An agent that can read `.env` or a key file puts the
  secret into the model's context, where an injected prompt can extract it.
- **An approval that shows only the start.** A reviewer who sees the first part of a
  command, or raw JSON, can approve something else.

## The fix

- **One policy, two doors.** `/api/chat/execute-tool/` consults the same permission
  policy as the loop (`Backend/chat/tools/permissions.py`).
- **Allowlisted child environments.** MCP connectors get a short list of variables
  (`Backend/mcp_integration/client.py::_build_subprocess_env`).
- **Timeouts that kill.** The production sandbox runs each snippet in its own
  container and kills the whole process group on timeout
  (`Backend/sandbox_service/executor.py`). The in-process fallback used for development
  (`Backend/sandbox/safe_execution.py`) can stop a Python thread, but not a long C call.
  Treat that fallback as weaker.
- **Files are rows, not host paths.** An agent's file tools walk the user's own
  folder rows (`Backend/inference/vfs.py`). `..` is clamped at the root, and a write
  is checked against a write prefix. Credentials are referenced by slug and
  scrubbed from results (`Backend/credentials/refs.py`).
- **Approval describes the call.** The approval card is a sentence built from the
  call (`Backend/chat/tools/describe.py`). It never renders markup, redacts by key
  name, and shows the size of a payload, not the payload.
- **SSRF on every hop.** `Backend/core/safety/net.py::validate_url` blocks private
  and metadata addresses. Redirects are checked again on each hop
  (`_ValidatingRedirectHandler`, `fetch_file`). Validating the first URL is not enough.
- **Injected instructions are tracked.** A tool result that reads like an instruction
  to the model marks the turn as tainted (`Backend/core/safety/provenance.py`).
  Later irreversible actions then need approval.

## The lesson

- **Every entry point is a gate.** If two paths reach one tool, both must check the
  same policy. The one without the check is the one that gets used.
- **Validate the address you connect to.** A check on the URL you were given misses
  the redirect the server follows.
- **Limit what a tool can see before limiting what it can do.** A secret that never
  enters the context cannot be extracted by a prompt.
- **Show the approver what will happen.** A raw payload is harder to judge than a
  sentence, and a sentence must come from the call, not from the model.
- **Timeouts must kill, not just stop waiting.** A thread that keeps running after
  its caller gave up is a resource leak with a confident error message.
- **Treat tool results as untrusted input.** They can carry instructions too.

## Code

- `Backend/chat/tools/permissions.py`: approval policy
- `Backend/mcp_integration/client.py`: `_build_subprocess_env`
- `Backend/sandbox/engine.py`, `Backend/sandbox_service/executor.py`: sandbox
- `Backend/inference/vfs.py`: agent file scope
- `Backend/credentials/refs.py`: secret references
- `Backend/chat/tools/describe.py`: approval wording
- `Backend/core/safety/net.py`: SSRF guard and redirect handling
- `Backend/core/safety/provenance.py`: injection tracking
- Full list of guardrails and open gaps: `../Backend/docs/SAFETY_AND_GUARDRAILS.md`
