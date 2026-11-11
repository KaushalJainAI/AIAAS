"""
The library list (K4.3) and "Needs attention" (K4.1).

Rows are made with `Solution.objects` directly where a test needs many of them;
the search index is not needed to list rows.
"""
from __future__ import annotations

from datetime import timedelta
from unittest import mock

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APITestCase

from solutions import attention, freshness, views
from solutions.attention import attention_candidates, attention_reasons
from solutions.models import Solution

from .helpers import SolutionsTestMixin

OLD = timedelta(days=400)


def row(org, author, **fields):
    """A saved solution row with sensible defaults; no index, no notification."""
    now = timezone.now()
    defaults = dict(org=org, author=author, author_name=author.username, shared=bool(org),
                    status='active', problem=f'Problem {Solution.objects.count()}',
                    resolution='Do the thing.', claims=[{'text': 'Do the thing.',
                                                         'kind': 'procedure'}],
                    valid_as_of=now, captured_by='user', tags=[])
    defaults.update(fields)
    return Solution.objects.create(**defaults)


class ListFilterTests(SolutionsTestMixin, APITestCase):
    def setUp(self):
        super().setUp()
        self.alice = self.make_user('alice')
        self.bob = self.make_user('bob')
        self.org = self.make_org(self.alice, 'Acme', self.bob)
        self.url = '/api/solutions/'
        self.celery = row(self.org, self.alice, problem='Celery one', tags=['celery'])
        self.redis = row(self.org, self.alice, problem='Redis one', tags=['redis'])
        self.both = row(self.org, self.bob, problem='Celery two', tags=['Celery', 'ops'])

    def get(self, **params):
        self.client.force_authenticate(self.alice)
        query = '&'.join(f'{k}={v}' for k, v in {'org': self.org.id, **params}.items())
        return self.client.get(f'{self.url}?{query}').json()

    def test_tag_filter_matches_case_insensitively(self):
        body = self.get(tag='celery')
        self.assertEqual({s['id'] for s in body['solutions']}, {self.celery.id, self.both.id})
        self.assertEqual(body['total'], 2)
        self.assertIsNone(body['next_offset'])
        self.assertFalse(body['truncated'])

    def test_author_me_keeps_only_my_rows(self):
        self.client.force_authenticate(self.bob)
        body = self.client.get(f'{self.url}?org={self.org.id}&author=me').json()
        self.assertEqual([s['id'] for s in body['solutions']], [self.both.id])

    def test_a_tag_nobody_has_is_an_empty_list_not_an_error(self):
        body = self.get(tag='nothing-here')
        self.assertEqual(body['solutions'], [])
        self.assertEqual(body['total'], 0)

    def test_paging_walks_every_row_once(self):
        row_ids = [row(self.org, self.alice, problem=f'Bulk {i}').id for i in range(105)]
        first = self.get()
        self.assertEqual(len(first['solutions']), 100)
        self.assertEqual(first['total'], 108)
        self.assertTrue(first['truncated'])
        self.assertEqual(first['next_offset'], 100)
        second = self.get(offset=first['next_offset'])
        self.assertEqual(len(second['solutions']), 8)
        self.assertFalse(second['truncated'])
        self.assertIsNone(second['next_offset'])
        seen = [s['id'] for s in first['solutions']] + [s['id'] for s in second['solutions']]
        self.assertEqual(len(seen), len(set(seen)))
        self.assertEqual(set(seen), {s.id for s in Solution.objects.filter(org=self.org)
                                     if s.status == 'active'})
        self.assertTrue(set(row_ids) <= set(seen))

    def test_a_bad_offset_is_treated_as_the_first_page(self):
        self.assertEqual(self.get(offset='abc')['solutions'][0]['id'],
                         self.get(offset=0)['solutions'][0]['id'])
        self.assertEqual(self.get(offset=-5)['total'], 3)

    def test_a_tag_scan_over_the_limit_says_so(self):
        with mock.patch.object(views, 'TAG_SCAN_LIMIT', 2):
            body = self.get(tag='celery')
        self.assertTrue(body['tag_scan_capped'])


class AttentionTests(SolutionsTestMixin, APITestCase):
    def setUp(self):
        super().setUp()
        self.alice = self.make_user('alice')   # curator
        self.bob = self.make_user('bob')       # member
        self.org = self.make_org(self.alice, 'Acme', self.bob)
        self.url = f'/api/solutions/?attention=1&org={self.org.id}'
        self.alices_stale = row(self.org, self.alice, problem='Alice stale',
                                valid_as_of=timezone.now() - OLD)
        self.bobs_stale = row(self.org, self.bob, problem='Bob stale',
                              valid_as_of=timezone.now() - OLD)
        self.bobs_private_stale = row(self.org, self.bob, problem='Bob private stale',
                                      shared=False, valid_as_of=timezone.now() - OLD)
        self.fresh = row(self.org, self.alice, problem='Fresh')

    def problems(self, user, url=None):
        self.client.force_authenticate(user)
        body = self.client.get(url or self.url).json()
        return {s['problem'] for s in body['solutions']}, body

    def test_a_curator_sees_every_shared_stale_row_and_their_own_private_ones(self):
        problems, _ = self.problems(self.alice)
        self.assertEqual(problems, {'Alice stale', 'Bob stale'})

    def test_a_member_sees_only_what_they_wrote(self):
        problems, _ = self.problems(self.bob)
        self.assertEqual(problems, {'Bob stale', 'Bob private stale'})

    def test_fresh_rows_are_not_in_it(self):
        problems, _ = self.problems(self.alice)
        self.assertNotIn('Fresh', problems)

    def test_each_row_says_why(self):
        _, body = self.problems(self.alice)
        for item in body['solutions']:
            self.assertEqual(item['attention'], ['claims_stale'])

    def test_needs_check_comes_first_then_doubtful_then_oldest(self):
        row(self.org, self.alice, problem='Oldest', valid_as_of=timezone.now() - OLD * 2)
        row(self.org, self.alice, problem='Doubted', doubtful=True,
            valid_as_of=timezone.now())
        row(self.org, self.alice, problem='Checking', status='needs_check',
            valid_as_of=timezone.now())
        self.client.force_authenticate(self.alice)
        order = [s['problem'] for s in self.client.get(self.url).json()['solutions']]
        self.assertEqual(order[:3], ['Checking', 'Doubted', 'Oldest'])
        self.assertEqual(set(order[3:]), {'Alice stale', 'Bob stale'})

    def test_a_cut_list_says_truncated(self):
        with mock.patch.object(attention, 'ATTENTION_LOAD', 1):
            self.client.force_authenticate(self.alice)
            body = self.client.get(self.url).json()
        self.assertTrue(body['truncated'])
        self.assertEqual(len(body['solutions']), 1)

    def test_a_personal_row_is_judged_for_its_author(self):
        mine = row(None, self.bob, problem='Personal stale', shared=False,
                   valid_as_of=timezone.now() - OLD)
        self.assertIsNone(mine.org_id)
        problems, _ = self.problems(self.bob, url='/api/solutions/?attention=1')
        self.assertEqual(problems, {'Personal stale'})

    def test_a_non_member_gets_nothing(self):
        carol = self.make_user('carol')
        problems, body = self.problems(carol)
        self.assertEqual(problems, set())
        self.assertEqual(body['solutions'], [])

    def test_tag_and_author_filters_apply_to_attention_too(self):
        Solution.objects.filter(id=self.bobs_stale.id).update(tags=['redis'])
        self.client.force_authenticate(self.alice)
        body = self.client.get(f'{self.url}&tag=redis').json()
        self.assertEqual([s['problem'] for s in body['solutions']], ['Bob stale'])
        body = self.client.get(f'{self.url}&author=me').json()
        self.assertEqual([s['problem'] for s in body['solutions']], ['Alice stale'])


class AttentionRuleTests(TestCase):
    def test_the_database_prefilter_never_drops_a_flagged_row(self):
        now = timezone.now()
        cases = {
            'needs_check': dict(status='needs_check'),
            'doubted': dict(doubtful=True),
            'old_procedure': dict(valid_as_of=now - OLD),
            'ten_day_time_sensitive': dict(
                valid_as_of=now - timedelta(days=10),
                claims=[{'text': 'x', 'kind': 'time_sensitive'}]),
        }
        for name, fields in cases.items():
            base = dict(problem=name, resolution='r', claims=[{'text': 'x', 'kind': 'procedure'}],
                        valid_as_of=now, captured_by='user', shared=False)
            base.update(fields)
            solution = Solution.objects.create(**base)
            flagged = bool(attention_reasons(solution, now=now))
            candidate = attention_candidates(
                Solution.objects.filter(id=solution.id), now=now).exists()
            self.assertEqual(flagged, name != 'ten_day_time_sensitive', name)
            if flagged:
                self.assertTrue(candidate, f'{name} flagged but not a candidate')

    def test_shortest_window_matches_the_freshness_table(self):
        finite = [days for days in freshness.KINDS.values() if days]
        self.assertEqual(attention.SHORTEST_WINDOW, timedelta(days=min(finite)))
