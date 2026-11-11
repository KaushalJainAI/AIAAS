"""Shared fixtures: people, orgs, a deterministic embedder, and a saver."""
from __future__ import annotations

import hashlib

import numpy as np
from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model

from core import orgs
from core.models import Membership, Organization
from solutions import api, index, search

DIM = 64


def fake_vector(text: str) -> np.ndarray:
    """Bag of hashed words: texts sharing words point the same way."""
    vec = np.zeros(DIM, dtype=np.float32)
    for tok in index.tokenize(text):
        vec[int(hashlib.md5(tok.encode()).hexdigest(), 16) % DIM] += 1.0
    norm = float(np.linalg.norm(vec))
    return vec / norm if norm else vec


async def fake_embed(texts, input_type):
    return [fake_vector(t) for t in texts], f'fake:{DIM}'


async def no_embed(texts, input_type):
    return None, ''


class SolutionsTestMixin:
    """Patches the embedder and clears the in-process caches per test."""

    embedder = staticmethod(fake_embed)

    def setUp(self):
        super().setUp()
        self._old_embed = index.EMBED
        index.EMBED = self.embedder
        search.forget_cached_scopes()
        search._QUERY_CACHE.clear()

    def tearDown(self):
        index.EMBED = self._old_embed
        search.forget_cached_scopes()
        search._QUERY_CACHE.clear()
        super().tearDown()

    @staticmethod
    def make_user(name: str):
        return get_user_model().objects.create_user(
            username=name, email=f'{name}@example.test', password='x',
        )

    @staticmethod
    def join(org, user, role='member'):
        """Make `user` a member of `org` directly. Invitations (core/orgs.py
        `invite` + `respond`) are tested in core; these tests need only the
        membership, so they do not depend on that flow or on email verification."""
        Membership.objects.get_or_create(org=org, user=user, defaults={'role': role})

    @classmethod
    def make_org(cls, owner, name='Acme', *members, capture_mode='auto',
                 review_policy='open'):
        """An org configured the way the older tests assume: captured fixes are
        shared at once. New orgs default to `suggest` (K2.1); a workflow test
        asks for that explicitly, by passing `capture_mode='suggest'`."""
        org = orgs.create(owner, name)
        Organization.objects.filter(id=org.id).update(
            capture_mode=capture_mode, review_policy=review_policy)
        org.refresh_from_db()
        for member in members:
            cls.join(org, member)
        return org

    @staticmethod
    def save(user, org_id=None, share=True, **fields):
        fields.setdefault('problem', 'Celery worker does not pick up tasks after deploy')
        fields.setdefault('resolution', 'Restart the worker with the new queue name.')
        solution = api.save(user, org_id=org_id, share=share,
                            draft=api.Draft(**fields), captured_by='tool')
        async_to_sync(index.reindex)(solution.id)
        return solution

    @staticmethod
    def find(user_id, org_id, query, **kw):
        return async_to_sync(search.search)(user_id, org_id, query, **kw)
