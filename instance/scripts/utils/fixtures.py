"""
Dummy fixtures — the "regular user" personas, agents, and content that seed_instance.py
and simulate_user_journey.py load. Values are synthetic, greppable, never secrets.

All emails are @example.com; all API keys are dummy-*.
Keep shapes aligned with AgentSerializer (flat camelCase) and KB/Doc contracts.
"""
from __future__ import annotations

from typing import Any, Dict, List

from . import testenv

# ---------- personas ----------
#
# Credentials come from `instance/test.env` so the Python harnesses and the
# browser suite read the *same* values from one file; the literals below are the
# fallback for a checkout without one. Changing a password therefore means
# editing test.env and re-running the seeder, not hunting the same string
# through five files.

PERSONAS: List[Dict[str, Any]] = [
    {
        "email": testenv.get("E2E_REGULAR_EMAIL", "regular_user@example.com"),
        "password": testenv.get("E2E_REGULAR_PASSWORD", "Regular123!"),
        "first_name": "Regular",
        "last_name": "User",
        "role": "member",
        "note": "Primary 'regular user' — hits every surface, low privileges",
    },
    {
        "email": testenv.get("E2E_POWER_EMAIL", "power_user@example.com"),
        "password": testenv.get("E2E_POWER_PASSWORD", "Power123!"),
        "first_name": "Power",
        "last_name": "User",
        "role": "editor",
        "note": "Has fileOps+rag+codeExecution, read_all_write_own",
    },
    {
        "email": testenv.get("E2E_VIEWER_EMAIL", "viewer@example.com"),
        "password": testenv.get("E2E_VIEWER_PASSWORD", "Viewer123!"),
        "first_name": "Viewer",
        "last_name": "Only",
        "role": "viewer",
        "note": "No fileOps, autonomy=plan, should be read-only",
    },
]

# ---------- agents (AgentSerializer shapes) ----------

# Model choice is deliberate and is a *demo reliability* decision, not a
# preference. Measured against the live NVIDIA endpoint, and re-measured
# 2026-09-04 after the previous pick died:
#
#   openai/gpt-oss-20b                     3/3   <- current pick
#   openai/gpt-oss-120b                    DEAD  end-of-life 2026-09-03
#   nvidia/nemotron-3.5-lightning-30b-a3b  2/3   times out
#   nvidia/nemotron-3-super-120b-a12b      2/3   "Service temporarily overloaded"
#   nvidia/nemotron-3-nano-30b-a3b         0/3   provider error
#   nvidia/nemotron-3-ultra-550b-a56b      0/3   404, not deployed
#
# The last three are all `is_active=True` in `nodes_aimodel`, so the catalogue
# advertises models the provider does not serve -- the same drift that once
# shipped six MCP connectors naming npm packages that were never published.
# A demo must not roll a coin in front of a stakeholder, so this pins the one
# that answered every time, and the table above is the evidence for re-picking
# when this one dies too.
FINANCE_AGENT: Dict[str, Any] = {
    "name": "Finance helper",
    "brief": "Reads invoices, extracts vendor/date/total, chases overdue ones. Keep tone concise.",
    "provider": testenv.get("E2E_DEMO_PROVIDER", "nvidia"),
    "model": testenv.get("E2E_DEMO_MODEL", "openai/gpt-oss-20b"),
    "temperature": 0.2,
    "fileAccess": "scoped",
    "tools": {"rag": True, "codeExecution": True, "webSearch": False, "scrape": False, "fileOps": True, "mcp": False, "shell": False},
    "autonomy": "ask",
    "spendCapRupees": 200,
    "egress": "none",
    "maxRunSeconds": 300,
    "compaction": True,
    "recursiveContext": False,
    "indexing": True,
    "allowUnattended": False,
    "trigger": "goal",
    # schedule empty → manual runs only
}

RESEARCHER_AGENT: Dict[str, Any] = {
    "name": "Researcher",
    "brief": "Researches a topic across 2-3 angles, reads pages, reports with sources. Cite every claim.",
    "provider": testenv.get("E2E_DEMO_PROVIDER", "nvidia"),
    "model": testenv.get("E2E_DEMO_MODEL", "openai/gpt-oss-20b"),
    "temperature": 0.4,
    "fileAccess": "readonly",
    "tools": {"rag": False, "codeExecution": False, "webSearch": True, "scrape": True, "fileOps": False, "mcp": False, "shell": False},
    "autonomy": "auto",
    "spendCapRupees": 300,
    "egress": "none",
    "maxRunSeconds": 600,
    "compaction": True,
    "recursiveContext": True,
    "indexing": True,
    "allowUnattended": False,
}

LIBRARIAN_AGENT: Dict[str, Any] = {
    "name": "Docs librarian",
    "brief": "Answers from the product documentation KB with citations. If unsure, say so.",
    "provider": testenv.get("E2E_DEMO_PROVIDER", "nvidia"),
    "model": testenv.get("E2E_DEMO_MODEL_SMALL", "openai/gpt-oss-20b"),
    "temperature": 0.2,
    "fileAccess": "readonly",
    "tools": {"rag": True, "codeExecution": False, "webSearch": False, "scrape": False, "fileOps": False, "mcp": False},
    "autonomy": "ask",
    "spendCapRupees": 150,
    "egress": "none",
    "maxRunSeconds": 300,
    "compaction": True,
    "indexing": True,
    "allowUnattended": False,
}

# Scheduled variant — used by trigger tests
SCHEDULED_AGENT_PATCH: Dict[str, Any] = {
    "allowUnattended": True,
    "schedule": "0 9 * * 1",  # Mondays 09:00
    "scheduleTimezone": "Asia/Kolkata",
    "trigger": "goal",
}

ALL_AGENTS = [FINANCE_AGENT, RESEARCHER_AGENT, LIBRARIAN_AGENT]

# ---------- knowledge / documents ----------

KB_DEFS: List[Dict[str, Any]] = [
    {"name": "Product Documentation", "description": "Guides, API refs and release notes (instance seed).", "is_default": True},
    {"name": "Finance Inbox", "description": "Invoices, receipts and statements (instance seed)."},
]

# filename, file_type, body — written to temp files then uploaded; also create KB association
DOCS: List[Dict[str, str]] = [
    {"kb": "Product Documentation", "name": "getting-started.md", "file_type": "md",
     "body": "# Getting started\n\nCreate an agent, give it a goal, hit run. Check Runs for the trace.\n\n## Quick steps\n1. Connections → enable what you need\n2. Documents → upload a file\n3. Agents → New agent → Save\n4. Runs → Execute with a goal\n"},
    {"kb": "Product Documentation", "name": "api-notes.md", "file_type": "md",
     "body": "# API notes\n\nAuth: `Authorization: Bearer <access>` from `POST /api/auth/login/`.\nToken 360m, refresh 7d. For SSE add `?token=<jwt>`.\n\n## Execute\nPOST /api/orchestrator/agents/{id}/execute/ {goal}\n→ 202 {execution_id}\n"},
    {"kb": "Finance Inbox", "name": "invoice-ACME-2026-03.md", "file_type": "md",
     "body": "# Invoice ACME-2026-03\n\nVendor: ACME Corp\nDate: 2026-03-15\nTotal: $4,800.00\nDue: 2026-04-14\n\nLine items:\n- Consulting 20h @ $200 = $4,000\n- Hosting $800\n\nStatus: OVERDUE\n"},
    {"kb": "Finance Inbox", "name": "invoice-GLOBEX-2026-04.md", "file_type": "md",
     "body": "# Invoice GLOBEX-2026-04\n\nVendor: Globex Inc\nDate: 2026-04-02\nTotal: $1,200.00\nDue: 2026-05-02\nStatus: PENDING\n"},
]

# Folder tree (name, parent_name or None) — mirrors inference/filesystem.py path=/<id>/ model
FOLDERS: List[Dict[str, Any]] = [
    {"name": "Reports", "parent": None},
    {"name": "Invoices", "parent": None},
    {"name": "Q1", "parent": "Reports"},
]

# ---------- permissions ----------

# Tool overlays — absent row = default; these are the non-default rows to create
TOOL_OVERLAYS: List[Dict[str, Any]] = [
    # power_user wants webSearch off workspace-wide (even though Researcher agent grants it)
    {"tool": "web_search", "enabled": False},
    # viewer wants everything muted except recall_context / read_tool_output (LOCKED)
    # — expressed as disabling categories; harness asserts LOCKED cannot be disabled
]

# Autonomy per persona/agent for permission tests
AUTONOMY_FIXTURES: List[Dict[str, Any]] = [
    {"persona": "regular_user@example.com", "agent": "Finance helper", "autonomy": "ask"},
    {"persona": "viewer@example.com", "agent": "Researcher", "autonomy": "plan"},
    {"persona": "power_user@example.com", "agent": "Researcher", "autonomy": "auto"},
]
