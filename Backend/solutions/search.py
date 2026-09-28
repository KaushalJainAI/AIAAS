"""
Finding the solution someone already found.

Three candidate lists, merged, then re-scored with what only solutions have:

1. **Error signature** — exact match on a normalised error line. When a pasted
   traceback matches, that is usually the answer, and the semantic search is
   skipped (one embedding call saved).
2. **Keywords** — BM25-style over field-weighted postings, question side
   weighted highest.
3. **Meaning** — cosine over the question text and the "how else might this be
   asked" phrasings, one vector per phrasing, best per solution.

Merged by reciprocal rank fusion (as `inference/backends/hybrid.py`), then
multiplied by track record (Wilson lower bound, so 1-of-1 does not beat
9-of-10), environment match, and small penalties for stale, doubtful or
needs-check rows — **labelled, never hidden**.

It **abstains**: a candidate is returned only with real evidence (a signature
hit, a close meaning match, or most of the query's weight matched). A wrong
fix presented with a colleague's name on it is worse than none. The
thresholds below are first guesses, to be tuned against the offline set
(`Backend/docs/SOLUTION_MEMORY_PLAN.md` §7a) — not constants of nature.

The org boundary: every list is intersected with `access.visible(...)`, read
fresh on every call. The vector cache holds a scope's matrix, but results are
always filtered by the live visible-id set, so a removed member gets nothing
even while a cached matrix still exists.
"""
from __future__ import annotations

import logging
import math
import time
from collections import OrderedDict, defaultdict

import numpy as np
from asgiref.sync import sync_to_async
from django.db.models import F
from django.utils import timezone

from . import freshness, signatures
from .access import visible
from . import index as _index
from .index import from_bytes, tokenize
from .models import Solution, SolutionSignature, SolutionTerm, SolutionVector

logger = logging.getLogger(__name__)

RRF_K = 60
CANDIDATES = 20
SIG_BOOST = 1.0
#: Evidence thresholds (tune from the offline set).
COS_MATCH = 0.55
COS_FLOOR = 0.25
KW_MATCH = 0.5
#: Re-score multipliers.
PENALTY_STALE = 0.9
PENALTY_NEEDS_CHECK = 0.85
PENALTY_DOUBTFUL = 0.75
PENALTY_ENV = 0.85

_SCOPE_CACHE: OrderedDict = OrderedDict()
_SCOPE_CACHE_SIZE = 4
_SCOPE_TTL_S = 600
_QUERY_CACHE: OrderedDict = OrderedDict()
_QUERY_CACHE_SIZE = 256
_QUERY_TTL_S = 3600


def forget_cached_scopes() -> None:
    _SCOPE_CACHE.clear()


def wilson(positive: int, total: int, z: float = 1.96) -> float:
    if total <= 0:
        return 0.0
    phat = positive / total
    denom = 1 + z * z / total
    centre = phat + z * z / (2 * total)
    margin = z * math.sqrt((phat * (1 - phat) + z * z / (4 * total)) / total)
    return max(0.0, (centre - margin) / denom)


# ── Candidate lists (sync; run under sync_to_async) ─────────────────────────

def _visible_ids(user_id, org_id) -> set[int]:
    return set(visible(user_id, org_id).values_list('id', flat=True))


def _signature_hits(query: str, ids: set[int]) -> list[int]:
    sigs = signatures.extract(query)
    if not sigs or not ids:
        return []
    digests = [signatures.digest(s) for s in sigs]
    hits = (SolutionSignature.objects
            .filter(digest__in=digests, solution_id__in=ids)
            .values_list('solution_id', flat=True))
    return list(dict.fromkeys(hits))


def _keyword_hits(query: str, ids: set[int]) -> tuple[list[int], dict[int, float], dict[int, int]]:
    terms = list(dict.fromkeys(tokenize(query)))[:40]
    if not terms or not ids:
        return [], {}, {}
    postings = list(SolutionTerm.objects
                    .filter(term__in=terms, solution_id__in=ids)
                    .values_list('solution_id', 'term', 'weight'))
    n = max(len(ids), 1)
    df: dict[str, int] = defaultdict(int)
    for _sid, term, _w in postings:
        df[term] += 1
    idf = {t: math.log(1 + n / df[t]) if df.get(t) else math.log(1 + n) for t in terms}
    total_idf = sum(idf.values()) or 1.0
    score: dict[int, float] = defaultdict(float)
    covered: dict[int, float] = defaultdict(float)
    matched: dict[int, int] = defaultdict(int)
    for sid, term, weight in postings:
        score[sid] += idf[term] * weight / (weight + 1.5)
        covered[sid] += idf[term]
        matched[sid] += 1
    coverage = {sid: covered[sid] / total_idf for sid in score}
    # A one-word query can only ever match one term.
    need = 1 if len(terms) == 1 else 2
    matched = {sid: (need <= m) * m for sid, m in matched.items()}
    ranked = sorted(score, key=lambda s: -score[s])[:CANDIDATES]
    return ranked, coverage, matched


def _scope_matrix(user_id, org_id):
    """(solution_ids, float16 matrix) for every vector in this scope, cached."""
    key = ('org', org_id) if org_id else ('user', user_id)
    cached = _SCOPE_CACHE.get(key)
    if cached and time.monotonic() - cached[2] < _SCOPE_TTL_S:
        _SCOPE_CACHE.move_to_end(key)
        return cached[0], cached[1]
    rows = SolutionVector.objects.filter(solution__org_id=org_id) if org_id else \
        SolutionVector.objects.filter(solution__author_id=user_id, solution__org__isnull=True)
    ids, vecs = [], []
    for sid, blob in rows.values_list('solution_id', 'vector').iterator():
        v = from_bytes(blob)
        if vecs and v.shape != vecs[0].shape:
            continue  # a vector from another embedder version
        ids.append(sid)
        vecs.append(v)
    matrix = np.vstack(vecs) if vecs else np.zeros((0, 0), dtype=np.float16)
    ids_arr = np.asarray(ids, dtype=np.int64)
    _SCOPE_CACHE[key] = (ids_arr, matrix, time.monotonic())
    while len(_SCOPE_CACHE) > _SCOPE_CACHE_SIZE:
        _SCOPE_CACHE.popitem(last=False)
    return ids_arr, matrix


async def _query_vector(text: str):
    key = ' '.join(text.lower().split())[:2000]
    hit = _QUERY_CACHE.get(key)
    if hit and time.monotonic() - hit[1] < _QUERY_TTL_S:
        return hit[0]
    vectors, _version = await _index.EMBED([key], 'query')
    if not vectors:
        return None
    vec = np.asarray(vectors[0], dtype=np.float32)
    _QUERY_CACHE[key] = (vec, time.monotonic())
    while len(_QUERY_CACHE) > _QUERY_CACHE_SIZE:
        _QUERY_CACHE.popitem(last=False)
    return vec


async def _vector_hits(user_id, org_id, query: str, ids: set[int]):
    if not ids:
        return [], {}, True
    ids_arr, matrix = await sync_to_async(_scope_matrix)(user_id, org_id)
    if not len(ids_arr):
        # Solutions exist but none has a vector (the embedder was down when
        # they were saved): meaning search did not really run.
        return [], {}, False
    # A long paste is mostly noise to an embedder: keep its error lines and head.
    sigs = signatures.extract(query)
    text = ('\n'.join(sigs) + '\n' + query[:600]).strip() if sigs else query[:1200]
    qvec = await _query_vector(text)
    if qvec is None or matrix.shape[1] != qvec.shape[0]:
        return [], {}, False
    sims = matrix.astype(np.float32) @ qvec
    best: dict[int, float] = {}
    for sid, sim in zip(ids_arr.tolist(), sims.tolist()):
        if sid in ids and sim >= COS_FLOOR and sim > best.get(sid, -1):
            best[sid] = sim
    ranked = sorted(best, key=lambda s: -best[s])[:CANDIDATES]
    return ranked, best, True


# ── The pipeline ─────────────────────────────────────────────────────────────

def _fuse(lists: list[list[int]], sig_ids: set[int]) -> dict[int, float]:
    fused: dict[int, float] = defaultdict(float)
    for ranked in lists:
        for rank, sid in enumerate(ranked):
            fused[sid] += 1.0 / (RRF_K + rank + 1)
    ceiling = 3 * (1.0 / (RRF_K + 1))
    return {sid: min((s / ceiling) + (SIG_BOOST if sid in sig_ids else 0.0), 2.0)
            for sid, s in fused.items()}


def present(solution: Solution, *, viewer_id=None, environment=None,
            full: bool = False) -> dict:
    """A solution as a reader (or the model) sees it: dated, attributed, labelled."""
    mismatched, env_notes = freshness.environment_mismatch(solution.environment, environment)
    claims = freshness.label_claims(solution.claims, solution.valid_as_of,
                                    mismatched_keys=mismatched)
    cut = (lambda s, n: s) if full else (lambda s, n: s if len(s) <= n else s[:n] + '…')
    out = {
        'id': solution.id,
        'problem': solution.problem,
        'symptoms': cut(solution.symptoms, 400),
        'root_cause': cut(solution.root_cause, 600),
        'resolution': cut(solution.resolution, 1500),
        'environment': solution.environment,
        'solved_by': solution.author_name or 'a former member',
        'solved_on': solution.created_at.date().isoformat() if solution.created_at else None,
        'last_known_true': solution.valid_as_of.date().isoformat(),
        'shared_with_org': solution.shared,
        'track_record': {'worked': solution.confirmations, 'failed': solution.failures},
        'status': solution.status,
        'volatility': solution.volatility,
        'claims': claims,
        'checks_needed': [c['text'] for c in claims if c['state'] == 'check'],
    }
    if env_notes:
        out['environment_differs'] = env_notes
    if solution.doubtful:
        out['doubtful'] = solution.doubt_reason or 'Flagged as possibly wrong.'
    if full:
        out['phrasings'] = solution.phrasings
        out['tags'] = solution.tags
        if viewer_id and viewer_id == solution.author_id:
            out['source_session'] = solution.source_session
    return out


async def search(user_id, org_id, query: str, *, environment: dict | None = None,
                 limit: int = 3) -> dict:
    started = time.monotonic()
    query = (query or '').strip()
    if not query:
        return {'results': [], 'abstained': True, 'semantic': True}

    ids = await sync_to_async(_visible_ids)(user_id, org_id)
    if not ids:
        return {'results': [], 'abstained': True, 'semantic': True, 'searched': 0}

    sig_hits = await sync_to_async(_signature_hits)(query, ids)
    kw_ranked, coverage, matched = await sync_to_async(_keyword_hits)(query, ids)
    if sig_hits:
        vec_ranked, cosines, semantic = [], {}, True
    else:
        vec_ranked, cosines, semantic = await _vector_hits(user_id, org_id, query, ids)

    sig_set = set(sig_hits)
    fused = _fuse([sig_hits, kw_ranked, vec_ranked], sig_set)
    confident = {
        sid for sid in fused
        if sid in sig_set
        or cosines.get(sid, 0) >= COS_MATCH
        or (coverage.get(sid, 0) >= KW_MATCH and matched.get(sid, 0))
    }
    top = sorted(confident, key=lambda s: -fused[s])[:10]

    def _load():
        rows = {s.id: s for s in visible(user_id, org_id).filter(id__in=top)}
        return [rows[s] for s in top if s in rows]

    rows = await sync_to_async(_load)()
    scored = []
    now = timezone.now()
    for sol in rows:
        score = fused[sol.id]
        score *= 0.75 + 0.25 * wilson(sol.confirmations, sol.confirmations + sol.failures)
        mismatched, _ = freshness.environment_mismatch(sol.environment, environment)
        if mismatched:
            score *= PENALTY_ENV
        if any(freshness.claim_state(c.get('kind'), sol.valid_as_of, now=now) == 'check'
               for c in sol.claims or []):
            score *= PENALTY_STALE
        if sol.status == 'needs_check':
            score *= PENALTY_NEEDS_CHECK
        if sol.doubtful:
            score *= PENALTY_DOUBTFUL
        match = ('error signature' if sol.id in sig_set
                 else 'meaning' if cosines.get(sol.id, 0) >= COS_MATCH else 'keywords')
        scored.append((score, match, sol))
    scored.sort(key=lambda t: -t[0])
    chosen = scored[:max(1, min(limit, 20))]

    results = []
    for score, match, sol in chosen:
        item = present(sol, viewer_id=user_id, environment=environment)
        item['match'] = match
        item['score'] = round(score, 3)
        item['evidence'] = {
            'error_signature': sol.id in sig_set,
            'similarity': round(cosines.get(sol.id, 0.0), 3),
            'keyword_coverage': round(coverage.get(sol.id, 0.0), 3),
        }
        results.append(item)

    if chosen:
        await Solution.objects.filter(id__in=[s.id for _, _, s in chosen]).aupdate(
            reuse_count=F('reuse_count') + 1, last_used_at=now,
        )
    logger.info('[Latency] solutions.search %dms hits=%d scope=%d semantic=%s',
                (time.monotonic() - started) * 1000, len(results), len(ids), semantic)
    return {'results': results, 'abstained': not results, 'semantic': semantic,
            'searched': len(ids)}
