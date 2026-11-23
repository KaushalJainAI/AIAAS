"""
A short note of why a tool-calling turn made its calls, kept in the transcript.

A model call sees the transcript it is given and nothing else, so when the
reasoning behind a tool call is dropped, the next call cannot see why the
earlier call was made. The full reasoning is too expensive to replay on every
step, so the turn keeps only its tail: `make_note`, a plain slice with no model
call, stored on the assistant message as `additional_kwargs["reasoning_note"]`.

`render` writes the note into the assistant content when the transcript is sent
to the model (`agent.to_wire`). The note is fixed when the message is created,
so the request prefix does not change from one step to the next.

It is never shown to the user, and the final answer is the one reply that has
no note. A model may still copy the tag into its answer, having seen it in the
transcript, so `EchoFilter` removes it from streamed text and `strip_echo`
removes it from the whole reply before the reply is kept.
"""
from __future__ import annotations

import re

from workflow_backend.thresholds import REASONING_NOTE_CHARS

NOTE_KEY = "reasoning_note"
NOTE_OPEN = "<reasoning-summary>"
NOTE_CLOSE = "</reasoning-summary>"

_WHITESPACE = re.compile(r"\s+")
_SENTENCE_END = re.compile(r"[.!?] ")


def make_note(reasoning: str, limit: int = REASONING_NOTE_CHARS) -> str:
    """The last `limit` characters of `reasoning`, whitespace collapsed.

    The cut falls on a sentence boundary where one exists inside the window,
    and otherwise on a word boundary, so the note starts on a whole word. Never
    longer than `limit`.
    """
    text = _WHITESPACE.sub(" ", reasoning or "").strip()
    if len(text) <= limit:
        note = text
    else:
        window = text[-limit:]
        boundary = _SENTENCE_END.search(window)
        if boundary and boundary.end() < len(window):
            note = window[boundary.end():]
        elif (space := window.find(" ")) != -1:
            note = window[space + 1:]
        else:
            note = window
    # The model's own reasoning could contain the tag; it must not close the
    # block early or open a second one.
    return note.replace(NOTE_OPEN, "").replace(NOTE_CLOSE, "")


def render(note: str, content: str | None) -> str:
    """The assistant content the model is sent: the note, then the reply."""
    body = content or ""
    if not note:
        return body
    block = f"{NOTE_OPEN}{note}{NOTE_CLOSE}"
    return f"{block}\n{body}" if body else block


def _partial_suffix(text: str, tag: str) -> int:
    """Length of the longest proper prefix of `tag` that `text` ends with."""
    for size in range(min(len(tag) - 1, len(text)), 0, -1):
        if text.endswith(tag[:size]):
            return size
    return 0


class EchoFilter:
    """Removes `<reasoning-summary>…</reasoning-summary>` from text as it streams.

    A tag can be split across two chunks, so a partial tag at the end of a chunk
    is held back until the next chunk settles it. A block that never closes
    takes the rest of the reply with it: a model that opens one has stopped
    writing its answer, and showing the block would show the tag.
    """

    __slots__ = ("_inside", "_held")

    def __init__(self) -> None:
        self._inside = False
        self._held = ""

    def feed(self, text: str) -> str:
        """The part of `text` that may be shown now."""
        buffer = self._held + (text or "")
        self._held = ""
        shown: list[str] = []
        while buffer:
            if self._inside:
                at = buffer.find(NOTE_CLOSE)
                if at == -1:
                    keep = _partial_suffix(buffer, NOTE_CLOSE)
                    self._held = buffer[len(buffer) - keep:]
                    break
                buffer = buffer[at + len(NOTE_CLOSE):]
                self._inside = False
            else:
                at = buffer.find(NOTE_OPEN)
                if at == -1:
                    keep = _partial_suffix(buffer, NOTE_OPEN)
                    cut = len(buffer) - keep
                    shown.append(buffer[:cut])
                    self._held = buffer[cut:]
                    break
                shown.append(buffer[:at])
                buffer = buffer[at + len(NOTE_OPEN):]
                self._inside = True
        return "".join(shown)

    def flush(self) -> str:
        """Whatever was held back, at the end of the stream."""
        held, self._held = self._held, ""
        return "" if self._inside else held


def strip_echo(text: str) -> str:
    """`text` with any note-shaped block removed, for a whole reply at once."""
    if NOTE_OPEN not in text:
        return text
    echo = EchoFilter()
    return echo.feed(text) + echo.flush()
