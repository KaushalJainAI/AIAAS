"""
Writing a solution into its three indexes: signatures, keywords, vectors.

Called after every save or edit, in the background. Each index is rebuilt for
the one solution, never incrementally patched — a solution is a few hundred
words, so a rebuild is cheap and cannot drift.

**Vectors are float16 in the database**, not a memory-resident FAISS pickle:
at 2048 dimensions a float32 vector is 8 KB, and an org's worth of solutions
and phrasings held in memory for ever does not fit a 384 MB container.
`search.py` loads one scope's matrix on demand and keeps a few, least recently
used. If the embedder is unavailable, the row is still searchable by
signature and keyword — `embed_version` stays empty and a later re-index
fills it.
"""
from __future__ import annotations

import asyncio
import logging
import re
from collections import Counter

import numpy as np
from asgiref.sync import sync_to_async

from . import signatures
from .models import Solution, SolutionSignature, SolutionTerm, SolutionVector

logger = logging.getLogger(__name__)

#: Field weights. The question side is what a later asker's message resembles,
#: so it counts most; the fix itself counts least for *matching* (it is what
#: gets read, not what gets searched for).
FIELD_WEIGHTS = {
    'problem': 3.0,
    'phrasings': 2.0,
    'symptoms': 2.0,
    'tags': 2.0,
    'root_cause': 1.0,
    'resolution': 0.6,
}

_SPLIT = re.compile(r'[^\w.+#-]+', re.UNICODE)
STOPWORDS = frozenset("""
a an and are as at be but by can could do does did for from had has have how i if in into
is it its me my no not of on or our so that the their them then there these they this to
too up us was we were what when where which who why will with you your after before again
get got getting just any all some also still keeps keep trying tried try doing done
""".split())


def tokenize(text: str) -> list[str]:
    out = []
    for raw in _SPLIT.split((text or '').lower()):
        tok = raw.strip('.-+#')
        if len(tok) < 2 or len(tok) > 64 or tok in STOPWORDS:
            continue
        out.append(tok)
    return out


def _field_text(solution: Solution, name: str) -> str:
    value = getattr(solution, name)
    if isinstance(value, list):
        return ' '.join(str(v) for v in value)
    return value or ''


def question_text(solution: Solution) -> str:
    """What the vector embeds: the side a later asker's message resembles."""
    return f'{solution.problem}\n{solution.symptoms[:1500]}'.strip()


# Pluggable so tests (and a future local model) can replace the remote call.
# Signature: `async (texts: list[str], input_type: str) -> list[np.ndarray] | None`,
# returning None when no embedder is available.
async def _remote_embed(texts, input_type):
    try:
        from inference.engine import EMBEDDER_VERSION, get_global_embedder

        embedder = await get_global_embedder()
        vectors = await asyncio.to_thread(embedder.encode, list(texts), 32, input_type)
        return vectors, EMBEDDER_VERSION
    except Exception as exc:  # noqa: BLE001 — degrade to keyword search
        logger.warning('[Solutions] embedder unavailable: %s', exc)
        return None, ''


EMBED = _remote_embed


def to_bytes(vector) -> bytes:
    return np.asarray(vector, dtype=np.float16).tobytes()


def from_bytes(blob) -> np.ndarray:
    return np.frombuffer(bytes(blob), dtype=np.float16)


def _write_text_indexes(solution: Solution) -> None:
    SolutionSignature.objects.filter(solution=solution).delete()
    SolutionTerm.objects.filter(solution=solution).delete()

    sig_source = '\n'.join([solution.problem, solution.symptoms, solution.root_cause])
    SolutionSignature.objects.bulk_create([
        SolutionSignature(solution=solution, digest=signatures.digest(sig), text=sig)
        for sig in signatures.extract(sig_source)
    ])

    weights: Counter = Counter()
    for field, weight in FIELD_WEIGHTS.items():
        for term, count in Counter(tokenize(_field_text(solution, field))).items():
            # Saturating per field: the tenth "celery" in a resolution is not
            # ten times the evidence of the first.
            weights[term] += weight * (1 + np.log(count))
    SolutionTerm.objects.bulk_create([
        SolutionTerm(solution=solution, term=term, weight=round(float(w), 3))
        for term, w in weights.items()
    ])


async def reindex(solution_id: int) -> None:
    """Rebuild all three indexes for one solution. Safe to call repeatedly."""
    solution = await Solution.objects.filter(id=solution_id).afirst()
    if solution is None:
        return
    await sync_to_async(_write_text_indexes)(solution)

    texts = [question_text(solution)] + [p for p in solution.phrasings if p][:5]
    vectors, version = await EMBED(texts, 'passage')
    if not vectors:
        return

    def _write_vectors():
        SolutionVector.objects.filter(solution_id=solution_id).delete()
        SolutionVector.objects.bulk_create([
            SolutionVector(solution_id=solution_id,
                           kind='question' if i == 0 else 'phrasing',
                           vector=to_bytes(v))
            for i, v in enumerate(vectors)
        ])
        Solution.objects.filter(id=solution_id).update(embed_version=version)

    await sync_to_async(_write_vectors)()
    from .search import forget_cached_scopes

    forget_cached_scopes()
