"""The commands a model may run, and the check that turns a request into argv.

This is the authoritative allowlist: the backend's `run_command` tool lists
the same names for the model to read, and a test keeps the two equal, but
only this module decides. A request is a *pipeline* of stages, each a command
name plus an argument list. There is no shell anywhere: arguments go to the
program exactly as given, so `;`, `|`, `$( )`, backticks, `>` and globs are
just characters in an argument, never syntax.

What a command must satisfy to be on the list:

1. **It works on text or files the run was handed**, which is what an agent
   needs a command for (search a log, count rows, slice a CSV, query JSON).
2. **It cannot start another program.** Shells, interpreters and launchers
   (`sh`, `bash`, `python`, `node`, `perl`, `env`, `xargs`, `find`,
   `timeout`, `nice`, `nohup`, `stdbuf`, `sqlite3`, `tar`, `zip`, `split`)
   are not on it, because each one is a way to run anything. Where a listed
   program has an escape hatch, it is closed here: `sed` and `gawk` always run
   with `--sandbox` (no `e`/`r`/`w`, no `system()`, no pipes or redirection),
   and `sort --compress-program` is refused.
3. **It cannot reach the network.** Nothing listed is a network client, and
   the sidecar has no route out regardless.

Behind this list sits a second, independent layer (`launch.py`): each stage
is allowed exactly one `execve`, its own, so a flag this module missed still
cannot start a second program. And behind that, the container.
"""
from __future__ import annotations

from dataclasses import dataclass

#: Stages in one pipeline, arguments per stage, characters per argument.
MAX_STAGES = 5
MAX_ARGS = 64
MAX_ARG_CHARS = 4096


class CommandRefused(ValueError):
    """A pipeline the policy will not run. The message is written for the model."""


@dataclass(frozen=True)
class Command:
    #: Absolute path of the binary. Never resolved through PATH at run time.
    path: str
    #: Inserted straight after argv[0], before anything the caller passed.
    forced: tuple[str, ...] = ()
    #: Long options refused, without the leading `--`. getopt accepts any
    #: unambiguous prefix (`--compress` for `--compress-program`), so a prefix
    #: of three or more characters is refused too.
    denied_long: tuple[str, ...] = ()
    #: Short option letters refused, and the letters that take an argument
    #: (scanning a bundle like `-bz` stops at the first of those, because the
    #: rest of the bundle is that option's value, not more options).
    denied_short: str = ''
    takes_arg: str = ''


def _bin(name: str) -> Command:
    return Command(path=f'/usr/bin/{name}')


COMMANDS: dict[str, Command] = {
    # Look at files.
    'cat': _bin('cat'),
    'head': _bin('head'),
    'tail': _bin('tail'),
    'wc': _bin('wc'),
    'ls': _bin('ls'),
    'stat': _bin('stat'),
    'du': _bin('du'),
    # `-z` makes libmagic look inside compressed files, which it may do by
    # starting a decompressor program. The exec guard would stop that anyway;
    # refusing it here gives the model a reason instead of a failed run.
    'file': Command(path='/usr/bin/file', denied_short='zZ', takes_arg='eFfmP',
                    denied_long=('uncompress', 'uncompress-noreport')),
    # Search and reshape text.
    'grep': _bin('grep'),
    'sed': Command(path='/usr/bin/sed', forced=('--sandbox',)),
    # `awk` is gawk, called by its own name so it can never resolve to an awk
    # without a sandbox mode.
    'awk': Command(path='/usr/bin/gawk', forced=('--sandbox',)),
    'cut': _bin('cut'),
    'tr': _bin('tr'),
    'sort': Command(path='/usr/bin/sort', denied_long=('compress-program',)),
    'uniq': _bin('uniq'),
    'paste': _bin('paste'),
    'join': _bin('join'),
    'comm': _bin('comm'),
    'column': _bin('column'),
    'nl': _bin('nl'),
    'fold': _bin('fold'),
    'fmt': _bin('fmt'),
    'rev': _bin('rev'),
    'tac': _bin('tac'),
    'expand': _bin('expand'),
    'unexpand': _bin('unexpand'),
    # Compare.
    'diff': _bin('diff'),
    'cmp': _bin('cmp'),
    # Structured data.
    'jq': _bin('jq'),
    # Encodings, checksums, archives.
    'base64': _bin('base64'),
    'md5sum': _bin('md5sum'),
    'sha1sum': _bin('sha1sum'),
    'sha256sum': _bin('sha256sum'),
    'iconv': _bin('iconv'),
    'od': _bin('od'),
    'gzip': _bin('gzip'),
    'gunzip': _bin('gunzip'),
    'zcat': _bin('zcat'),
    'unzip': _bin('unzip'),
    # Small generators.
    'date': _bin('date'),
    'seq': _bin('seq'),
    'echo': _bin('echo'),
    'printf': _bin('printf'),
}


def _refuses_long(spec: Command, arg: str) -> str | None:
    name = arg[2:].split('=', 1)[0]
    if not name:
        return None  # a bare `--` ends the options; nothing to check
    for denied in spec.denied_long:
        if name == denied or (len(name) >= 3 and denied.startswith(name)):
            return denied
    return None


def _refuses_short(spec: Command, arg: str) -> str | None:
    for letter in arg[1:]:
        if letter in spec.denied_short:
            return letter
        if letter in spec.takes_arg:
            return None  # the rest of the bundle is this option's value
    return None


def validate(pipeline) -> list[list[str]]:
    """The argv list for every stage, or `CommandRefused` naming what is wrong.

    `pipeline` is a list of `{"command": name, "args": [str, ...]}`.
    """
    if not isinstance(pipeline, list) or not pipeline:
        raise CommandRefused('pipeline must be a non-empty list of stages.')
    if len(pipeline) > MAX_STAGES:
        raise CommandRefused(f'At most {MAX_STAGES} stages in one pipeline.')

    stages: list[list[str]] = []
    for index, stage in enumerate(pipeline, start=1):
        if not isinstance(stage, dict):
            raise CommandRefused(f'Stage {index} must be an object with "command" and "args".')
        name = stage.get('command')
        args = stage.get('args') or []
        if not isinstance(name, str) or not name:
            raise CommandRefused(f'Stage {index} has no command.')
        spec = COMMANDS.get(name)
        if spec is None:
            raise CommandRefused(
                f'"{name}" is not an allowed command. Allowed: '
                f'{", ".join(sorted(COMMANDS))}. For anything else, use '
                f'execute_python.'
            )
        if not isinstance(args, list) or not all(isinstance(a, str) for a in args):
            raise CommandRefused(f'Stage {index} ({name}): args must be a list of strings.')
        if len(args) > MAX_ARGS:
            raise CommandRefused(f'Stage {index} ({name}): at most {MAX_ARGS} arguments.')
        options_done = False
        for arg in args:
            if '\x00' in arg:
                raise CommandRefused(f'Stage {index} ({name}): an argument contains a NUL byte.')
            if len(arg) > MAX_ARG_CHARS:
                raise CommandRefused(
                    f'Stage {index} ({name}): an argument is over {MAX_ARG_CHARS} characters. '
                    f'Put long text in stdin or a file instead.'
                )
            if options_done or not arg.startswith('-') or arg == '-':
                continue
            if arg == '--':
                options_done = True
                continue
            if arg.startswith('--'):
                hit = _refuses_long(spec, arg)
                if hit:
                    raise CommandRefused(
                        f'Stage {index} ({name}): --{hit} is not allowed, because it '
                        f'starts another program.'
                    )
            else:
                hit = _refuses_short(spec, arg)
                if hit:
                    raise CommandRefused(
                        f'Stage {index} ({name}): -{hit} is not allowed here.'
                    )
        stages.append([spec.path, *spec.forced, *args])
    return stages
