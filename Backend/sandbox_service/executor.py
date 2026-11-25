"""Spawn one locked-down subprocess per snippet and collect its envelope.

This is the parent side of `runner.py` and `launch.py`. It is importable and
testable on its own (the tests exercise it directly), and it is what
`server.py` calls per request.

What confines a run, from outermost to innermost:

1. The *container* (Dockerfile + compose): no network egress, every
   capability dropped except the four this module needs to switch users and
   manage the run's folder, read-only root, memory + pids caps. This is the
   real boundary — a full breakout of the interpreter still lands in a
   throwaway container with no secrets and nowhere to go.
2. **A Unix user per slot.** The server holds a few concurrency slots; slot
   *n* runs as uid/gid `20000 + n` (`sbxN` in the Dockerfile), never as the
   server's own user. The run's folder belongs to that user alone (mode 0700)
   and `/tmp` itself cannot be listed, so a run cannot see another slot's
   files. Before and after every run, every process that user owns is killed
   (`_reap`), so nothing a run started — a daemon that `setsid`-ed out of its
   process group, say — survives to watch the next person's run in that slot.
   This closes a measured leak: before slots, a forked background process
   from one run read the next run's input files.
3. This module: a fresh process in its own session (so a fork bomb dies with
   `killpg`), `setrlimit` for CPU/memory/file-size/core and a per-user process
   count, a scrubbed environment, and an ephemeral folder removed afterwards.
4. `runner.py` (Python): a best-effort seccomp filter blocking socket
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

**Who runs what.** In the image the server is root with only `SETUID`,
`SETGID`, `CHOWN` and `DAC_OVERRIDE`; it never runs model-written code itself.
A child switches to its slot's user before anything else, which clears every
capability it had. Running as root *without* a slot is refused, so a caller
can never run untrusted code as root by forgetting the argument. Run as an
ordinary user (local Linux dev, the test suite outside the image) there is no
user to switch to and runs execute as that user, as they always did.

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
from contextlib import contextmanager

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

#: Slot n runs as uid and gid SLOT_ID_BASE + n. The Dockerfile creates
#: MAX_SLOTS such users; the server never hands out more slots than that.
SLOT_ID_BASE = 20000
MAX_SLOTS = 8
#: Processes (threads count) one slot's user may have at once. Node alone
#: starts about ten threads; a pipeline is up to five stages plus the launcher.
NPROC_PER_SLOT = 64

# The env a snippet is allowed to see. Nothing from the service's own
# environment leaks in — not that the container holds secrets, but a scrubbed
# env is one less thing to reason about. Threads pinned to 1 so a BLAS call in
# numpy cannot fan out across every core on a shared box. HOME and TMPDIR are
# set per run, to the run's own private folder.
_BASE_ENV = {
    "PATH": "/usr/local/bin:/usr/bin:/bin",
    "PYTHONHASHSEED": "0",
    "OMP_NUM_THREADS": "1",
    "OPENBLAS_NUM_THREADS": "1",
    "MKL_NUM_THREADS": "1",
    "NUMEXPR_NUM_THREADS": "1",
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


# -- users --------------------------------------------------------------------

_tmp_locked = False


def _slot_user(slot: int | None) -> int | None:
    """The uid (= gid) this run executes as, or None to run as ourselves.

    None off POSIX and when we are not root (nothing to switch to). As root a
    valid slot is required: untrusted code never runs as root.
    """
    global _tmp_locked
    if not _POSIX or os.geteuid() != 0:
        return None
    if not isinstance(slot, int) or not 1 <= slot <= MAX_SLOTS:
        raise RuntimeError(
            f"Refusing to run untrusted code as root without a slot (1-{MAX_SLOTS}).")
    if not _tmp_locked:
        # /tmp keeps its execute bit for the run folders' paths but loses
        # read and write for everyone else: a run cannot list it to find
        # another run's folder, and cannot leave files in it for the next one.
        os.chmod(tempfile.gettempdir(), 0o711)
        _tmp_locked = True
    return SLOT_ID_BASE + slot


def _reap(uid: int) -> None:
    """Kill every process `uid` owns, as `uid`.

    `kill(-1, SIGKILL)` from a process running as that user reaches all of that
    user's processes (Linux skips only init and the caller), including any that
    left the run's process group with `setsid`. Done as the user, not as root,
    so the server needs no `CAP_KILL` and cannot hit anyone else's processes.
    Twice, in case one was mid-fork during the first sweep.
    """
    script = (
        "import os, signal\n"
        "for _ in range(2):\n"
        "    try:\n"
        "        os.kill(-1, signal.SIGKILL)\n"
        "    except ProcessLookupError:\n"
        "        break\n"
    )
    subprocess.run(
        [sys.executable, "-I", "-S", "-c", script],
        user=uid, group=uid, extra_groups=[], env={}, cwd="/",
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        timeout=10, check=False,
    )


@contextmanager
def _run_folder(uid: int | None, files: dict[str, bytes]):
    """A private folder for one run: `work/` (the cwd) and `tmp/` (TMPDIR).

    Owned by the slot's user with mode 0700, so no other slot can read it.
    Removed afterwards, after every process of that user is gone.
    """
    root = tempfile.mkdtemp(prefix="run-")
    work = os.path.join(root, "work")
    tmp = os.path.join(root, "tmp")
    try:
        os.mkdir(work, 0o700)
        os.mkdir(tmp, 0o700)
        for name, data in files.items():
            with open(os.path.join(work, name), 'wb') as handle:
                handle.write(data)
        if uid is not None:
            _reap(uid)  # nothing left over from an earlier run in this slot
            for path in [root, work, tmp] + [os.path.join(work, n) for n in files]:
                os.chown(path, uid, uid)
        yield work, tmp
    finally:
        if uid is not None:
            _reap(uid)
        shutil.rmtree(root, ignore_errors=True)


def _limits(cpu_seconds: int, mem_bytes: int, fsize_bytes: int, *,
            data_limit: bool = False, nproc: int | None = None):
    """Return a preexec_fn applying rlimits, or None off POSIX.

    It runs in the child after `subprocess` has switched it to the slot's
    user, so lowering limits needs no privilege.

    `data_limit` caps memory with `RLIMIT_DATA` instead of `RLIMIT_AS`. Node
    needs it: V8 reserves far more address space than it ever touches, so a
    256 MB `RLIMIT_AS` kills it before it prints a line (measured: it needs
    ~1 GB of address space to start). `RLIMIT_DATA` counts what is actually
    allocated, and a 600 MB allocation under a 256 MB cap fails as it should.

    `nproc` caps how many processes the slot's user may have, which bounds a
    fork bomb per slot instead of only per container.
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
        if nproc is not None:
            resource.setrlimit(resource.RLIMIT_NPROC, (nproc, nproc))

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


def _spawn(argv: list[str], stdin_bytes: bytes, work: str, tmp: str, *, uid: int | None,
           wall_seconds: int, max_output: int, cpu_seconds: int, mem_bytes: int,
           fsize_bytes: int, data_limit: bool = False) -> dict:
    """Run one harness process in `work` as `uid`; its envelope, or a timeout."""
    env = dict(_BASE_ENV, HOME=tmp, TMPDIR=tmp)
    as_user = {"user": uid, "group": uid, "extra_groups": []} if uid is not None else {}
    proc = subprocess.Popen(
        argv,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=work,
        env=env,
        preexec_fn=_limits(cpu_seconds, mem_bytes, fsize_bytes, data_limit=data_limit,
                           nproc=NPROC_PER_SLOT if uid is not None else None),
        start_new_session=not _POSIX,  # POSIX uses setsid in preexec instead
        **as_user,
    )
    try:
        stdout, stderr = proc.communicate(input=stdin_bytes, timeout=wall_seconds)
    except subprocess.TimeoutExpired:
        if uid is not None:
            _reap(uid)  # the whole slot, including anything that left the group
        else:
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
    slot: int | None = None,
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
    variable: what it prints is the answer. `slot` is the concurrency slot the
    server gave this run; it picks the Unix user the run executes as.
    """
    if language not in LANGUAGES:
        raise FileSpecError(f'Unknown language {language!r}. Supported: {", ".join(LANGUAGES)}.')
    files, collect = _check_files(files, collect)
    if language != "python" and not _POSIX:
        return _linux_only("JavaScript")
    uid = _slot_user(slot)

    with _run_folder(uid, files) as (work, tmp):
        limits = {"uid": uid, "wall_seconds": wall_seconds, "max_output": max_output,
                  "cpu_seconds": cpu_seconds, "mem_bytes": mem_bytes,
                  "fsize_bytes": fsize_bytes}
        if language == "python":
            env = _spawn([sys.executable, "-I", "-B", RUNNER], code.encode("utf-8"),
                         work, tmp, **limits)
        else:
            request = {
                "stages": [_node_argv(language, work, mem_bytes)],
                "stdin": code,
                "max_output": max_output,
            }
            env = _spawn([sys.executable, "-I", "-B", LAUNCHER],
                         json.dumps(request).encode("utf-8"), work, tmp,
                         data_limit=True, **limits)
            env = _program_outcome(env)
            # Echoed so the backend can tell this sidecar from one that
            # predates `language`, which would ignore the field and run the
            # JavaScript as Python (`sandbox/service_client.py` checks it).
            env["language"] = language

        if collect and env.get("success"):
            env.update(_collect(work, collect, set(files)))
        return env


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
    slot: int | None = None,
    wall_seconds: int = 10,
    cpu_seconds: int = 8,
    mem_bytes: int = 512 * 1024 * 1024,
    fsize_bytes: int = MAX_FILE_BYTES,
    max_output: int = 200_000,
    files: dict[str, bytes] | None = None,
) -> dict:
    """Run a pipeline of allowlisted commands over `files` and `stdin`.

    `commands.validate` turns the request into argv lists or raises
    `CommandRefused`; `launch.py` runs them with no shell and the exec guard,
    as the slot's user. `success` means the pipeline ran; each stage's exit
    status is in `exit_codes` (grep finding nothing exits 1, which is an
    answer, not a failure — the caller decides).
    """
    stages = validate(pipeline)
    files, _ = _check_files(files, ())
    if not _POSIX:
        return _linux_only("A command")
    uid = _slot_user(slot)

    with _run_folder(uid, files) as (work, tmp):
        request = {"stages": stages, "stdin": stdin or "", "max_output": max_output}
        env = _spawn([sys.executable, "-I", "-B", LAUNCHER],
                     json.dumps(request).encode("utf-8"), work, tmp, uid=uid,
                     wall_seconds=wall_seconds, max_output=max_output,
                     cpu_seconds=cpu_seconds, mem_bytes=mem_bytes, fsize_bytes=fsize_bytes)
        env.setdefault("exit_codes", [])
        return env


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
