"""
What an organisation has solved, kept so the next person does not start from zero.

A `Solution` is a **record, not a transcript**: problem, symptoms, cause, fix,
and the individual claims inside the fix that could go stale. Storing the chat
would leak everything said in it and be useless to read; the record keeps the
part someone else needs.

Where a row may be seen is decided in exactly one place,
`solutions/access.py::visible`. Nothing else filters `Solution.objects` for a
reader — a choke-point test enforces it — because the whole feature is only
safe while "which org does this belong to" is asked the same way everywhere.
"""
from __future__ import annotations

from django.conf import settings
from django.db import models


class Solution(models.Model):
    STATUS_CHOICES = [
        ('active', 'Active'),
        ('needs_check', 'Needs check'),
        ('superseded', 'Superseded'),
        ('retracted', 'Retracted'),
    ]
    CAPTURED_BY = [
        ('auto', 'Captured automatically'),
        ('tool', 'Saved by the assistant'),
        ('user', 'Saved by a person'),
    ]

    #: The org this was solved in — fixed at creation, never edited. Null for a
    #: personal chat. A private solution (`shared=False`) keeps its org too,
    #: so it is only ever offered back inside that same org.
    org = models.ForeignKey('core.Organization', on_delete=models.CASCADE,
                            null=True, blank=True, related_name='solutions')
    #: Visible to every member of `org`, or only to its author.
    shared = models.BooleanField(default=False)
    #: Kept as SET_NULL so an org's shared knowledge survives a person
    #: leaving; their *private* rows are deleted with them (`signals.py`).
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                               null=True, related_name='solutions')
    author_name = models.CharField(max_length=150, blank=True, default='')

    problem = models.CharField(max_length=500)
    symptoms = models.TextField(blank=True, default='')
    root_cause = models.TextField(blank=True, default='')
    resolution = models.TextField()
    #: `{"django": "5.1", "service": "billing"}` — what it applied to.
    environment = models.JSONField(default=dict, blank=True)
    #: `[{"text", "kind", "depends_on"}]`; `kind` from `freshness.KINDS`.
    claims = models.JSONField(default=list, blank=True)
    #: The most volatile kind among the claims; drives the page's badge.
    volatility = models.CharField(max_length=20, default='procedure')
    #: How someone else might ask for this. Indexed, never shown as the answer.
    phrasings = models.JSONField(default=list, blank=True)
    tags = models.JSONField(default=list, blank=True)

    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default='active')
    superseded_by = models.ForeignKey('self', on_delete=models.SET_NULL,
                                      null=True, blank=True, related_name='supersedes')
    #: When it was last known true — capture, then every confirmation or
    #: successful re-check. Freshness is computed from this at read time.
    valid_as_of = models.DateTimeField()

    #: A doubt raised by a model or a person, with why. Kept on the row so a
    #: search can show it without a join; the history is `SolutionReview`.
    #: As models improve, a later review can raise or clear it — that is the
    #: point of recording *which* model doubted it.
    doubtful = models.BooleanField(default=False)
    doubt_reason = models.CharField(max_length=500, blank=True, default='')

    confirmations = models.IntegerField(default=0)
    failures = models.IntegerField(default=0)
    reuse_count = models.IntegerField(default=0)
    last_used_at = models.DateTimeField(null=True, blank=True)

    captured_by = models.CharField(max_length=8, choices=CAPTURED_BY, default='tool')
    #: A link to where it came from, readable only by the author: the source
    #: chat is theirs, not the org's.
    source_session = models.CharField(max_length=64, blank=True, default='')
    source_message_id = models.BigIntegerField(null=True, blank=True)
    #: The embedder the stored vectors were made with; rows from another
    #: version are searched by keyword only until re-embedded.
    embed_version = models.CharField(max_length=120, blank=True, default='')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']
        indexes = [
            models.Index(fields=['org', 'shared', 'status']),
            models.Index(fields=['author', 'org', 'status']),
        ]

    def __str__(self):
        return self.problem[:80]


class SolutionReview(models.Model):
    """One judgement on a solution: it worked, it didn't, it looks doubtful.

    `model` is set when a model made the call, so a doubt raised by an older
    model can be revisited by a better one — and so nobody mistakes a model's
    suspicion for a person's report.
    """

    KIND_CHOICES = [
        ('confirmed', 'Worked'),
        ('failed', 'Did not work'),
        ('doubt', 'Looks doubtful'),
        ('cleared', 'Doubt cleared'),
        ('verified', 'Re-checked and still true'),
        ('contradicted', 'Re-checked and no longer true'),
    ]

    solution = models.ForeignKey(Solution, on_delete=models.CASCADE,
                                 related_name='reviews')
    kind = models.CharField(max_length=14, choices=KIND_CHOICES)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                             null=True, blank=True, related_name='+')
    model = models.CharField(max_length=150, blank=True, default='')
    reason = models.CharField(max_length=500, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['solution', '-created_at'])]


class SolutionSignature(models.Model):
    """A normalised error line, for exact matching (`signatures.py`)."""

    solution = models.ForeignKey(Solution, on_delete=models.CASCADE,
                                 related_name='signatures')
    digest = models.CharField(max_length=64, db_index=True)
    text = models.CharField(max_length=300)


class SolutionTerm(models.Model):
    """One keyword posting: term → solution, weighted by field."""

    solution = models.ForeignKey(Solution, on_delete=models.CASCADE,
                                 related_name='terms')
    term = models.CharField(max_length=64, db_index=True)
    weight = models.FloatField()


class SolutionVector(models.Model):
    """One embedding, float16 bytes. `kind` is `question` or `phrasing`."""

    solution = models.ForeignKey(Solution, on_delete=models.CASCADE,
                                 related_name='vectors')
    kind = models.CharField(max_length=10, default='question')
    vector = models.BinaryField()
