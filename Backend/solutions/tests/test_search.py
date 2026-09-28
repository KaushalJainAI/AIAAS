"""
Finding the right past fix — and saying nothing when there isn't one.
"""
from __future__ import annotations

from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from solutions import freshness, signatures
from solutions.models import Solution

from .helpers import SolutionsTestMixin, no_embed

TRACEBACK = """Traceback (most recent call last):
  File "/home/priya/app/worker.py", line 88, in consume
    conn.connect()
kombu.exceptions.OperationalError: [Errno 111] Connection refused
"""


class SignatureTests(TestCase):
    def test_paths_numbers_and_ids_are_normalised_away(self):
        a = signatures.extract(TRACEBACK)
        b = signatures.extract(TRACEBACK.replace('/home/priya/app', '/srv/deploy/app')
                               .replace('line 88', 'line 91'))
        self.assertTrue(a)
        self.assertEqual(a, b)

    def test_ordinary_sentences_are_not_fingerprinted(self):
        self.assertEqual(signatures.extract('How do I set up the staging database?'), [])


class SearchTests(SolutionsTestMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.user = self.make_user('dev')
        self.org = self.make_org(self.user)
        self.celery = self.save(
            self.user, self.org.id,
            problem='Celery worker cannot connect to the broker after deploy',
            symptoms=TRACEBACK,
            resolution='The broker URL still pointed at the old Redis host. Update BROKER_URL and restart.',
            phrasings=['worker connection refused', 'celery broker down after release'],
        )
        self.nginx = self.save(
            self.user, self.org.id,
            problem='Nginx returns 502 Bad Gateway after reload',
            resolution='Gunicorn socket path changed; update proxy_pass.',
        )

    def test_a_pasted_traceback_matches_by_signature(self):
        other_paths = TRACEBACK.replace('/home/priya', '/Users/junior')
        found = self.find(self.user.id, self.org.id, other_paths)
        self.assertEqual(found['results'][0]['id'], self.celery.id)
        self.assertEqual(found['results'][0]['match'], 'error signature')

    def test_different_words_same_meaning(self):
        found = self.find(self.user.id, self.org.id, 'celery broker down after release')
        self.assertEqual(found['results'][0]['id'], self.celery.id)

    def test_unrelated_questions_abstain(self):
        found = self.find(self.user.id, self.org.id, 'what is a good recipe for pancakes')
        self.assertTrue(found['abstained'])
        self.assertEqual(found['results'], [])

    def test_track_record_breaks_ties(self):
        weak = self.save(self.user, self.org.id,
                         problem='Nginx returns 502 Bad Gateway after reload',
                         resolution='Restart nginx twice.', )
        Solution.objects.filter(id=self.nginx.id).update(confirmations=9, failures=1)
        Solution.objects.filter(id=weak.id).update(confirmations=1, failures=0)
        found = self.find(self.user.id, self.org.id, 'nginx 502 bad gateway after reload')
        self.assertEqual(found['results'][0]['id'], self.nginx.id)

    def test_doubtful_and_stale_rows_are_labelled_not_hidden(self):
        Solution.objects.filter(id=self.nginx.id).update(
            doubtful=True, doubt_reason='Socket path is set by the image now.',
            claims=[{'text': 'The socket is /run/gunicorn.sock', 'kind': 'config'}],
            valid_as_of=timezone.now() - timedelta(days=200),
        )
        found = self.find(self.user.id, self.org.id, 'nginx 502 bad gateway after reload')
        hit = next(r for r in found['results'] if r['id'] == self.nginx.id)
        self.assertEqual(hit['doubtful'], 'Socket path is set by the image now.')
        self.assertEqual(hit['checks_needed'], ['The socket is /run/gunicorn.sock'])

    def test_superseded_and_retracted_rows_are_not_returned(self):
        Solution.objects.filter(id=self.nginx.id).update(status='retracted')
        found = self.find(self.user.id, self.org.id, 'nginx 502 bad gateway after reload')
        self.assertNotIn(self.nginx.id, [r['id'] for r in found['results']])


class KeywordOnlyTests(SolutionsTestMixin, TestCase):
    """With the embedder down, words and error text still find it."""

    embedder = staticmethod(no_embed)

    def test_search_still_works_and_says_so(self):
        user = self.make_user('dev2')
        solution = self.save(user, None, problem='Docker build fails with no space left on device',
                             resolution='Run docker system prune.')
        found = self.find(user.id, None, 'docker build no space left on device')
        self.assertEqual(found['results'][0]['id'], solution.id)
        self.assertFalse(found['semantic'])


class FreshnessTests(TestCase):
    def test_windows_by_kind(self):
        now = timezone.now()
        old = now - timedelta(days=100)
        self.assertEqual(freshness.claim_state('principle', old, now=now), 'fresh')
        self.assertEqual(freshness.claim_state('procedure', old, now=now), 'fresh')
        self.assertEqual(freshness.claim_state('config', old, now=now), 'check')
        self.assertEqual(freshness.claim_state('time_sensitive', now - timedelta(days=31), now=now), 'check')

    def test_a_version_change_makes_a_versioned_claim_check_now(self):
        keys, notes = freshness.environment_mismatch({'django': '4.2'}, {'Django': '5.1'})
        self.assertEqual(keys, {'django'})
        claims = freshness.label_claims(
            [{'text': 'Use the old middleware setting', 'kind': 'versioned', 'depends_on': 'django version'}],
            timezone.now(), mismatched_keys=keys,
        )
        self.assertEqual(claims[0]['state'], 'check')
        self.assertIn('4.2', notes[0])

    def test_volatility_is_the_worst_claim(self):
        self.assertEqual(freshness.volatility([{'kind': 'principle'}, {'kind': 'config'}]), 'config')
