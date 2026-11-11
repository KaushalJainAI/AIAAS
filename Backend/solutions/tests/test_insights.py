"""
The team's search log and insight page (K5.1, K5.2).

Who may see the page (members, curators only), what each figure counts, what
the page must never reveal (who asked, another org's questions, a solution
nobody can read any more), and that logging never fails a search.
"""
from __future__ import annotations

from datetime import timedelta
from unittest import mock

from django.utils import timezone
from rest_framework.test import APITestCase

from solutions import api, stale
from solutions.models import Solution, SolutionSearchLog

from .helpers import SolutionsTestMixin

URL = '/api/solutions/insights/'
PROBLEM = 'Celery worker does not pick up tasks after deploy'


def row(org, author, **fields):
    """A solution row with defaults; no index, no notification."""
    defaults = dict(org=org, author=author, author_name=author.username,
                    shared=bool(org), status='active',
                    problem=f'Problem {Solution.objects.count()}',
                    resolution='Do the thing.',
                    claims=[{'text': 'Do the thing.', 'kind': 'procedure'}],
                    valid_as_of=timezone.now(), captured_by='user', tags=[])
    defaults.update(fields)
    return Solution.objects.create(**defaults)


def log(org, user, query, *, source='chat', result_count=0, top=None, days_ago=0):
    """A search-log row, dated `days_ago` in the past (auto_now_add is overridden
    after the insert, the only way to age a row)."""
    entry = SolutionSearchLog.objects.create(
        org=org, user=user, source=source, query=query,
        result_count=result_count, top_solution_id=top,
    )
    if days_ago:
        SolutionSearchLog.objects.filter(id=entry.id).update(
            created_at=timezone.now() - timedelta(days=days_ago))
    return entry


class InsightsBase(SolutionsTestMixin, APITestCase):
    def setUp(self):
        super().setUp()
        self.alice = self.make_user('alice')    # owner, so a curator
        self.bob = self.make_user('bob')        # plain member
        self.carol = self.make_user('carol')    # never a member of Acme
        self.dan = self.make_user('dan')        # member with the curator role
        self.org = self.make_org(self.alice, 'Acme', self.bob)
        self.join(self.org, self.dan, role='curator')
        self.other_org = self.make_org(self.carol, 'Initech')

    def insights(self, user, org_id=None, **extra):
        self.client.force_authenticate(user)
        params = {'org': self.org.id if org_id is None else org_id, **extra}
        return self.client.get(URL, params)


class InsightsAccessTests(InsightsBase):
    def test_a_non_member_gets_the_same_404_as_an_unknown_org(self):
        foreign = self.insights(self.carol)
        unknown = self.insights(self.carol, org_id=999999)
        self.assertEqual(foreign.status_code, 404)
        self.assertEqual(unknown.status_code, 404)
        self.assertEqual(foreign.json(), unknown.json())

    def test_no_org_is_a_404(self):
        self.client.force_authenticate(self.alice)
        self.assertEqual(self.client.get(URL).status_code, 404)
        self.assertEqual(self.client.get(URL, {'org': 'personal'}).status_code, 404)

    def test_a_member_who_is_not_a_curator_is_refused(self):
        response = self.insights(self.bob)
        self.assertEqual(response.status_code, 403)
        self.assertNotIn('solutions', response.json())

    def test_a_curator_gets_the_full_shape(self):
        response = self.insights(self.dan)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(set(body), {'searches', 'answered', 'unanswered', 'solutions',
                                     'contributors', 'top_used', 'gaps'})
        self.assertEqual(set(body['solutions']),
                         {'active', 'needs_attention', 'drafts', 'pending_review'})

    def test_the_owner_is_a_curator(self):
        self.assertEqual(self.insights(self.alice).status_code, 200)


class SearchLogTests(InsightsBase):
    def setUp(self):
        super().setUp()
        self.fix = self.save(self.bob, self.org.id, share=True, problem=PROBLEM,
                             resolution='Restart the worker with the new queue name.')

    def logs(self):
        return SolutionSearchLog.objects.order_by('id')

    def test_a_chat_search_in_an_org_is_logged_with_its_top_result(self):
        found = self.find(self.bob.id, self.org.id, 'celery worker tasks after deploy',
                          log_source='chat')
        self.assertTrue(found['results'])
        entry = self.logs().get()
        self.assertEqual(entry.org_id, self.org.id)
        self.assertEqual(entry.user_id, self.bob.id)
        self.assertEqual(entry.source, 'chat')
        self.assertEqual(entry.result_count, len(found['results']))
        self.assertEqual(entry.top_solution_id, found['results'][0]['id'])

    def test_a_page_search_is_logged_with_source_page(self):
        self.client.force_authenticate(self.bob)
        self.client.get('/api/solutions/', {'org': self.org.id,
                                            'q': 'celery worker tasks after deploy'})
        entry = self.logs().get()
        self.assertEqual(entry.source, 'page')
        self.assertEqual(entry.org_id, self.org.id)

    def test_a_search_with_no_log_source_is_not_logged(self):
        """Capture's duplicate check and the import both search without `log_source`."""
        self.find(self.bob.id, self.org.id, 'celery worker tasks after deploy')
        self.assertEqual(self.logs().count(), 0)

    def test_a_personal_search_is_not_logged(self):
        personal = self.save(self.bob, None, problem=PROBLEM,
                             resolution='Restart the worker.')
        self.assertIsNotNone(personal.id)
        self.find(self.bob.id, None, 'celery worker tasks after deploy', log_source='chat')
        self.assertEqual(self.logs().count(), 0)

    def test_a_non_member_search_is_not_logged(self):
        self.find(self.carol.id, self.org.id, 'celery worker tasks after deploy',
                  log_source='chat')
        self.assertEqual(self.logs().count(), 0)

    def test_a_search_that_finds_nothing_is_logged_as_a_gap(self):
        self.find(self.bob.id, self.org.id, 'kubernetes ingress returns 502',
                  log_source='chat')
        entry = self.logs().get()
        self.assertEqual(entry.result_count, 0)
        self.assertIsNone(entry.top_solution_id)

    def test_a_failing_log_write_does_not_fail_the_search(self):
        with mock.patch.object(SolutionSearchLog.objects, 'acreate',
                               side_effect=RuntimeError('database is down')):
            found = self.find(self.bob.id, self.org.id,
                              'celery worker tasks after deploy', log_source='chat')
        self.assertTrue(found['results'])
        self.assertEqual(self.logs().count(), 0)

    def test_the_logged_query_is_scrubbed_and_short(self):
        self.find(self.bob.id, self.org.id,
                  'why does mail to dev@example.com fail ' + 'x' * 400,
                  log_source='chat')
        stored = self.logs().get().query
        self.assertNotIn('dev@example.com', stored)
        self.assertLessEqual(len(stored), 300)

    def test_an_unknown_source_is_a_programming_error(self):
        with self.assertRaises(ValueError):
            self.find(self.bob.id, self.org.id, 'anything', log_source='email')


class InsightContentTests(InsightsBase):
    def setUp(self):
        super().setUp()
        self.fix = self.save(self.bob, self.org.id, share=True, problem=PROBLEM,
                             resolution='Restart the worker with the new queue name.')

    def test_counts_split_answered_from_unanswered(self):
        log(self.org, self.bob, 'celery worker tasks', result_count=2, top=self.fix.id)
        log(self.org, self.bob, 'kubernetes ingress', result_count=0)
        body = self.insights(self.dan).json()
        self.assertEqual(body['searches'], 2)
        self.assertEqual(body['answered'], 1)
        self.assertEqual(body['unanswered'], 1)

    def test_searches_older_than_thirty_days_are_not_counted(self):
        log(self.org, self.bob, 'old question', result_count=0, days_ago=40)
        log(self.org, self.bob, 'new question', result_count=0)
        self.assertEqual(self.insights(self.dan).json()['searches'], 1)

    def test_gaps_never_include_another_orgs_questions(self):
        log(self.other_org, self.carol, 'initech payroll export broke', result_count=0)
        log(self.org, self.bob, 'acme billing webhook loops', result_count=0)
        gaps = self.insights(self.dan).json()['gaps']
        queries = [g['query'] for g in gaps]
        self.assertIn('acme billing webhook loops', queries)
        self.assertNotIn('initech payroll export broke', queries)

    def test_gaps_group_on_the_normalised_query_and_never_name_who_asked(self):
        log(self.org, self.bob, '  Kubernetes Ingress 502 ', result_count=0)
        log(self.org, self.dan, 'kubernetes ingress 502', result_count=0)
        body = self.insights(self.dan).json()
        self.assertEqual(len(body['gaps']), 1)
        gap = body['gaps'][0]
        self.assertEqual(gap['query'], 'kubernetes ingress 502')
        self.assertEqual(gap['times'], 2)
        self.assertEqual(set(gap), {'query', 'times', 'last_asked'})
        # Who asked is never read out. (The contributors list may name bob for
        # a different reason: he wrote the fix.)
        self.assertNotIn('bob', str(body['gaps']))
        self.assertNotIn('dan', str(body['gaps']))

    def test_top_used_counts_chat_answers_and_ignores_page_browsing(self):
        log(self.org, self.bob, 'celery one', result_count=1, top=self.fix.id)
        log(self.org, self.bob, 'celery two', result_count=1, top=self.fix.id)
        log(self.org, self.bob, 'celery page', source='page', result_count=1,
            top=self.fix.id)
        top = self.insights(self.dan).json()['top_used']
        self.assertEqual(top, [{'id': self.fix.id, 'problem': PROBLEM, 'uses': 2}])

    def test_top_used_drops_a_solution_retracted_since(self):
        log(self.org, self.bob, 'celery one', result_count=1, top=self.fix.id)
        api.retract(self.bob, self.fix.id, self.org.id, 'no longer true')
        self.assertEqual(self.insights(self.dan).json()['top_used'], [])

    def test_contributors_count_shared_solutions_by_author_name(self):
        row(self.org, self.bob, author_name='Bob', problem='one')
        row(self.org, self.bob, author_name='Bob', problem='two')
        row(self.org, self.dan, author_name='Dan', problem='three', shared=False)
        names = {c['name']: c['count'] for c in self.insights(self.dan).json()['contributors']}
        # The fix from setUp is by bob's username, and dan's private row is not shared.
        self.assertEqual(names.get('Bob'), 2)
        self.assertNotIn('Dan', names)

    def test_solution_counts(self):
        row(self.org, self.bob, status='needs_check', problem='stale one')
        row(self.org, self.bob, status='active', doubtful=True, problem='doubted')
        row(self.org, self.bob, status='pending_review', problem='queued')
        row(self.org, self.dan, status='draft', shared=False, problem='my draft')
        row(self.org, self.bob, status='draft', shared=False, problem='bobs draft')
        solutions = self.insights(self.dan).json()['solutions']
        self.assertEqual(solutions['active'], 3)          # setUp fix + stale + doubted
        self.assertEqual(solutions['needs_attention'], 2)  # needs_check + doubted
        self.assertEqual(solutions['pending_review'], 1)
        self.assertEqual(solutions['drafts'], 1)           # only the caller's own

    def test_a_drafts_count_is_the_callers_own_not_the_orgs(self):
        row(self.org, self.bob, status='draft', shared=False, problem='bobs draft')
        self.assertEqual(self.insights(self.alice).json()['solutions']['drafts'], 0)


class RetentionTests(InsightsBase):
    def test_a_search_log_row_is_deleted_after_ninety_one_days(self):
        log(self.org, self.bob, 'ninety one days ago', result_count=0, days_ago=91)
        self.assertEqual(stale.purge_search_logs(), 1)
        self.assertFalse(SolutionSearchLog.objects.exists())

    def test_a_search_log_row_is_kept_at_eighty_nine_days(self):
        log(self.org, self.bob, 'eighty nine days ago', result_count=0, days_ago=89)
        self.assertEqual(stale.purge_search_logs(), 0)
        self.assertEqual(SolutionSearchLog.objects.count(), 1)

    def test_the_weekly_sweep_runs_the_purge(self):
        log(self.org, self.bob, 'ancient', result_count=0, days_ago=120)
        out = stale.run_stale_sweep()
        self.assertEqual(out['search_logs_purged'], 1)
        self.assertFalse(SolutionSearchLog.objects.exists())
