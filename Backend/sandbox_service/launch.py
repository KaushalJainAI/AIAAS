"""In-child harness for programs that are not Python: a Node run, or a
pipeline of allowlisted commands. Emits one JSON envelope on stdout.

Executed as ``python -I -B launch.py`` by `executor.py`, which has already
validated the request (`commands.py`) and set the resource limits, so every
process started here inherits them and lives in the run's own session (one
`killpg` ends the lot). Stdlib + pyseccomp only, and self-contained, for the
same reason as `runner.py`: `-I` keeps this directory off `sys.path`.

**One program per process, and only the one we chose.** Each stage is forked,
wired to its neighbours with pipes, and then installs a seccomp filter before
it starts its program:

- socket creation and the other network calls fail (`EPERM`), as in
  `runner.py`;
- `execveat` always fails;
- `execve` succeeds only when its path argument is the exact buffer this
  process filled with the binary's path, and the stage then calls `execve`
  with that buffer.

So the one `execve` that starts the program passes, and once the program is
running, any further `execve` passes a different pointer and fails. A shell
escape in a command or a `child_process` call in Node cannot start a second
program, even if `commands.py` or Node's permission model missed it. (The new
program does not know the old buffer's address, and its memory is laid out
afresh.) The filter is inherited across `fork`, so a program's own children
are held to the same rule.

This guard is the point of the harness, so it **fails closed**: with no
pyseccomp, or a kernel that refuses the filter, nothing is started and the
envelope says why. `runner.py` is best-effort only because Python predates
this guard.

Request (stdin, JSON): ``{"stages": [[path, arg, ...], ...], "stdin":
"<text>", "max_output": n}``. Output goes to files, not pipes, so a stage that
writes a lot cannot block on a reader. They sit in a private temp directory,
outside the run's cwd, and are capped by `RLIMIT_FSIZE`.
"""
from __future__ import annotations

import ctypes
import errno
import json
import os
import shutil
import sys
import tempfile

_NETWORK_CALLS = ("socket", "socketpair", "connect", "bind", "listen",
                  "accept", "accept4", "sendto", "sendmsg")


def _envelope(**fields) -> dict:
    env = {
        "success": False,
        "result": None,
        "output": "",
        "stderr": "",
        "error": None,
        "timed_out": False,
        "exit_codes": [],
    }
    env.update(fields)
    return env


def _emit(env: dict) -> None:
    os.write(1, json.dumps(env).encode("utf-8", "replace"))


def _guard_available() -> str | None:
    """None if the exec guard can be installed here, else the reason."""
    try:
        import pyseccomp  # noqa: F401
    except Exception as exc:  # noqa: BLE001
        return f"the exec guard is unavailable ({type(exc).__name__})"
    return None


def _exec_guarded(argv: list[str]) -> None:
    """Install the one-execve filter, then exec `argv`. Returns only on failure."""
    import pyseccomp as seccomp

    libc = ctypes.CDLL(None, use_errno=True)
    path = ctypes.create_string_buffer(argv[0].encode())
    c_argv = (ctypes.c_char_p * (len(argv) + 1))(*[a.encode() for a in argv], None)
    # The environment is the one executor.py gave this process: already scrubbed.
    env_items = [f"{k}={v}".encode() for k, v in os.environ.items()]
    c_env = (ctypes.c_char_p * (len(env_items) + 1))(*env_items, None)

    deny = seccomp.ERRNO(errno.EPERM)
    f = seccomp.SyscallFilter(defaction=seccomp.ALLOW)
    for name in _NETWORK_CALLS:
        f.add_rule(deny, name)
    f.add_rule(deny, "execveat")
    f.add_rule(deny, "execve", seccomp.Arg(0, seccomp.NE, ctypes.addressof(path)))
    f.load()

    libc.execve(path, c_argv, c_env)
    os.write(2, f"could not start {os.path.basename(argv[0])}: "
                f"{os.strerror(ctypes.get_errno())}\n".encode())


def _run(stages: list[list[str]], stdin_text: str, max_output: int) -> dict:
    scratch = tempfile.mkdtemp(prefix="sbx-io-")
    try:
        in_path = os.path.join(scratch, "in")
        with open(in_path, "wb") as handle:
            handle.write(stdin_text.encode("utf-8"))
        out_path = os.path.join(scratch, "out")
        err_path = os.path.join(scratch, "err")
        out_fd = os.open(out_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        err_fd = os.open(err_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        prev_read = os.open(in_path, os.O_RDONLY)

        pids: list[int] = []
        for index, argv in enumerate(stages):
            last = index == len(stages) - 1
            if last:
                read_end, write_end = -1, out_fd
            else:
                read_end, write_end = os.pipe()
            pid = os.fork()
            if pid == 0:  # child
                try:
                    os.dup2(prev_read, 0)
                    os.dup2(write_end, 1)
                    os.dup2(err_fd, 2)
                    os.closerange(3, 1024)
                    _exec_guarded(argv)
                except BaseException as exc:  # noqa: BLE001
                    try:
                        os.write(2, f"could not start {os.path.basename(argv[0])}: {exc}\n".encode())
                    except Exception:  # noqa: BLE001
                        pass
                os._exit(127)
            pids.append(pid)
            os.close(prev_read)
            if not last:
                os.close(write_end)
                prev_read = read_end
        os.close(out_fd)
        os.close(err_fd)

        codes: list[int] = []
        for pid in pids:
            _, status = os.waitpid(pid, 0)
            if os.WIFSIGNALED(status):
                codes.append(-os.WTERMSIG(status))
            else:
                codes.append(os.WEXITSTATUS(status))

        def _read(path: str) -> str:
            with open(path, "rb") as handle:
                return handle.read(max_output).decode("utf-8", "replace")

        return _envelope(
            success=True,
            output=_read(out_path),
            stderr=_read(err_path),
            exit_codes=codes,
        )
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


def main() -> None:
    try:
        request = json.loads(sys.stdin.read())
        stages = request["stages"]
        stdin_text = request.get("stdin") or ""
        max_output = int(request.get("max_output") or 200_000)
    except Exception as exc:  # noqa: BLE001
        _emit(_envelope(error=f"bad launch request: {exc}"))
        return

    reason = _guard_available()
    if reason:
        _emit(_envelope(error=f"Refused to run: {reason}."))
        return

    try:
        _emit(_run(stages, stdin_text, max_output))
    except OSError as exc:
        _emit(_envelope(error=f"{type(exc).__name__}: {exc}"))


if __name__ == "__main__":
    main()
