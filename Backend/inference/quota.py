"""
How much one account may keep.

Every per-file cap in `workflow_backend/thresholds.py` bounds one request. None
of them bounded the loop: an account could upload 50 MB a thousand times an
hour, and an agent could write files until the volume was full. This module is
the total.

Three rules carry it.

* **Usage is summed, not counted up.** `usage()` adds up the size columns the
  rows already carry. A running counter would need every writer and every
  deleter to remember it, and a counter that drifts is a quota that either
  refuses people with room or admits people without it. The sums are indexed
  on the owner and bounded by `MAX_DOCUMENTS_PER_USER`.
* **Trash counts.** A trashed file still occupies the disk until the purge
  sweep removes it, so it still counts; the refusal says to empty the trash,
  because that is the move that frees room now.
* **Each stored blob is counted once.** A chat attachment that shares its
  document's file (every upload since the double store was removed) is
  counted on the document, not again on the attachment.

`check()` is called at the doors where a person or a model pushes bytes in:
the two upload views, the VFS writes, and the apps' create and copy. It is not
called where the platform stores something it already paid for (a generated
image) — refusing there would discard the result after the charge.
"""
from __future__ import annotations

from django.db.models import F, Sum

from workflow_backend import thresholds


class QuotaExceeded(Exception):
    """A refusal written for whoever asked — a person or a model."""

    status = 413


def _megabytes(count: int) -> str:
    mb = count / 1_048_576
    return f'{mb / 1024:.1f} GB' if mb >= 1024 else f'{mb:.0f} MB'


def limit_for(user) -> int:
    """The account's byte quota; 0 means none is enforced."""
    tier = getattr(getattr(user, 'profile', None), 'tier', None) or 'free'
    table = thresholds.STORAGE_QUOTA_MB
    return max(0, int(table.get(tier, table['free']))) * 1_048_576


def usage(user) -> dict:
    """Bytes and file count this account holds, by where they sit."""
    from django.apps import apps

    from .models import Document, DocumentVersion, PublishedPage

    # By name, not by import: `inference` sits below `chat` in the layering.
    ChatAttachment = apps.get_model('chat', 'ChatAttachment')

    docs = Document.all_objects.filter(user=user)
    live = docs.filter(deleted_at__isnull=True)
    documents = live.aggregate(n=Sum('file_size'))['n'] or 0
    trash = docs.filter(deleted_at__isnull=False).aggregate(n=Sum('file_size'))['n'] or 0
    versions = (DocumentVersion.objects.filter(document__user=user)
                .aggregate(n=Sum('file_size'))['n'] or 0)
    # An attachment whose bytes are its document's is already in `documents`.
    attachments = (ChatAttachment.objects.filter(session__user=user)
                   .exclude(file='')
                   .exclude(inference_document__file=F('file'))
                   .aggregate(n=Sum('file_size'))['n'] or 0)
    published = (PublishedPage.objects.filter(owner=user)
                 .aggregate(n=Sum('file_size'))['n'] or 0)

    used = documents + trash + versions + attachments + published
    limit = limit_for(user)
    return {
        'used_bytes': used,
        'limit_bytes': limit,
        'percent': round(used * 100 / limit, 1) if limit else None,
        'file_count': docs.count(),
        'file_limit': thresholds.MAX_DOCUMENTS_PER_USER,
        'breakdown': {
            'documents': documents,
            'trash': trash,
            'versions': versions,
            'chat_attachments': attachments,
            'published_pages': published,
        },
    }


def check_count(user) -> None:
    """Raise `QuotaExceeded` if the account may not hold one more file."""
    from .models import Document

    cap = thresholds.MAX_DOCUMENTS_PER_USER
    if cap and Document.all_objects.filter(user=user).count() >= cap:
        raise QuotaExceeded(
            f'This account holds {cap:,} files, which is the limit. Delete '
            f'some and empty the trash, then try again.'
        )


def check(user, incoming_bytes: int = 0, *, new_file: bool = True) -> None:
    """Raise `QuotaExceeded` if storing `incoming_bytes` would pass a limit.

    `new_file=False` is an overwrite: it adds bytes but no row.
    """
    if new_file:
        check_count(user)

    limit = limit_for(user)
    if not limit:
        return
    incoming = max(0, int(incoming_bytes or 0))
    used = usage(user)['used_bytes']
    if used + incoming > limit:
        raise QuotaExceeded(
            f'Storage is full: {_megabytes(used)} of {_megabytes(limit)} is used, '
            f'so this file does not fit. Delete files you no longer need and '
            f'empty the trash — trashed files still count until they are removed.'
        )
