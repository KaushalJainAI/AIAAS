"""
API client for instance/ simulations — mimics a regular user's HTTP surface.

- Bearer JWT (auto-refresh on 401)
- X-API-Key alternative (after creating one)
- ?token= fallback for SSE
- Throttle-aware retry (429), typed helpers per journey stage
- Human-readable logs: method → status → latency, with truncated bodies

Usage:
    from instance.scripts.utils.api_client import InstanceClient
    c = InstanceClient(base="http://localhost:8000")
    c.register_or_login("demo_harness@example.com", "DummyPass123!")
    sess = c.create_chat_session("hello")
    c.stream_chat(sess["id"], "what is AIAAS?")
"""
from __future__ import annotations

import os
import json
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Optional
from urllib.parse import urljoin

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


DEFAULT_BASE = "http://localhost:8000"
TIMEOUT = 30


def _short(obj: Any, limit: int = 600) -> str:
    try:
        s = json.dumps(obj, ensure_ascii=False, default=str)
    except Exception:
        s = str(obj)
    return s if len(s) <= limit else s[:limit] + f"... (+{len(s)-limit} chars)"


@dataclass
class InstanceClient:
    base: str = DEFAULT_BASE
    access: Optional[str] = None
    refresh: Optional[str] = None
    api_key: Optional[str] = None
    email: Optional[str] = None
    verbose: bool = True
    session: requests.Session = field(default_factory=requests.Session, init=False)

    def __post_init__(self) -> None:
        self.base = self.base.rstrip("/")
        # retry on transient 429/5xx + connection errors
        retry = Retry(
            total=3,
            backoff_factor=0.5,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
            raise_on_status=False,
        )
        self.session.mount("http://", HTTPAdapter(max_retries=retry))
        self.session.mount("https://", HTTPAdapter(max_retries=retry))

    # ---------- low level ----------

    #: Presented so the backend judges this client a test client and applies the
    #: test-client rate lane rather than the human one
    #: (`core/http/throttling.py::is_test_client`). Read from the environment so
    #: it matches `Backend/.env.local` without being written down twice; when it
    #: is unset the header is simply absent and every harness is throttled like
    #: a person, which is the correct default.
    E2E_TOKEN_ENV = "E2E_THROTTLE_BYPASS_TOKEN"

    def _headers(
        self, extra: Optional[Dict[str, str]] = None, *, throttle_bypass: bool = True,
    ) -> Dict[str, str]:
        h: Dict[str, str] = {"Content-Type": "application/json"}
        if self.api_key:
            h["X-API-Key"] = self.api_key
        elif self.access:
            h["Authorization"] = f"Bearer {self.access}"
        if throttle_bypass and (token := os.environ.get(self.E2E_TOKEN_ENV, "")):
            h["X-E2E-Bypass-Token"] = token
        if extra:
            h.update(extra)
        return h

    def _log(self, method: str, path: str, status: int, ms: int, body: Any = None, err: str = "") -> None:
        if not self.verbose:
            return
        tag = "OK" if 200 <= status < 300 else "ERR"
        line = f"[{tag}] {method} {path} → {status} ({ms}ms)"
        if err:
            line += f"  {err}"
        print(line)
        if body is not None and status >= 400:
            print(f"      body: {_short(body)}")

    def request(
        self,
        method: str,
        path: str,
        *,
        json_body: Optional[Dict[str, Any]] = None,
        data: Optional[Dict[str, Any]] = None,
        files: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
        auth: bool = True,
        throttle_bypass: bool = True,
    ) -> requests.Response:
        """`throttle_bypass=False` makes this one call arrive as an ordinary
        client. The brute-force probe needs it: that probe asserts the 429 that
        protects login, and a probe exempt from the limit it is testing proves
        nothing."""
        url = urljoin(self.base + "/", path.lstrip("/"))
        hdrs = self._headers(headers, throttle_bypass=throttle_bypass) if auth else dict(headers or {})
        if not auth and throttle_bypass and (token := os.environ.get(self.E2E_TOKEN_ENV, "")):
            hdrs["X-E2E-Bypass-Token"] = token
        # for multipart, let requests set Content-Type
        if files is not None and "Content-Type" in hdrs:
            hdrs.pop("Content-Type", None)
        t0 = time.monotonic()
        try:
            resp = self.session.request(
                method, url,
                json=json_body if files is None else None,
                data=data,
                files=files,
                params=params,
                headers=hdrs,
                timeout=TIMEOUT,
            )
        except requests.RequestException as e:
            # friendly hint when backend is down (common when running the harness locally)
            hint = ""
            if "Failed to establish a new connection" in str(e) or "ConnectionRefused" in str(e):
                hint = f"  hint: backend not running at {self.base} — start it with:  cd Backend && python manage.py runserver 0.0.0.0:8000"
            print(f"[ERR] {method} {path} → network error: {e}{hint}")
            raise
        ms = int((time.monotonic() - t0) * 1000)

        # auto-refresh on 401 if we have a refresh token and weren't already refreshing
        if resp.status_code == 401 and self.refresh and auth and path != "/api/auth/token/refresh/":
            try:
                self.refresh_access()
                # retry once with new token
                hdrs = self._headers(headers)
                if files is not None and "Content-Type" in hdrs:
                    hdrs.pop("Content-Type", None)
                resp = self.session.request(
                    method, url,
                    json=json_body if files is None else None,
                    data=data, files=files, params=params,
                    headers=hdrs, timeout=TIMEOUT,
                )
                ms = int((time.monotonic() - t0) * 1000)
            except Exception:
                pass  # fall through to log original 401

        body: Any = None
        try:
            body = resp.json()
        except Exception:
            body = resp.text[:600] if resp.text else None
        self._log(method, path, resp.status_code, ms, body)
        return resp

    def _check(self, resp: requests.Response, ok=(200, 201, 202, 204)) -> Dict[str, Any]:
        if resp.status_code not in ok:
            try:
                detail = resp.json()
            except Exception:
                detail = resp.text[:800]
            raise RuntimeError(f"{resp.request.method} {resp.request.path_url} → {resp.status_code}: {_short(detail)}")
        if resp.status_code == 204 or not resp.content:
            return {}
        try:
            return resp.json()
        except Exception:
            return {"_raw": resp.text}

    # ---------- auth ----------

    def register(self, email: str, password: str, first_name: str = "Instance", last_name: str = "User") -> Dict[str, Any]:
        """POST /api/auth/register/ → stores access/refresh."""
        r = self.request("POST", "/api/auth/register/", json_body={
            "username": email, "email": email,
            "password": password, "password2": password,
            "first_name": first_name, "last_name": last_name,
        }, auth=False)
        data = self._check(r, ok=(201, 200))
        self.access = data.get("access")
        self.refresh = data.get("refresh")
        self.email = email
        return data

    def login(self, email: str, password: str) -> Dict[str, Any]:
        r = self.request("POST", "/api/auth/login/", json_body={"email": email, "password": password}, auth=False)
        data = self._check(r)
        self.access = data.get("access")
        self.refresh = data.get("refresh")
        self.email = email
        return data

    def register_or_login(self, email: str, password: str) -> Dict[str, Any]:
        """Idempotent: try register, fall back to login on 400 (already exists)."""
        r = self.request("POST", "/api/auth/register/", json_body={
            "username": email, "email": email, "password": password, "password2": password,
            "first_name": "Instance", "last_name": "User",
        }, auth=False)
        if r.status_code in (200, 201):
            data = r.json()
            self.access = data.get("access"); self.refresh = data.get("refresh"); self.email = email
            print(f"  → registered {email}")
            return data
        # already exists → login
        if r.status_code == 400:
            print(f"  → {email} exists, logging in")
            return self.login(email, password)
        self._check(r, ok=(201,))  # raise with detail
        return {}

    def refresh_access(self) -> None:
        assert self.refresh, "no refresh token"
        r = self.request("POST", "/api/auth/token/refresh/", json_body={"refresh": self.refresh}, auth=False)
        data = self._check(r)
        self.access = data.get("access") or data.get("access_token") or self.access
        if "refresh" in data:
            self.refresh = data["refresh"]

    def profile(self) -> Dict[str, Any]:
        r = self.request("GET", "/api/auth/profile/")
        return self._check(r)

    # ---------- LLM ----------

    def llm_models(self) -> Dict[str, Any]:
        r = self.request("GET", "/api/llm/models/")
        return self._check(r)

    # ---------- chat ----------

    def create_chat_session(self, title: str = "Instance chat", memory_enabled: bool = True,
                            provider: Optional[str] = None,
                            model: Optional[str] = None) -> Dict[str, Any]:
        """Create a chat session, naming the model it should use.

        The provider/model are passed explicitly because `ChatSession` defaults
        to `openrouter` / `openrouter/free` at the *column*, and creating a
        session does not inherit the user's `UserProfile.llm_provider`. So a
        persona seeded onto NVIDIA still gets an OpenRouter session, and on an
        install with no `OPENROUTER_API_KEY` every turn dies at preflight with
        "No verified OpenRouter credential" -- which is the correct, actionable
        error, for a model nobody chose.

        Defaults come from `instance/test.env` (`E2E_DEMO_*`), so the chat
        surface and the agent surface are pinned by the same two lines.
        """
        body: Dict[str, Any] = {"title": title, "memory_enabled": memory_enabled}
        if provider is None or model is None:
            from instance.scripts.utils import testenv
            provider = provider or testenv.get("E2E_DEMO_PROVIDER", "nvidia")
            model = model or testenv.get("E2E_DEMO_MODEL", "openai/gpt-oss-20b")
        body["llm_provider"] = provider
        body["llm_model"] = model
        r = self.request("POST", "/api/chat/sessions/", json_body=body)
        return self._check(r, ok=(201, 200))

    def list_chat_sessions(self) -> Any:
        r = self.request("GET", "/api/chat/sessions/")
        return self._check(r)

    def upload_to_chat(self, session_id: str, filename: str, content: bytes, content_type: str = "text/plain") -> Dict[str, Any]:
        r = self.request("POST", f"/api/chat/sessions/{session_id}/upload/", files={"file": (filename, content, content_type)})
        return self._check(r, ok=(201, 200))

    def stream_chat(self, session_id: str, content: str, intent: str = "chat", **kw: Any) -> Dict[str, Any]:
        """
        POST /api/chat/sessions/{id}/message/stream/ and collect SSE frames.
        Returns the final DONE payload (or raises on ERROR frame).
        For a live harness, iterate SSE with iter_sse() instead.
        """
        body = {"content": content, "intent": intent, **kw}
        url = urljoin(self.base + "/", f"api/chat/sessions/{session_id}/message/stream/".lstrip("/"))
        headers = self._headers({"Accept": "text/event-stream"})
        if self.verbose:
            print(f"  → streaming chat: {content[:80]!r}")
        resp = self.session.post(url, json=body, headers=headers, timeout=90, stream=True)
        return self._collect_sse(resp)

    def _collect_sse(self, resp: requests.Response) -> Dict[str, Any]:
        if resp.status_code not in (200, 201):
            raise RuntimeError(f"SSE {resp.status_code}: {resp.text[:800]}")
        final: Dict[str, Any] = {}
        for line in resp.iter_lines(decode_unicode=True):
            if not line or not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if not payload:
                continue
            try:
                evt = json.loads(payload)
            except Exception:
                continue
            etype = evt.get("type") or evt.get("event") or ""
            if etype == "error":
                raise RuntimeError(f"SSE error frame: {evt}")
            if etype in ("done", "DONE"):
                final = evt
                break
            # keep last relevant frame for non-streaming callers
            final = evt
        return final

    # ---------- folders / docs / RAG ----------

    def create_folder(self, name: str, parent_id: Optional[int] = None) -> Dict[str, Any]:
        r = self.request("POST", "/api/inference/folders/", json_body={"name": name, "parent_id": parent_id})
        return self._check(r, ok=(201, 200))

    def list_folders(self, parent_id: Optional[int] = None) -> Dict[str, Any]:
        params = {"parent": parent_id} if parent_id is not None else None
        r = self.request("GET", "/api/inference/folders/", params=params)
        return self._check(r)

    def upload_document(self, filename: str, content: bytes, *, folder_id: Optional[int] = None, kb_id: Optional[int] = None) -> Dict[str, Any]:
        data: Dict[str, Any] = {}
        if folder_id is not None:
            data["folder_id"] = str(folder_id)
        if kb_id is not None:
            data["kb_id"] = str(kb_id)
        r = self.request("POST", "/api/inference/documents/", data=data, files={"file": (filename, content)})
        return self._check(r, ok=(201, 200))

    def list_documents(self, **kw: Any) -> Dict[str, Any]:
        r = self.request("GET", "/api/inference/documents/", params=kw or None)
        return self._check(r)

    def rag_search(self, query: str, top_k: int = 5, kb_id: Optional[int] = None) -> Dict[str, Any]:
        body: Dict[str, Any] = {"query": query, "top_k": top_k}
        if kb_id is not None:
            body["kb_id"] = kb_id
        r = self.request("POST", "/api/inference/rag/search/", json_body=body)
        return self._check(r)

    def get_or_create_kb(self, name: str, description: str = "") -> Dict[str, Any]:
        # list then create if missing — KB name unique per user
        r = self.request("GET", "/api/inference/knowledge-bases/", params=None)  # may be /api/inference/kbs/ depending on urls
        # Try both routes; inference app exposes KBs; fallback: GET documents lists KBs implicitly
        # For resilience, attempt POST directly — 400 with "already exists" → fetch from list
        r2 = self.request("POST", "/api/inference/knowledge-bases/", json_body={"name": name, "description": description or f"Instance KB: {name}"})
        if r2.status_code in (201, 200):
            return self._check(r2, ok=(201, 200))
        # if 400 already exists, list and find
        try:
            data = self._check(r2, ok=(201, 200))
            return data
        except RuntimeError:
            pass
        # fallback: pretend KB id 1 and continue — caller can pass kb_id=None
        return {"id": None, "name": name}

    # ---------- agents ----------

    def create_agent(self, cfg: Dict[str, Any]) -> Dict[str, Any]:
        r = self.request("POST", "/api/orchestrator/agents/", json_body=cfg)
        return self._check(r, ok=(201, 200))

    def list_agents(self) -> Any:
        r = self.request("GET", "/api/orchestrator/agents/")
        return self._check(r)

    def get_agent(self, agent_id: int) -> Dict[str, Any]:
        r = self.request("GET", f"/api/orchestrator/agents/{agent_id}/")
        return self._check(r)

    def update_agent(self, agent_id: int, patch: Dict[str, Any]) -> Dict[str, Any]:
        r = self.request("PATCH", f"/api/orchestrator/agents/{agent_id}/", json_body=patch)
        return self._check(r)

    def execute_agent(self, agent_id: int, goal: str, thread_id: Optional[str] = None) -> Dict[str, Any]:
        body: Dict[str, Any] = {"goal": goal}
        if thread_id:
            body["thread_id"] = thread_id
        r = self.request("POST", f"/api/orchestrator/agents/{agent_id}/execute/", json_body=body)
        if r.status_code == 402:
            # spend/credential refusal — return the JSON for caller to assert UX
            try:
                return {"_refused": True, **r.json()}
            except Exception:
                return {"_refused": True, "status": 402, "text": r.text[:600]}
        return self._check(r, ok=(202, 200, 201))

    def approve_tool(self, agent_id: int, thread_id: str, call_id: str, scope: str = "once") -> Dict[str, Any]:
        r = self.request("POST", f"/api/orchestrator/agents/{agent_id}/approve/", json_body={
            "thread_id": thread_id, "call_id": call_id, "scope": scope,
        })
        return self._check(r)

    def reject_tool(self, agent_id: int, thread_id: str, call_id: str, reason: str = "") -> Dict[str, Any]:
        r = self.request("POST", f"/api/orchestrator/agents/{agent_id}/reject/", json_body={
            "thread_id": thread_id, "call_id": call_id, "reason": reason,
        })
        return self._check(r)

    def steer_agent(self, agent_id: int, message: str) -> Dict[str, Any]:
        r = self.request("POST", f"/api/orchestrator/agents/{agent_id}/steer/", json_body={"message": message})
        return self._check(r)

    # ---------- triggers / schedules ----------

    def create_trigger(self, cfg: Dict[str, Any]) -> Dict[str, Any]:
        r = self.request("POST", "/api/orchestrator/triggers/", json_body=cfg)
        return self._check(r, ok=(201, 200))

    def preview_trigger(self, cron: str, timezone: str = "UTC") -> Dict[str, Any]:
        r = self.request("POST", "/api/orchestrator/triggers/preview/", json_body={"cron": cron, "timezone": timezone})
        return self._check(r)

    def list_triggers(self) -> Dict[str, Any]:
        r = self.request("GET", "/api/orchestrator/triggers/")
        return self._check(r)

    # ---------- tools / MCP / logs ----------

    def list_tools(self) -> Dict[str, Any]:
        r = self.request("GET", "/api/tools/")
        return self._check(r)

    def patch_tools(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        r = self.request("PATCH", "/api/tools/", json_body=payload)
        return self._check(r)

    def list_mcp_servers(self) -> Dict[str, Any]:
        r = self.request("GET", "/api/mcp/servers/")
        return self._check(r)

    def set_mcp_enabled(self, server_id: int, enabled: bool) -> Dict[str, Any]:
        r = self.request("POST", f"/api/mcp/servers/{server_id}/set-enabled/", json_body={"enabled": enabled})
        return self._check(r)

    def list_executions(self, **kw: Any) -> Dict[str, Any]:
        r = self.request("GET", "/api/logs/executions/", params=kw or None)
        return self._check(r)

    def get_execution(self, execution_id: str) -> Dict[str, Any]:
        r = self.request("GET", f"/api/logs/executions/{execution_id}/")
        return self._check(r)

    def wait_for_execution(self, execution_id: str, timeout_s: int = 90, poll_s: float = 2.0) -> Dict[str, Any]:
        deadline = time.monotonic() + timeout_s
        last: Dict[str, Any] = {}
        while time.monotonic() < deadline:
            try:
                last = self.get_execution(execution_id)
            except Exception as e:
                print(f"  … poll {execution_id[:8]}: {e}")
                time.sleep(poll_s)
                continue
            status = (last.get("status") or last.get("execution", {}).get("status") or "").lower()
            if status in ("completed", "failed", "cancelled", "timeout"):
                if self.verbose:
                    print(f"  → execution {execution_id[:8]} {status}")
                return last
            if self.verbose:
                print(f"  … {execution_id[:8]} {status or 'running'}")
            time.sleep(poll_s)
        print(f"  !! wait_for_execution {execution_id[:8]} timed out after {timeout_s}s")
        return last
