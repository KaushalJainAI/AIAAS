"""
The chat tools: the org comes from the conversation, never from an argument.
"""
from __future__ import annotations

import json

from asgiref.sync import async_to_sync
from django.test import TestCase

from agents.grants import ALWAYS_AVAILABLE
from chat.tools import chat_orchestrator_allowed
from chat.tools.solutions import review_solution, save_solution, search_solutions
from solutions.models import Solution, SolutionReview

from .helpers import SolutionsTestMixin


class ToolTests(SolutionsTestMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.user = self.make_user('lead')
        self.org = self.make_org(self.user)
        self.ctx = {'user_id': self.user.id, 'org_id': self.org.id, 'share_solutions': True,
                    'session_id': 'abc', 'model_label': 'openrouter:m1'}

    def call(self, fn, args, **ctx):
        return json.loads(async_to_sync(fn)(args, {**self.ctx, **ctx}))

    def test_the_orchestrator_may_use_them(self):
        for name in ('search_solutions', 'get_solution', 'save_solution', 'review_solution'):
            self.assertIn(name, ALWAYS_AVAILABLE)
            self.assertTrue(chat_orchestrator_allowed(name))

    def test_save_then_find(self):
        out = self.call(save_solution, {'problem': 'Kafka consumer lag keeps growing',
                                        'resolution': 'Raise max.poll.records and add partitions.'})
        self.assertTrue(out['saved'])
        self.assertEqual(out['visible_to'], 'the organisation')
        found = self.call(search_solutions, {'query': 'kafka consumer lag growing'})
        self.assertEqual(found['results'][0]['id'], out['id'])
        self.assertIn('how_to_use', found)

    def test_a_near_duplicate_asks_before_saving(self):
        self.save(self.user, self.org.id, problem='Kafka consumer lag keeps growing',
                  resolution='Raise max.poll.records.')
        out = self.call(save_solution, {'problem': 'Kafka consumer lag keeps growing',
                                        'resolution': 'Add partitions.'})
        self.assertFalse(out['saved'])
        self.assertTrue(out['similar'])
        forced = self.call(save_solution, {'problem': 'Kafka consumer lag keeps growing',
                                           'resolution': 'Add partitions.', 'force_new': True})
        self.assertTrue(forced['saved'])

    def test_a_tainted_turn_cannot_write(self):
        out = self.call(save_solution, {'problem': 'p', 'resolution': 'r'}, tainted_by='read_url')
        self.assertIn('error', out)
        self.assertFalse(Solution.objects.exists())

    def test_doubtful_records_the_model(self):
        solution = self.save(self.user, self.org.id)
        out = self.call(review_solution, {'id': solution.id, 'verdict': 'doubtful',
                                          'reason': 'Restarting drops in-flight tasks.'})
        self.assertTrue(out['doubtful'])
        self.assertEqual(SolutionReview.objects.get(solution=solution).model, 'openrouter:m1')

    def test_a_personal_chat_saves_privately(self):
        out = self.call(save_solution, {'problem': 'Printer offline', 'resolution': 'Reinstall driver.'},
                        org_id=None, share_solutions=True)
        self.assertEqual(out['visible_to'], 'only this user')
