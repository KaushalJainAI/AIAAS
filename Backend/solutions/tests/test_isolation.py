"""
The organisation boundary. Nothing captured in one org may be found from
another, by anyone, through any door.

These are the guarantees the feature is only safe with, so each is pinned
against the real search, the real API, and the real query door.
"""
from __future__ import annotations

import pathlib
import re

from django.test import TestCase
from rest_framework.test import APITestCase

from core import orgs
from solutions.access import get_visible, visible

from .helpers import SolutionsTestMixin

QUERY = 'celery worker not picking up tasks after deploy'


class OrgBoundaryTests(SolutionsTestMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.alice = self.make_user('alice')      # org A
        self.bob = self.make_user('bob')          # org A
        self.carol = self.make_user('carol')      # org B
        self.org_a = self.make_org(self.alice, 'A', self.bob)
        self.org_b = self.make_org(self.carol, 'B')
        self.shared = self.save(self.alice, self.org_a.id, share=True)

    def test_a_colleague_in_the_same_org_finds_it(self):
        found = self.find(self.bob.id, self.org_a.id, QUERY)
        self.assertEqual([r['id'] for r in found['results']], [self.shared.id])

    def test_another_org_finds_nothing(self):
        self.assertEqual(self.find(self.carol.id, self.org_b.id, QUERY)['results'], [])

    def test_naming_an_org_you_are_not_in_finds_nothing(self):
        """The org id comes from the chat, but even a forged one is useless."""
        self.assertEqual(self.find(self.carol.id, self.org_a.id, QUERY)['results'], [])
        self.assertIsNone(get_visible(self.carol.id, self.org_a.id, self.shared.id))

    def test_a_personal_chat_does_not_see_org_solutions(self):
        self.assertEqual(self.find(self.alice.id, None, QUERY)['results'], [])

    def test_removal_cuts_access_on_the_next_query(self):
        self.assertTrue(self.find(self.bob.id, self.org_a.id, QUERY)['results'])
        orgs.remove_member(self.alice, self.org_a.id, self.bob.id)
        self.assertEqual(self.find(self.bob.id, self.org_a.id, QUERY)['results'], [])

    def test_a_private_solution_stays_with_its_author(self):
        private = self.save(self.bob, self.org_a.id, share=False,
                            problem='Nginx returns 502 after a config reload')
        self.assertIsNotNone(get_visible(self.bob.id, self.org_a.id, private.id))
        self.assertIsNone(get_visible(self.alice.id, self.org_a.id, private.id))

    def test_a_two_org_person_cannot_carry_a_fix_across(self):
        """Carol joins org A too. Her private fix from an org-A chat is not
        offered in her org-B chats, and vice versa."""
        orgs.add_member(self.alice, self.org_a.id, self.carol.email)
        in_a = self.save(self.carol, self.org_a.id, share=False,
                         problem='Redis connection refused in staging')
        found_in_b = self.find(self.carol.id, self.org_b.id, 'redis connection refused staging')
        self.assertNotIn(in_a.id, [r['id'] for r in found_in_b['results']])
        found_in_a = self.find(self.carol.id, self.org_a.id, 'redis connection refused staging')
        self.assertIn(in_a.id, [r['id'] for r in found_in_a['results']])

    def test_leaving_takes_even_your_own_private_org_rows(self):
        """They were captured from that org's conversations."""
        private = self.save(self.bob, self.org_a.id, share=False, problem='VPN drops at 5pm')
        orgs.remove_member(self.bob, self.org_a.id, self.bob.id)
        self.assertIsNone(get_visible(self.bob.id, self.org_a.id, private.id))

    def test_deleting_the_org_deletes_its_solutions(self):
        orgs.delete(self.alice, self.org_a.id)
        self.assertFalse(visible(self.alice.id, self.org_a.id).exists())
        from solutions.models import Solution

        self.assertFalse(Solution.objects.filter(id=self.shared.id).exists())


class ApiBoundaryTests(SolutionsTestMixin, APITestCase):
    def setUp(self):
        super().setUp()
        self.alice = self.make_user('alice')
        self.carol = self.make_user('carol')
        self.org_a = self.make_org(self.alice, 'A')
        self.org_b = self.make_org(self.carol, 'B')
        self.shared = self.save(self.alice, self.org_a.id, share=True)

    def test_foreign_and_unknown_ids_are_the_same_404(self):
        self.client.force_authenticate(self.carol)
        foreign = self.client.get(f'/api/solutions/{self.shared.id}/?org={self.org_a.id}')
        unknown = self.client.get(f'/api/solutions/999999/?org={self.org_b.id}')
        self.assertEqual(foreign.status_code, 404)
        self.assertEqual(unknown.status_code, 404)
        self.assertEqual(foreign.json(), unknown.json())

    def test_the_list_from_another_org_is_empty(self):
        self.client.force_authenticate(self.carol)
        body = self.client.get(f'/api/solutions/?org={self.org_a.id}').json()
        self.assertEqual(body['solutions'], [])
        body = self.client.get(f'/api/solutions/?org={self.org_a.id}&q=celery').json()
        self.assertEqual(body['solutions'], [])

    def test_a_bad_org_parameter_never_falls_back_to_personal(self):
        self.client.force_authenticate(self.alice)
        self.save(self.alice, None, problem='My laptop fan is loud')
        body = self.client.get('/api/solutions/?org=not-a-number').json()
        self.assertEqual(body['solutions'], [])

    def test_reviews_from_outside_are_refused(self):
        self.client.force_authenticate(self.carol)
        resp = self.client.post(f'/api/solutions/{self.shared.id}/review/',
                                {'org': self.org_a.id, 'kind': 'doubt', 'reason': 'x'},
                                format='json')
        self.assertEqual(resp.status_code, 404)


class ChokePointTests(TestCase):
    """Only the access door and the writers may query `Solution.objects`."""

    ALLOWED = {'access.py', 'api.py', 'capture.py', 'signals.py', 'index.py',
               'search.py', 'admin.py', 'models.py'}

    def test_no_other_module_queries_solutions_directly(self):
        root = pathlib.Path(__file__).resolve().parents[2]
        offenders = []
        for path in root.rglob('*.py'):
            rel = path.relative_to(root).as_posix()
            if rel.startswith(('venv/', 'solutions/tests/', 'solutions/migrations/')) \
                    or '/tests/' in rel:
                continue
            text = path.read_text(encoding='utf-8', errors='ignore')
            if re.search(r'\bSolution\.objects\b', text):
                if not (rel.startswith('solutions/') and path.name in self.ALLOWED):
                    offenders.append(rel)
        self.assertEqual(offenders, [], 'Read solutions through solutions/access.py')
