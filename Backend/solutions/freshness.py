"""
How fast each kind of claim goes stale, and whether one is still safe to state.

Decided at **read** time from `valid_as_of`, never by a job rewriting rows: a
solution becomes "check this" on its own as the calendar moves, and becomes
fresh again the moment someone confirms or re-verifies it.

A stale claim is *labelled*, not hidden — an old fix with a warning is worth
more than no fix. What a stale label obliges the model to do (verify it, or say
it may have changed) is stated in the tool result and the prompt rule.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from django.utils import timezone

#: kind -> days it may be stated without re-checking; None = does not expire.
#: `ephemeral` is never saved at all (capture drops it) and is listed only so
#: a model that sends it gets a sensible answer rather than a KeyError.
KINDS: dict[str, int | None] = {
    'principle': None,
    'procedure': 365,
    'versioned': 180,
    'config': 90,
    'time_sensitive': 30,
    'ephemeral': 0,
}

#: Most to least volatile — the order `volatility` picks the worst from.
ORDER = ['ephemeral', 'time_sensitive', 'config', 'versioned', 'procedure', 'principle']

DESCRIPTIONS = {
    'principle': 'a general rule that does not change',
    'procedure': 'steps that stay right until the system changes',
    'versioned': 'true for particular versions of something',
    'config': 'a setting, address or port that can be changed',
    'time_sensitive': 'a limit, price, person, schedule or policy — changes often',
    'ephemeral': 'true only right now (an outage, today\'s state)',
}


def clean_kind(kind: str | None) -> str:
    kind = (kind or '').strip().lower()
    return kind if kind in KINDS else 'procedure'


def volatility(claims: list[dict]) -> str:
    kinds = {clean_kind(c.get('kind')) for c in claims or []} or {'procedure'}
    return next(k for k in ORDER if k in kinds)


def claim_state(kind: str, as_of: datetime, *, now: datetime | None = None,
                env_mismatch: bool = False) -> str:
    """`fresh` or `check`. A versioned claim whose environment differs from the
    asker's is `check` whatever its age — the version is the thing that moved."""
    now = now or timezone.now()
    days = KINDS.get(clean_kind(kind))
    if kind == 'versioned' and env_mismatch:
        return 'check'
    if days is None:
        return 'fresh'
    return 'fresh' if now - as_of <= timedelta(days=days) else 'check'


def label_claims(claims: list[dict], as_of: datetime, *,
                 mismatched_keys: set[str] | None = None,
                 now: datetime | None = None) -> list[dict]:
    mismatched_keys = mismatched_keys or set()
    out = []
    for claim in claims or []:
        kind = clean_kind(claim.get('kind'))
        depends = str(claim.get('depends_on') or '').lower()
        mismatch = bool(depends) and any(k in depends for k in mismatched_keys)
        out.append({
            'text': claim.get('text', ''),
            'kind': kind,
            'state': claim_state(kind, as_of, now=now, env_mismatch=mismatch),
            **({'depends_on': claim['depends_on']} if claim.get('depends_on') else {}),
        })
    return out


def environment_mismatch(stored: dict, asked: dict | None) -> tuple[set[str], list[str]]:
    """Keys whose values differ between the solution and the asker, and a
    readable line per difference. Keys only one side names are not a mismatch
    — silence is not a different version."""
    if not stored or not asked:
        return set(), []
    stored_l = {str(k).lower(): str(v) for k, v in stored.items()}
    keys, notes = set(), []
    for k, v in asked.items():
        key = str(k).lower()
        if key in stored_l and stored_l[key].strip().lower() != str(v).strip().lower():
            keys.add(key)
            notes.append(f'{key}: solved on {stored_l[key]}, you have {v}')
    return keys, notes
