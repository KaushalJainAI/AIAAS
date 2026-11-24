"""Spawn one locked-down subprocess per snippet and collect its envelope.

This is the parent side of `runner.py`. It is importable and testable on its
own (the tests exercise it directly), and it is what `server.py` calls per
request.

What confines a run, from outermost to innermost:

1. The *container* (Dockerfile + compose): no network egress, `cap_drop: ALL`,
   read-only root, non-root user, memory + pids caps. This is the real boundary
   — a full breakout of the interpreter still lands in a throwaway container
   with no secrets and nowhere to go.
2. This module: a fresh process in its own session (so a fork bomb dies with
   `killpg`), `setrlimit` for CPU/address-space/file-size/core, a scrubbed
   environment, and an ephemeral cwd removed afterwards.
3. `runner.py` (Python): a best-effort seccomp filter blocking socket
   creation and `execve`, so a snippet cannot start a shell or any other
   program. `launch.py` (Node and command pipelines): the same network block,
   plus a filter that lets each process `execve` exactly once — to start the
   program we chose — and fails closed if the filter cannot be installed.

**Files.** A run may be handed input files and asked for output files. Both
live in the run's own ephemeral cwd and nowhere else: inputs are written there
before the child starts, and after it exits only the *declared* output names
are read back — regular files only (a symlink the snippet made to somewhere
else is refused, not followed), each under `MAX_FILE_BYTES`, which the child's
own `RLIMIT_FSIZE` already enforces as it writes. Anything else the snippet
created is listed in `unsaved` and deleted with the directory, so a model is
told its extra file was not kept rather than left to believe it was. Names are
bare file names: a separator, `..` or a leading dot is refused before anything
is written.

`setrlimit`, `setsid` and `killpg` are POSIX-only; on Windows (local dev, where
the service does not run) they degrade to a plain timeout-and-kill so the tests
still exercise the envelope plumbing.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile

from commands import validate

_POSIX = os.name == "posix"

if _POSIX:
    import resource  # noqa: E402  (POSIX-only)

RUNNER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "runner.py")
#: The harness for everything that is not Python (Node, command pipelines).
LAUNCHER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "launch.py")
NODE = "/usr/local/bin/node"

#: What `execute` accepts as `language`.
LANGUAGES = ("python", "javascript", "typescript")

# The env a snippet is allowed to see. Nothing from the service's own
# environment leaks in — not that the container holds secrets, but a scrubbed
# env is one less thing to reason about. Threads pinned to 1 so a BLAS call in
# numpy cannot fan out across every core on a shared box.
_BASE_ENV = {
    "PATH": "/usr/local/bin:/usr/bin:/bin",
    "PYTHONHASHSEED": "0",
    "OMP_NUM_THREADS": "1",
    "OPENBLAS_NUM_THREADS": "1",
    "MKL_NUM_THREADS": "1",
    "NUMEXPR_NUM_THREADS": "1",
    "HOME": "/tmp",
    "TMPDIR": "/tmp",
    "LANG": "C.UTF-8",
}

#: One input or output file. Matches the child's RLIMIT_FSIZE default below, so
#: a file the snippet could write is a file that can come back.
MAX_FILE_BYTES = 16 * 1024 * 1024
#: Files per run, in each direction.
MAX_FILES = 10
#: A bare file name: no separators, no NUL, not `.`/`..`, no leading dot.
_NAME = re.compile(r'^(?!\.)[^/\\\x00]{1,128}$')


class FileSpecError(ValueError):
    """A request the executor refuses before running: a bad file name or
    size, or a language it does not have. The message goes back as a 400."""


def check_name(name: str) -> str:
    if not isinstance(name, str) or not _NAME.match(name) or name in ('.', '..'):
        raise FileSpecError(f'{name!r} is not a plain file name.')
    return name


_TIMEOUT_ENVELOPE = {
    "success": False,
    "result": None,
    "output": "",
    "stderr": "",
    "error": None,
    "timed_out": True,
}


def _limits(cpu_seconds: int, mem_bytes: int, fsize_bytes: int, *, data_limit: bool = False):
    """Return a preexec_fn applying rlimits, or None off POSIX.

    `data_limit` caps memory with `RLIMIT_DATA` instead of `RLIMIT_AS`. Node
    needs it: V8 reserves far more address space than it ever touches, so a
    256 MB `RLIMIT_AS` kills it before it prints a line (measured: it needs
    ~1 GB of address space to start). `RLIMIT_DATA` counts what is actually
    allocated, and a 600 MB allocation under a 256 MB cap fails as it should.
    """
    if not _POSIX:
        return None

    def _set():
        os.setsid()  # own process group, so killpg reaps children/threads
        # Hard CPU ceiling: even if the wall-clock kill is missed, the kernel
        # sends SIGXCPU. Soft one second under hard so a snippet can catch it.
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds + 1))
        memory = resource.RLIMIT_DATA if data_limit else resource.RLIMIT_AS
        resource.setrlimit(memory, (mem_bytes, mem_bytes))
        resource.setrlimit(resource.RLIMIT_FSIZE, (fsize_bytes, fsize_bytes))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))

    return _set


def _check_files(files, collect) -> tuple[dict[str, bytes], list[str]]:
    files = dict(files or {})
    collect = list(dict.fromkeys(collect or ()))
    if len(files) > MAX_FILES or len(collect) > MAX_FILES:
        raise FileSpecError(f'At most {MAX_FILES} input and {MAX_FILES} output files per run.')
    for name, data in files.items():
        check_name(name)
        if len(data) > MAX_FILE_BYTES:
            raise FileSpecError(f'{name} is over the {MAX_FILE_BYTES // 1_048_576} MB file limit.')
    for name in collect:
        check_name(name)
    return files, collect


def _linux_only(what: str) -> dict:
    """The envelope for a non-Python run on a host without the POSIX
    primitives (local Windows dev): refused, never run unconfined."""
    return {
        "success": False,
        "result": None,
        "output": "",
        "stderr": "",
        "error": f"{what} runs only in the Linux sandbox container.",
        "timed_out": False,
    }


def _spawn(argv: list[str], stdin_bytes: bytes, workdir: str, *, wall_seconds: int,
           preexec, max_output: int) -> dict:
    """Run one harness process in `workdir`; the envelope it wrote, or a timeout."""
    proc = subprocess.Popen(
        argv,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=workdir,
        env=_BASE_ENV,
        preexec_fn=preexec,
        start_new_session=not _POSIX,  # POSIX uses setsid in preexec instead
    )
    try:
        stdout, stderr = proc.communicate(input=stdin_bytes, timeout=wall_seconds)
    except subprocess.TimeoutExpired:
        _kill(proc)
        stdout, stderr = proc.communicate()
        env = dict(_TIMEOUT_ENVELOPE)
        env["error"] = f"Execution timed out after {wall_seconds}s and was killed."
        env["stderr"] = (stderr or b"").decode("utf-8", "replace")[:max_output]
        return env
    return _parse(stdout, stderr, proc.returncode, max_output)


def _node_argv(language: str, workdir: str, mem_bytes: int) -> list[str]:
    """Node, confined by its own permission model on top of the exec guard.

    `--permission` refuses child processes, worker threads, native addons and
    WASI, and file access outside the run's own directory. The heap is capped
    below the memory limit so a runaway array is a JavaScript out-of-memory
    error with a message, not a kill with none.

    Plain JavaScript gets no `--input-type`, so Node picks CommonJS or ES
    module syntax from the code itself (`require` and `import` both work).
    TypeScript is stripped by Node itself, with no compiler in the image, and
    runs as an ES module; `--experimental-transform-types` adds the parts that
    are not just erasing types (enums, namespaces).
    """
    heap_mb = max(32, (mem_bytes * 3 // 4) >> 20)
    argv = [
        NODE,
        "--permission",
        f"--allow-fs-read={workdir}",
        f"--allow-fs-write={workdir}",
        f"--max-old-space-size={heap_mb}",
        "--disable-warning=ExperimentalWarning",
    ]
    if language == "typescript":
        argv += ["--experimental-transform-types", "--input-type=module-typescript"]
    argv.append("-")
    return argv


def execute(
    code: str,
    *,
    language: str = "python",
    wall_seconds: int = 10,
    cpu_seconds: int = 8,
    mem_bytes: int = 512 * 1024 * 1024,
    fsize_bytes: int = MAX_FILE_BYTES,
    max_output: int = 200_000,
    files: dict[str, bytes] | None = None,
    collect: tuple[str, ...] | list[str] = (),
) -> dict:
    """Run `code` in a subprocess and return the normalized envelope.

    The contract mirrors the in-process engine so `sandbox.engine` can treat
    both the same: keys `success`, `result`, `output`, `stderr`, `error`,
    `timed_out` — plus `files_out` (`{name: bytes}`), `missing` (declared
    outputs the snippet did not write) and `unsaved` (files it wrote without
    declaring) when `collect` is given.

    `language` is `python` (runner.py) or `javascript`/`typescript` (Node,
    through launch.py's exec guard). A JavaScript run has no `result`
    variable: what it prints is the answer.
    """
    if language not in LANGUAGES:
        raise FileSpecError(f'Unknown language {language!r}. Supported: {", ".join(LANGUAGES)}.')
    files, collect = _check_files(files, collect)
    if language != "python" and not _POSIX:
        return _linux_only("JavaScript")

    workdir = tempfile.mkdtemp(prefix="sbx-")
    try:
        for name, data in files.items():
            with open(os.path.join(workdir, name), 'wb') as handle:
                handle.write(data)

        if language == "python":
            env = _spawn(
                [sys.executable, "-I", "-B", RUNNER], code.encode("utf-8"), workdir,
                wall_seconds=wall_seconds, max_output=max_output,
                preexec=_limits(cpu_seconds, mem_bytes, fsize_bytes),
            )
        else:
            request = {
                "stages": [_node_argv(language, workdir, mem_bytes)],
                "stdin": code,
                "max_output": max_output,
            }
            env = _spawn(
                [sys.executable, "-I", "-B", LAUNCHER], json.dumps(request).encode("utf-8"),
                workdir, wall_seconds=wall_seconds, max_output=max_output,
                preexec=_limits(cpu_seconds, mem_bytes, fsize_bytes, data_limit=True),
            )
            env = _program_outcome(env)
            # Echoed so the backend can tell this sidecar from one that
            # predates `language`, which would ignore the field and run the
            # JavaScript as Python (`sandbox/service_client.py` checks it).
            env["language"] = language

        if collect and env.get("success"):
            env.update(_collect(workdir, collect, set(files)))
        return env
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def _program_outcome(env: dict) -> dict:
    """A one-program launch as a code run: it succeeded if it exited 0."""
    codes = env.pop("exit_codes", None) or []
    if env.get("success") and codes != [0]:
        env["success"] = False
        code = codes[0] if codes else None
        if env.get("error") is None:
            tail = (env.get("stderr") or "").strip()
            if code is not None and code < 0:
                env["error"] = f"Killed by signal {-code} (likely the memory or CPU limit)."
            else:
                env["error"] = tail[-4000:] or f"Exited with code {code}."
    return env


def execute_commands(
    pipeline,
    *,
    stdin: str = "",
    wall_seconds: int = 10,
    cpu_seconds: int = 8,
    mem_bytes: int = 512 * 1024 * 1024,
    fsize_bytes: int = MAX_FILE_BYTES,
    max_output: int = 200_000,
    files: dict[str, bytes] | None = None,
) -> dict:
    """Run a pipeline of allowlisted commands over `files` and `stdin`.

    `commands.validate` turns the request into argv lists or raises
    `CommandRefused`; `launch.py` runs them with no shell and the exec guard.
    `success` means the pipeline ran; each stage's exit status is in
    `exit_codes` (grep finding nothing exits 1, which is an answer, not a
    failure — the caller decides).
    """
    stages = validate(pipeline)
    files, _ = _check_files(files, ())
    if not _POSIX:
        return _linux_only("A command")

    workdir = tempfile.mkdtemp(prefix="sbx-")
    try:
        for name, data in files.items():
            with open(os.path.join(workdir, name), 'wb') as handle:
                handle.write(data)
        request = {"stages": stages, "stdin": stdin or "", "max_output": max_output}
        env = _spawn(
            [sys.executable, "-I", "-B", LAUNCHER], json.dumps(request).encode("utf-8"),
            workdir, wall_seconds=wall_seconds, max_output=max_output,
            preexec=_limits(cpu_seconds, mem_bytes, fsize_bytes),
        )
        env.setdefault("exit_codes", [])
        return env
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def _collect(workdir: str, collect: list[str], inputs: set[str]) -> dict:
    """Read the declared outputs back; name everything else as unsaved."""
    out: dict[str, bytes] = {}
    missing: list[str] = []
    for name in collect:
        path = os.path.join(workdir, name)
        try:
            info = os.lstat(path)
        except FileNotFoundError:
            missing.append(name)
            continue
        # lstat, not stat: a symlink the snippet planted is refused rather
        # than followed to whatever it points at.
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_FILE_BYTES:
            missing.append(name)
            continue
        with open(path, 'rb') as handle:
            out[name] = handle.read(MAX_FILE_BYTES + 1)
    unsaved = sorted(
        entry for entry in os.listdir(workdir)
        if entry not in out and entry not in inputs and entry not in missing
    )
    return {"files_out": out, "missing": missing, "unsaved": unsaved[:20]}


def _kill(proc: subprocess.Popen) -> None:
    import signal
    try:
        if _POSIX:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        else:
            proc.kill()
    except (ProcessLookupError, PermissionError, OSError):
        pass


def _parse(stdout: bytes, stderr: bytes, returncode: int, max_output: int) -> dict:
    text = (stdout or b"").decode("utf-8", "replace").strip()
    err_text = (stderr or b"").decode("utf-8", "replace")

    # Normal path: runner.py wrote one JSON envelope to stdout.
    if text:
        try:
            env = json.loads(text)
            if isinstance(env, dict) and "success" in env:
                env.setdefault("timed_out", False)
                env["output"] = (env.get("output") or "")[:max_output]
                env["stderr"] = (env.get("stderr") or "")[:max_output]
                return env
        except (ValueError, TypeError):
            pass

    # The child died before it could emit an envelope (OOM-killed, SIGXCPU,
    # seccomp trap, segfault in a C extension). Report it as a failure with
    # whatever the kernel/interpreter left on stderr.
    detail = err_text.strip() or f"Process exited with code {returncode} before returning a result."
    return {
        "success": False,
        "result": None,
        "output": "",
        "stderr": err_text[:max_output],
        "error": detail[:max_output],
        "timed_out": False,
    }
