"""
Error signatures: the exact-match half of solution search.

In troubleshooting the strongest clue is the error text, and it is noisy —
paths, line numbers, ids, addresses and timestamps differ every time the same
error happens. `normalise` strips those so two occurrences of one error become
one string, and `extract` finds the lines worth fingerprinting in a message or
a record. No model is involved: this runs on every search and must cost
nothing.
"""
from __future__ import annotations

import hashlib
import re

#: Lines that look like an error. Deliberately specific: a fingerprint of an
#: ordinary sentence would "exactly match" unrelated solutions.
_ERROR_LINE = re.compile(
    r'(?:\b[A-Z][A-Za-z0-9_.]*(?:Error|Exception|Warning|Fault|Refused|Timeout)\b'
    r'|\berror\b[:\s]|\bfatal\b|\bpanic:|\bE\d{3,5}\b|\bORA-\d+|\bERR_[A-Z_]+'
    r'|\b[45]\d\d (?:Not Found|Forbidden|Unauthorized|Bad Request|Internal Server Error|Bad Gateway|Gateway Timeout)'
    r'|\bTraceback\b|\bsegmentation fault\b|\bno such file\b|\bpermission denied\b)',
    re.IGNORECASE,
)

_SUBS = [
    (re.compile(r'(?:[A-Za-z]:)?(?:[\\/][\w.@~ -]+){2,}[\\/]?'), '<path>'),
    (re.compile(r'\bhttps?://\S+'), '<url>'),
    (re.compile(r'\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?\b'), '<time>'),
    (re.compile(r'\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b', re.I), '<id>'),
    (re.compile(r'\b0x[0-9a-f]+\b', re.I), '<addr>'),
    (re.compile(r'\b[0-9a-f]{12,}\b', re.I), '<hex>'),
    (re.compile(r'\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b'), '<ip>'),
    (re.compile(r'\bline \d+\b', re.I), 'line <n>'),
    (re.compile(r'\b\d+\b'), '<n>'),
    (re.compile(r'[\'"`]'), ''),
    (re.compile(r'\s+'), ' '),
]

MAX_SIGNATURES = 5
MIN_LEN = 12


def normalise(line: str) -> str:
    text = (line or '').strip()
    for pattern, repl in _SUBS:
        text = pattern.sub(repl, text)
    return text.strip().lower()[:300]


def extract(text: str) -> list[str]:
    """Normalised error lines from free text, de-duplicated, at most five.

    The last lines of a traceback are the informative ones (the exception and
    its message), so lines are read bottom-up.
    """
    seen: list[str] = []
    for raw in reversed((text or '').splitlines()):
        if not _ERROR_LINE.search(raw):
            continue
        sig = normalise(raw)
        # A line that normalised to placeholders is noise, not a fingerprint.
        if len(re.sub(r'<\w+>|\W', '', sig)) < MIN_LEN or sig in seen:
            continue
        seen.append(sig)
        if len(seen) >= MAX_SIGNATURES:
            break
    return seen


def digest(signature: str) -> str:
    return hashlib.sha256(signature.encode('utf-8')).hexdigest()
