"""
Provider citation payloads, reduced to the source records the chat UI reads.

Every provider that cites anything does it differently, and none of them agree
on a shape:

    Perplexity      top-level ``citations: ["https://…", …]``, prose says ``[1]``
    OpenAI (chat)   ``message.annotations[]`` with a nested ``url_citation``
    OpenAI (resp.)  ``content[].annotations[]``, flat, with character spans
    Gemini          ``groundingMetadata.groundingChunks[].web{uri,title}``
    Anthropic       ``content[].citations[]`` with a ``type`` discriminator
    Mistral         ``content[]`` parts with ``reference_ids`` into a source list

This module knows none of those envelopes by name. It looks for the one thing
they all end with — a URL — and drops everything that is not an ``http(s)``
URL. That is deliberate: a new provider with a new wrapper needs no change
here, and a model that invents a ``javascript:`` citation can never reach the
renderer.

Two rules the callers depend on:

* **Order is preserved.** A provider whose prose says ``[1]`` is numbering an
  array it sent us; re-ordering it breaks the prose↔source mapping. Numbers
  that the provider does *not* put in the prose (OpenAI spans, Gemini
  ``groundingSupports``) are the caller's to assign, and appending is the only
  order that leaves existing numbering alone.
* **Duplicates collapse by page, not by byte.** ``#section`` anchors and a
  trailing slash are dropped from the key, so the same article cited twice is
  one source rather than two pills pointing at the same place.
"""
from __future__ import annotations

import logging
from typing import Any, Iterable, Iterator, Mapping
from urllib.parse import urlsplit

logger = logging.getLogger(__name__)

#: Sources kept for one turn. Matches the tool path (`_on_web_search`), so a
#: provider-supplied list cannot grow a message past what search already allows.
MAX_SOURCES = 50

#: The only schemes a citation may use. `mailto:` is a real citation of an
#: address in principle; it is not a link we render as a source card.
_SAFE_SCHEMES = frozenset({"http", "https"})

#: Envelope keys, tried in this order. A provider wrapping its payload in one of
#: these is the whole reason the walker recurses instead of hard-coding shapes.
_ENVELOPES = (
    "citations",
    "sources",
    "annotations",
    "groundingChunks",
    "grounding_chunks",
    "groundingMetadata",
    "grounding_metadata",
    "search_results",
    "results",
)

#: Nested containers that hold the URL under ``uri`` rather than ``url``.
_LINK_CONTAINERS = ("web", "retrievedContext", "retrieved_context", "document")

#: Keys a URL may hide under.
_URL_KEYS = ("url", "uri", "href", "link")
_TITLE_KEYS = ("title", "name", "document_title", "domain")
_SNIPPET_KEYS = ("snippet", "cited_text", "description", "text", "content")

_MAX_DEPTH = 5

#: Bidirectional and zero-width format characters. A hostname containing
#: U+202E renders as a different domain than the one in the URL — Trojan Source
#: applied to a link. No real citation contains one, so the URL is refused
#: rather than repaired: stripping the character would leave a link that points
#: somewhere other than where it reads.
_BIDI_FORMAT = frozenset(
    "\u061c"
    "\u200b\u200c\u200d\u200e\u200f"
    "\u202a\u202b\u202c\u202d\u202e"
    "\u2066\u2067\u2068\u2069"
    "\ufeff"
)


class _Source(dict):
    """A plain dict, only so the type reads clearly at the call sites."""


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def clean_url(value: Any) -> str:
    """The URL if it is safe to render as a link, otherwise ``""``.

    Rejects non-``http(s)`` schemes, anything without a host, and URLs carrying
    credentials — ``https://paypal.com@evil.example`` is a phishing link that
    passes every naive scheme check, and it has no business in a source card.
    """
    url = _text(value)
    if not url:
        return ""
    # A URL never contains literal whitespace; one here is either a mangled
    # paste or an attempt to smuggle a second value past a scheme check.
    if any(character.isspace() or ord(character) < 0x20 for character in url):
        return ""
    if any(character in _BIDI_FORMAT for character in url):
        return ""
    try:
        parts = urlsplit(url)
    except ValueError:
        return ""
    if parts.scheme.lower() not in _SAFE_SCHEMES:
        return ""
    if not parts.hostname:
        return ""
    if parts.username or parts.password:
        return ""
    return url


def _dedupe_key(url: str) -> tuple[str, str, str, str]:
    """Identity of the *page* a URL points at, ignoring the anchor."""
    parts = urlsplit(url)
    return (
        parts.scheme.lower(),
        parts.netloc.lower(),
        parts.path.rstrip("/") or "/",
        parts.query,
    )


def _record(url: Any, title: Any = "", snippet: Any = "") -> _Source | None:
    cleaned = clean_url(url)
    if not cleaned:
        return None

    host = urlsplit(cleaned).hostname or ""
    label = _text(title) or host
    record = _Source(
        title=label,
        url=cleaned,
        snippet=_text(snippet),
        # Both spellings: `source` is what this backend's search path writes,
        # `publisher` is what the citation card reads.
        source=host,
        publisher=host,
    )
    return record


def _leaf(value: Any) -> _Source | None:
    """One candidate object, read as a source — or ``None`` if it is not one."""
    if isinstance(value, str):
        return _record(value)

    if not isinstance(value, Mapping):
        return None

    # OpenAI's nested `{"type": "url_citation", "url_citation": {...}}`.
    nested = value.get("url_citation")
    if isinstance(nested, Mapping):
        return _leaf(nested)

    for key in _LINK_CONTAINERS:
        container = value.get(key)
        if isinstance(container, Mapping):
            found = _record(
                next((container[k] for k in _URL_KEYS if _text(container.get(k))), ""),
                next((container[k] for k in _TITLE_KEYS if _text(container.get(k))), ""),
            )
            if found:
                return found

    url = next((value[k] for k in _URL_KEYS if _text(value.get(k))), "")
    if not url:
        return None

    record = _record(
        url,
        next((value[k] for k in _TITLE_KEYS if _text(value.get(k))), ""),
        next((value[k] for k in _SNIPPET_KEYS if _text(value.get(k))), ""),
    )

    # Spans travel with the source when the provider gave them, so a renderer
    # that wants to place a pill at the cited sentence does not need a second
    # parse. Absent for providers that only send a list.
    if record:
        for key in ("start_index", "end_index"):
            if isinstance(value.get(key), int):
                record[key] = value[key]
    return record


def _grounding_sources(metadata: Mapping[str, Any]) -> Iterator[_Source]:
    """Gemini's grounding payload: chunks, with the spans from `groundingSupports`.

    The chunks and the supports are two lists that only make sense together —
    the supports carry `groundingChunkIndices` into the chunks list, and their
    segments carry the offsets. Handled as a unit so a source arrives with the
    sentence it was cited for, rather than as a bare URL.
    """
    chunks = (
        metadata.get("groundingChunks")
        or metadata.get("grounding_chunks")
        or ()
    )
    records = [_leaf(chunk) for chunk in chunks]

    spans: dict[int, list[tuple[int, int]]] = {}
    for support in (
        metadata.get("groundingSupports") or metadata.get("grounding_supports") or ()
    ):
        if not isinstance(support, Mapping):
            continue
        segment = support.get("segment")
        if not isinstance(segment, Mapping):
            continue
        start = segment.get("startIndex")
        end = segment.get("endIndex")
        if not (isinstance(start, int) and isinstance(end, int) and end > start):
            continue
        for index in (
            support.get("groundingChunkIndices")
            or support.get("grounding_chunk_indices")
            or ()
        ):
            if isinstance(index, int):
                spans.setdefault(index, []).append((start, end))

    for index, record in enumerate(records):
        if record is None:
            continue
        if index in spans:
            # Several supports may cite the same chunk; the first mention is
            # where the pill belongs, so the narrowest span wins.
            start, end = min(spans[index], key=lambda span: span[1] - span[0])
            record["start_index"] = start
            record["end_index"] = end
            # Gemini counts offsets in UTF-8 **bytes**, not characters. A naive
            # `text[start:end]` on a non-ASCII answer lands in the wrong place
            # or raises; `resolve_citation_spans` converts against the final text.
            record["span_units"] = "utf8"
        yield record


def _as_grounding(value: Mapping[str, Any]) -> Mapping[str, Any] | None:
    if "groundingChunks" in value or "grounding_chunks" in value:
        return value
    if "groundingSupports" in value or "grounding_supports" in value:
        return value
    return None


def _walk(value: Any, depth: int = 0) -> Iterator[_Source]:
    if depth > _MAX_DEPTH:
        logger.debug("[Citations] payload nested deeper than %d; stopped", _MAX_DEPTH)
        return

    if isinstance(value, (list, tuple, set)):
        for item in value:
            yield from _walk(item, depth + 1)
        return

    if not isinstance(value, Mapping):
        yield from filter(None, (_leaf(value),))
        return

    # Before the envelope keys: a grounding payload is chunks *and* supports,
    # and taking the `groundingChunks` envelope alone would drop the spans.
    if (grounding := _as_grounding(value)) is not None:
        yield from _grounding_sources(grounding)
        return

    for key in _ENVELOPES:
        envelope = value.get(key)
        if envelope is not None and envelope != value:
            yield from _walk(envelope, depth + 1)
            return

    found = _leaf(value)
    if found:
        yield found


def normalize_citations(raw: Any) -> list[dict[str, Any]]:
    """Every usable source in a provider citation payload, deduped, in order.

    Accepts anything: a list of URLs, a list of annotation dicts, one
    ``groundingMetadata`` object, or ``None``. An input it cannot read is an
    empty list, never an exception — a citation shape we have not seen must not
    fail the turn that carried it.
    """
    if raw is None:
        return []

    sources: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str, str]] = set()

    for record in _walk(raw):
        key = _dedupe_key(record["url"])
        if key in seen:
            continue
        seen.add(key)
        sources.append(record)
        if len(sources) >= MAX_SOURCES:
            break

    return sources


def _utf8_to_char(text: str, byte_index: int) -> int:
    """Character offset of a UTF-8 **byte** offset, clamped to `text`.

    A byte index that splits a multi-byte character resolves to the boundary
    before it: the pill lands next to the cited word rather than inside it.
    """
    encoded = text.encode("utf-8")
    if byte_index <= 0:
        return 0
    if byte_index >= len(encoded):
        return len(text)
    return len(encoded[:byte_index].decode("utf-8", errors="ignore"))


def resolve_citation_spans(
    citations: Iterable[Mapping[str, Any]], text: str,
) -> list[dict[str, Any]]:
    """Turn a provider's span offsets into character offsets into `text`.

    Only meaningful once the answer is whole, which is why this runs at the end
    of the turn and not per chunk: OpenAI reports character offsets, Gemini
    reports UTF-8 byte offsets, and neither can be validated until the text it
    indexes exists. A span that does not fit is dropped — the source stays, it
    just has no sentence to point at, which is the same state as a provider that
    sends no spans at all.
    """
    resolved: list[dict[str, Any]] = []

    for citation in citations:
        record = dict(citation)
        start = record.pop("start_index", None)
        end = record.pop("end_index", None)
        units = record.pop("span_units", "chars")

        if not (isinstance(start, int) and isinstance(end, int)):
            resolved.append(record)
            continue

        # Validated before conversion, in the units the provider used: after
        # conversion a clamped value would look like a legitimate offset.
        limit = len(text.encode("utf-8")) if units == "utf8" else len(text)
        if not (0 <= start < end <= limit):
            logger.debug("[Citations] dropped span %r for %s", (start, end), record.get("url"))
            resolved.append(record)
            continue

        if units == "utf8":
            start = _utf8_to_char(text, start)
            end = _utf8_to_char(text, end)
            if start >= end:
                resolved.append(record)
                continue

        record["start"] = start
        record["end"] = end
        resolved.append(record)

    return resolved


def merge_sources(
    existing: Iterable[Mapping[str, Any]] | None,
    incoming: Iterable[Any] | None,
    *,
    limit: int = MAX_SOURCES,
) -> list[dict[str, Any]]:
    """``existing`` followed by whatever in ``incoming`` it does not already have.

    Appending rather than interleaving is what keeps an answer's ``[1]``
    pointing at the same source after the model's own citations arrive: the
    first list is the one the prompt numbered, so its positions must not move.
    An empty ``existing`` therefore means "the provider's order is the order",
    which is exactly right for a Perplexity-style answer.
    """
    merged: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str, str]] = set()

    for source in existing or ():
        if not isinstance(source, Mapping):
            continue
        url = clean_url(source.get("url") or source.get("uri"))
        if not url:
            continue
        key = _dedupe_key(url)
        if key in seen:
            continue
        seen.add(key)
        merged.append(dict(source))

    for record in normalize_citations(list(incoming or ())):
        key = _dedupe_key(record["url"])
        if key in seen:
            continue
        seen.add(key)
        merged.append(record)
        if len(merged) >= limit:
            break

    return merged[:limit]
