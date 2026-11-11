"""
The one door for reading knowledge bases on someone else's behalf.

A knowledge base is owned by one user (`KnowledgeBase.user`). Since K6 an
owner may share it read-only with an organisation (`org` + `shared_with_org`),
and a member of that organisation may search and read it **from a chat**.
Nothing else changes hands: a shared KB is still owned and edited by its owner,
and an agent run keeps reading only its owner's own KBs (see
`chat/tools/knowledge.py::chat_org_id`).

Two rules this module carries:

* **Membership is read live.** `is_member` is asked on every call; nothing
  remembers which orgs a user is in, so a removed member loses the shared KBs
  on the very next search.
* **Hidden eval corpora never pass this door.** Rows named with
  `HIDDEN_KB_PREFIX` are excluded here, for the owner's own list as well as
  for shared ones, exactly as `inference.models.visible_knowledge_bases` does.
  An eval run reaches its own hidden corpus through `owned_in_scope`, which is
  the eval harness's explicit scope and not a reader's door.

Writes (upload, rename, delete, re-index, change sharing) are not here. They
stay owner-only in their own views, and must not be routed through this module.
"""
from __future__ import annotations

from django.db.models import Q, QuerySet

from core.models import Membership
from core.orgs import is_member

from .models import HIDDEN_KB_PREFIX, KnowledgeBase


def readable_kbs(user_id, org_id=None) -> QuerySet:
    """Knowledge bases `user_id` may read from a context in `org_id`.

    `org_id=None` (a personal chat, or any agent run) gives the user's own
    KBs and nothing else. With an org, the org's shared KBs are added, but only
    while the reader is a member of it *and* the KB's owner still is: an owner
    who leaves the organisation takes their shares with them.
    """
    if not user_id:
        return KnowledgeBase.objects.none()
    q = Q(user_id=user_id)
    if org_id and is_member(user_id, org_id):
        # Owner-still-a-member is a subquery on Membership, so it is checked in
        # the same query and cannot go stale between two reads.
        owners_here = Membership.objects.filter(org_id=org_id).values('user_id')
        q |= Q(org_id=org_id, shared_with_org=True, user_id__in=owners_here)
    return KnowledgeBase.objects.filter(q).exclude(name__startswith=HIDDEN_KB_PREFIX)


def get_readable_kb(user_id, org_id, kb_id) -> KnowledgeBase | None:
    """One knowledge base the reader may read, or None.

    Unknown ids, foreign unshared ids, hidden eval corpora and non-member
    readers all come back as None, so a caller cannot tell them apart and must
    give one answer for all of them.
    """
    try:
        kb_id = int(kb_id)
    except (TypeError, ValueError):
        return None
    return readable_kbs(user_id, org_id).filter(id=kb_id).first()


def owned_in_scope(user_id, kb_ids) -> QuerySet:
    """The owner's own KBs among `kb_ids`, for an agent's explicit selection.

    Agents read only their owner's KBs; the selection (validated against owned
    ids by `agents/config.py`) narrows them further. Hidden eval corpora are
    included on purpose: an eval run's `kb_scope` names its own world KB, and
    that is the only way an eval reaches it. Not a reader's door — see module
    docstring.
    """
    if not user_id:
        return KnowledgeBase.objects.none()
    return KnowledgeBase.objects.filter(user_id=user_id, id__in=list(kb_ids))

