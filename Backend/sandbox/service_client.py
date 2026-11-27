"""Backend-side client for the sandbox sidecar (`sandbox_service/`).

The sidecar is a separate hardened container reachable only over the internal
docker network. This module POSTs a snippet to it and normalizes the reply into
the same envelope the in-process engine returns, so `sandbox.engine` can treat
the two interchangeably.

A network or service failure is reported as a failed run, never as a silent
fall-through to the weaker in-process engine — downgrading the sandbox because
a container is momentarily unreachable is exactly the kind of quiet security
regression this whole change exists to remove. The engine choice is explicit
config; only config changes it.
"""
from __future__ import annotations

import logging

import httpx
from django.conf import settings

logger = logging.getLogger(__name__)


def _service_url() -> str:
    return getattr(settings, "SANDBOX_SERVICE_URL", "http://sandbox:8100").rstrip("/")


def _limits() -> tuple[int, dict]:
    wall = int(getattr(settings, "SANDBOX_WALL_SECONDS", 10))
    cpu = int(getattr(settings, "SANDBOX_CPU_SECONDS", 8))
    mem_mb = int(getattr(settings, "SANDBOX_MEM_MB", 384))
    return wall, {"wall_seconds": wall, "cpu_seconds": cpu, "mem_mb": mem_mb}


def _encode_files(payload: dict, files: dict[str, bytes] | None) -> None:
    import base64

    if files:
        payload["files"] = {
            name: base64.b64encode(data).decode("ascii")
            for name, data in files.items()
        }


async def run_via_service(
    code: str,
    *,
    language: str = "python",
    files: dict[str, bytes] | None = None,
    collect: tuple[str, ...] | list[str] = (),
) -> dict:
    """Execute `code` on the sidecar. Returns the normalized envelope.

    `files` are base64-encoded into the request; `files_out` are decoded back
    on the way out. A sidecar that predates files simply omits them, which is
    backfilled below — the same rule as every other optional key. `language`
    is sent only when it is not Python, so a Python run is byte-for-byte the
    request it always was.
    """
    wall, payload = _limits()
    payload["code"] = code
    if language != "python":
        payload["language"] = language
    _encode_files(payload, files)
    if collect:
        payload["collect"] = list(collect)
    env = await _post("/execute", payload, wall)
    # A sidecar older than `language` ignores the field and runs the code as
    # Python, answering with a SyntaxError that reads like the model's bug.
    # The new sidecar echoes the language; no echo means an old image.
    if (language != "python" and env.get("language") != language
            # Our own transport failures (`_fail`) carry no echo either.
            and not (env.get("error") or "").startswith(
                ("Sandbox error", "The sandbox", "The code sandbox"))):
        return _fail("The sandbox service is out of date and cannot run "
                     f"{language}; the sidecar image needs updating.")
    return env


async def run_commands_via_service(
    pipeline: list[dict],
    *,
    stdin: str = "",
    files: dict[str, bytes] | None = None,
) -> dict:
    """Run an allowlisted command pipeline on the sidecar (`POST /commands`).

    A pipeline the sidecar refuses comes back as a 400 whose reason names
    the command or flag, surfaced as `Sandbox error: <reason>.`
    """
    wall, payload = _limits()
    payload["pipeline"] = pipeline
    if stdin:
        payload["stdin"] = stdin
    _encode_files(payload, files)
    env = await _post("/commands", payload, wall)
    env.setdefault("exit_codes", [])
    return env


async def _post(path: str, payload: dict, wall: int) -> dict:
    import base64

    # The HTTP read timeout sits above the sandbox's own wall-clock so the
    # in-container kill is what ends a runaway run, not a dropped connection
    # that leaves the subprocess orphaned.
    http_timeout = wall + 10

    try:
        async with httpx.AsyncClient(timeout=http_timeout) as client:
            resp = await client.post(f"{_service_url()}{path}", json=payload)
            resp.raise_for_status()
            env = resp.json()
    except httpx.TimeoutException:
        return _fail("The sandbox did not respond in time.")
    except httpx.HTTPStatusError as exc:
        # A 400 here is the sidecar refusing the request (bad file name, too
        # many files, a command not on the allowlist) — surface its reason
        # rather than a generic "rejected".
        if exc.response.status_code == 400:
            try:
                detail = exc.response.json().get("error") or "bad request"
            except Exception:
                detail = "bad request"
            return _fail(f"Sandbox error: {detail}")
        if exc.response.status_code == 404 and path != "/execute":
            # A sidecar image older than this route: say so, not "rejected".
            return _fail("The sandbox service is out of date and cannot run this; "
                         "the sidecar image needs updating.")
        detail = "sandbox is busy" if exc.response.status_code == 503 else "sandbox rejected the request"
        return _fail(f"Sandbox error: {detail}.")
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("[sandbox] service call failed: %s", exc)
        return _fail("The code sandbox is unavailable right now.")

    # Trust the shape but backfill anything an older sidecar might omit.
    if not isinstance(env, dict):
        return _fail("The sandbox returned an unexpected response.")
    env.setdefault("success", False)
    env.setdefault("result", None)
    env.setdefault("output", "")
    env.setdefault("stderr", "")
    env.setdefault("error", None)
    env.setdefault("timed_out", False)
    # Decode what the sidecar encoded; a failure to decode is a failure of the
    # run, not of the transport — the bytes are the result.
    if isinstance(env.get("files_out"), dict):
        decoded: dict[str, bytes] = {}
        try:
            for name, data in env["files_out"].items():
                decoded[str(name)] = base64.b64decode(data, validate=True)
        except Exception:
            return _fail("The sandbox returned a file that could not be read.")
        env["files_out"] = decoded
    else:
        env.setdefault("files_out", {})
    env.setdefault("missing", [])
    env.setdefault("unsaved", [])
    return env


def _fail(message: str) -> dict:
    return {
        "success": False,
        "result": None,
        "output": "",
        "stderr": "",
        "error": message,
        "timed_out": False,
    }
