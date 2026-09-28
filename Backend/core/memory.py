"""
Reading and writing what we know about a user.

Kept out of the tool module because two very different callers need it: the
tool that writes a fact, and the prompt builder that reads them all back on
every turn. Putting the read beside the write is what stops the two disagreeing
about ordering and caps.

The one rule that shapes everything here: **a fact is worth storing only if it
would change an answer later.** A store that fills with "the user said hello"
costs tokens on every single turn of every session for ever, and buries the
three facts that actually matter. That judgement cannot be enforced in code, so
it is stated hard in the tool description — and backed by caps, so a model with
bad judgement degrades the store slowly instead of destroying it.
"""
from __future__ import annotations

import logging
import re

from .models import UserMemory

logger = logging.getLogger(__name__)

#: Characters of memory injected into one system prompt. A ceiling on the whole
#: block, not per fact, because the cost that matters is what rides on every
#: turn — and unlike the per-category caps this one is what the user pays for.
#: 2,000 is about 25–30 short facts; it was 1,500, which filled at ~15.
MAX_PROMPT_CHARS = 2_000

#: Which category keeps its place when the block is full, most important first.
#: Order matters because the block is cut: it used to be the categories' *names*
#: in alphabetical order, so "Anything else" (`context`) filled the budget before
#: "Who they are" (`profile`) was reached — the one thing memory exists so the
#: user never has to repeat.
CATEGORY_PRIORITY = ('profile', 'preference', 'project', 'context')

#: The block's opening. Says what the facts are *for*, to chat and to agents
#: alike: told once, never asked again.
PROMPT_HEADER = (
    '### WHAT YOU KNOW ABOUT THIS USER ###\n'
    'What this user has already told you. Use it without being asked, and do '
    'not ask for it again.'
)

_TRAILING = re.compile(r'[\s.!;,]+$')


def normalise(text: str) -> str:
    """The form two wordings of one fact share: case, spacing, end punctuation.

    Deliberately shallow. "Works in IST." and "works in IST" are one fact;
    "Works in IST" and "Is in the IST timezone" are two, and telling those
    apart is the model's job (the tool shows it the existing facts), not a
    string function's.
    """
    return _TRAILING.sub('', ' '.join((text or '').split())).casefold()


def _same_fact(user, text: str):
    """The stored row that is `text` in another spelling, or None."""
    key = normalise(text)
    for row in UserMemory.objects.filter(user=user).only('id', 'text', 'category'):
        if normalise(row.text) == key:
            return row
    return None


def remember(user, text: str, category: str = 'context', *,
             source: str = 'agent') -> tuple[UserMemory | None, bool]:
    """Store one fact, or refresh it if it is already known.

    Returns `(row, created)`. A repeat — the same words up to case, spacing and
    end punctuation — is a touch rather than an insert, which is what keeps the
    store from filling with the same fact every time a conversation revisits
    it. Touching also protects it from the cap below, because a fact that keeps
    coming up is evidently one worth keeping. Eviction is therefore by least
    recently *saved*; a fact read on every turn but never re-saved can still
    age out, and tracking reads would cost a write on every turn.
    """
    text = (text or '').strip()
    if not text:
        return None, False
    text = text[:500]

    valid = {key for key, _ in UserMemory.CATEGORIES}
    if category not in valid:
        category = 'context'

    row = _same_fact(user, text)
    if row is not None:
        # `save()` rather than `update()` so `auto_now` fires: recency is what
        # the cap evicts on, so a repeated fact has to move to the front.
        row.category = category
        row.save(update_fields=['category', 'updated_at'])
        return row, False
    row = UserMemory.objects.create(
        user=user, text=text, category=category, source=source)
    _enforce_cap(user, category)
    return row, True


def facts_in(user, category: str, *, exclude_id: int | None = None) -> list[str]:
    """The user's stored facts in one category, newest first.

    Returned by `remember_about_user` so the model sees near-duplicates in its
    own words ("works in IST" beside "is in the IST timezone") and can forget
    the stale one — the case `normalise` is too shallow to catch.
    """
    rows = UserMemory.objects.filter(user=user, category=category)
    if exclude_id is not None:
        rows = rows.exclude(id=exclude_id)
    return list(rows.order_by('-updated_at').values_list('text', flat=True))


def _enforce_cap(user, category: str) -> None:
    """Drop the least recently touched facts in one category past the cap.

    Per category, not overall: a burst of new project facts must not evict who
    the user is. Least-recently-*touched* rather than oldest-created, because
    `remember` refreshes on repeat — so the survivors are the facts that keep
    proving relevant rather than merely the newest ones.
    """
    ids = list(
        UserMemory.objects
        .filter(user=user, category=category)
        .order_by('-updated_at')
        .values_list('id', flat=True)[UserMemory.MAX_PER_CATEGORY:]
    )
    if ids:
        UserMemory.objects.filter(id__in=ids).delete()
        logger.info('[Memory] Evicted %d stale %s memories for user %s',
                    len(ids), category, getattr(user, 'id', None))


def forget(user, text: str) -> int:
    """Remove a fact by its text (case, spacing and end punctuation ignored).

    Returns how many rows went. Matched with `normalise`, the same rule
    `remember` merges on, so a fact can always be forgotten in any spelling it
    could have been stored under.
    """
    key = normalise(text)
    if not key:
        return 0
    ids = [row.id for row in UserMemory.objects.filter(user=user).only('id', 'text')
           if normalise(row.text) == key]
    if not ids:
        return 0
    deleted, _ = UserMemory.objects.filter(id__in=ids).delete()
    return deleted


def _select(user_id: int) -> dict[str, list[tuple[int, str]]]:
    """Which facts fit in the prompt, as {category: [(id, text), ...]}.

    Categories take turns — one fact each, in `CATEGORY_PRIORITY` order, newest
    first within a category — until the budget is spent, so a busy category
    cannot crowd another out entirely and `profile` is always first in line.
    A fact that does not fit is skipped rather than ending the fill: a shorter
    one behind it may still fit. The budget counts the header and each
    category's label the moment that category gets its first fact.

    The one selection both the prompt and the Memory tab read (`in_prompt`),
    so "stored but not shown" on screen is exactly what the model is missing.
    """
    queues: dict[str, list[tuple[int, str]]] = {c: [] for c in CATEGORY_PRIORITY}
    for pk, category, text in (
        UserMemory.objects.filter(user_id=user_id)
        .order_by('-updated_at')
        .values_list('id', 'category', 'text')[:200]
    ):
        queues.setdefault(category, []).append((pk, text))

    labels = dict(UserMemory.CATEGORIES)
    chosen: dict[str, list[tuple[int, str]]] = {c: [] for c in queues}
    size = len(PROMPT_HEADER)
    cursor = {c: 0 for c in queues}
    progress = True
    while progress:
        progress = False
        for category in queues:
            queue = queues[category]
            while cursor[category] < len(queue):
                pk, text = queue[cursor[category]]
                cursor[category] += 1
                cost = len(text) + 3  # "\n- "
                if not chosen[category]:
                    cost += len(labels.get(category, category)) + 2  # "\n...:"
                if size + cost <= MAX_PROMPT_CHARS:
                    chosen[category].append((pk, text))
                    size += cost
                    progress = True
                    break
    return {c: items for c, items in chosen.items() if items}


def in_prompt_ids(user_id: int | None) -> set[int]:
    """Ids of the facts that currently fit in the prompt."""
    if not user_id:
        return set()
    return {pk for items in _select(user_id).values() for pk, _ in items}


def for_prompt(user_id: int | None) -> str:
    """What this user has told us, rendered for the system prompt, or ''.

    Goes in the **system message**, not the per-turn context update, and that
    is a deliberate exception to the rule the clock taught: this changes only
    when a fact is written, which is rare, while the clock changed on every
    single turn. Session-stable is the bar for the cached prefix, and this
    clears it.

    Grouped by category so the model reads a shape rather than a list, and
    bounded as a whole because the block is paid for on every turn of every
    session. Whole facts only — half a sentence about the user reads as a fact
    in its own right and can be flatly wrong.
    """
    if not user_id:
        return ''
    chosen = _select(user_id)
    if not chosen:
        return ''
    labels = dict(UserMemory.CATEGORIES)
    lines = [PROMPT_HEADER]
    for category, items in chosen.items():
        lines.append(f'{labels.get(category, category)}:')
        lines.extend(f'- {text}' for _, text in items)
    return '\n'.join(lines)
