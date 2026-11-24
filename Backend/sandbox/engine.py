"""One door to code execution, whichever engine is configured.

Two engines exist and they are chosen by config, never by accident:

- ``service`` — the hardened sidecar container (`sandbox_service/`). Real
  kernel-level confinement, and C extensions (numpy/pandas) work. This is the
  production path; docker-compose sets `SANDBOX_ENGINE=service`.
- ``inprocess`` — the AST-guarded `exec`-on-a-thread engine in
  `safe_execution.py`. It is the *local-dev fallback only* (Windows has none of
  the POSIX primitives the sidecar needs), and it is explicitly the weaker of
  the two: an AST denylist is not a real isolation boundary. Nothing in
  production should select it.

`SANDBOX_ENGINE` decides. It defaults to ``inprocess`` so a bare `manage.py
runserver` with no sidecar still works; the deployed image sets it to
``service``. There is deliberately **no automatic fallback** from service to
in-process — if the sidecar is down, a run fails loudly rather than quietly
dropping to the weaker engine.

Both engines return the same envelope: ``success``, ``result``, ``output``,
``stderr``, ``error``, ``timed_out`` — plus ``files_out`` (``{name: bytes}``),
``missing`` and ``unsaved`` when ``collect`` is given.

Two things exist only on the sidecar, because nothing in-process could confine
them: JavaScript/TypeScript (`arun_code(language=...)`, on Node) and
`arun_commands`, a pipeline of allowlisted text commands. On the in-process
engine they return a failed envelope, and the tools that use them are not
offered at all (`sidecar_available`).
"""
from __future__ import annotations

from django.conf import settings


def _engine() -> str:
    return getattr(settings, "SANDBOX_ENGINE", "inprocess")


def sidecar_available() -> bool:
    """Whether the hardened sidecar is the configured engine.

    JavaScript and `run_command` exist only there: the in-process engine is an
    AST guard around Python's own `exec`, with nothing that could confine Node
    or a native program, so on it those tools are withheld rather than run
    unconfined on the developer's machine.
    """
    return _engine() == "service"


def _sidecar_only(what: str) -> dict:
    return {
        "success": False,
        "result": None,
        "output": "",
        "stderr": "",
        "error": f"{what} needs the sandbox service (SANDBOX_ENGINE=service).",
        "timed_out": False,
    }


async def arun_code(
    code: str,
    *,
    language: str = "python",
    files: dict[str, bytes] | None = None,
    collect: tuple[str, ...] | list[str] = (),
) -> dict:
    """Execute `code` through the configured engine. Async.

    `language` is `python`, `javascript` or `typescript`; the last two run
    only on the sidecar. `files` are inputs written into the run's ephemeral
    cwd before the child starts (`{bare name: bytes}`); `collect` names the
    outputs to read back afterwards. Both engines share the envelope so
    callers treat them the same; the sidecar enforces its own caps and the
    in-process engine mirrors them. There is no fallback between engines —
    see the module docstring.
    """
    if _engine() == "service":
        from .service_client import run_via_service
        return await run_via_service(code, language=language, files=files, collect=collect)

    if language != "python":
        return _sidecar_only("JavaScript")

    from asgiref.sync import sync_to_async
    from .safe_execution import get_sandbox

    # The in-process engine joins a worker thread; keep the event loop free.
    # Not thread_sensitive: it touches no ORM and must not queue behind the
    # request's own executor.
    outcome = await sync_to_async(get_sandbox().execute, thread_sensitive=False)(
        code, files=files, collect=collect
    )
    outcome.setdefault("timed_out", False)
    return outcome


async def arun_commands(
    pipeline: list[dict],
    *,
    stdin: str = "",
    files: dict[str, bytes] | None = None,
) -> dict:
    """Run a pipeline of allowlisted commands on the sidecar. Async.

    `pipeline` is `[{"command": name, "args": [...]}, ...]`; the sidecar's
    `commands.py` is the allowlist and refuses anything else with a reason.
    The envelope adds `exit_codes`, one per stage. Sidecar only: there is no
    in-process way to run a native program confined.
    """
    if _engine() != "service":
        return _sidecar_only("run_command")
    from .service_client import run_commands_via_service
    return await run_commands_via_service(pipeline, stdin=stdin, files=files)
