"""
The undo routes (docs/UNDO_PLAN.md §6.8) and the `change_set` field on an
execution's detail.

What these pin: a set's sheet is capped and says so; a revert answers 200 with
the outcome list, 409 with the reason when the set is live, and 400 for a
malformed `change_ids`; an unknown id and a foreign id get the same 404 body;
and a run's detail carries its change set summary, or null when it has none.
"""
from __future__ import annotations

from unittest import mock

from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from inference import vfs
from logs.tests.test_undo_documents import UndoCase
from workflow_backend import thresholds

User = get_user_model()

NOT_FOUND = {'detail': 'Not found.'}


class UndoApiCase(UndoCase):
    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def finished_run_with_a_file(self, path='/a.md'):
        log = self.new_run()
        with self.in_run(log):
            vfs.write_file(self.scope, path, 'made by the run')
        self.end(log)
        return log

    def sheet_url(self, change_set):
        return f'/api/logs/changes/sets/{change_set.pk}/'

    def revert_url(self, change_set):
        return f'/api/logs/changes/sets/{change_set.pk}/revert/'


class SheetTests(UndoApiCase):
    def test_the_sheet_lists_each_change_with_its_outcome_fields(self):
        log = self.finished_run_with_a_file()
        change_set = self.set_of(log)

        response = self.client.get(self.sheet_url(change_set))

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertFalse(body['live'])
        self.assertIsNone(body['live_reason'])
        self.assertFalse(body['truncated'])
        self.assertEqual(body['set']['id'], change_set.pk)
        [change] = body['set']['changes']
        self.assertEqual(change['label'], '/a.md')
        self.assertEqual(change['target_type'], 'document')
        self.assertTrue(change['revertible'])
        self.assertEqual(change['outcome'], '')
        self.assertEqual(change['tool'], 'write_file')
        self.assertEqual(set(change), {'id', 'label', 'target_type', 'revertible',
                                       'reason', 'outcome', 'outcome_note', 'tool'})

    def test_a_live_run_shows_its_reason_on_the_sheet(self):
        log = self.new_run(name='Researcher')
        with self.in_run(log):
            vfs.write_file(self.scope, '/a.md', 'writing')

        body = self.client.get(self.sheet_url(self.set_of(log))).json()

        self.assertTrue(body['live'])
        self.assertIn("'Researcher' is still running", body['live_reason'])

    def test_the_sheet_is_capped_and_says_truncated(self):
        log = self.new_run()
        with self.in_run(log):
            for n in range(3):
                vfs.write_file(self.scope, f'/f{n}.md', 'x')
        self.end(log)

        with mock.patch.object(thresholds, 'CHANGE_LIST_LIMIT', 2):
            body = self.client.get(self.sheet_url(self.set_of(log))).json()

        self.assertTrue(body['truncated'])
        self.assertEqual(body['total'], 3)
        self.assertEqual(len(body['set']['changes']), 2)

    def test_an_unknown_id_and_a_foreign_id_get_the_same_404(self):
        log = self.finished_run_with_a_file()
        other = User.objects.create_user('other', 'other@example.com', 'pw')
        foreign_client = APIClient()
        foreign_client.force_authenticate(other)

        foreign = foreign_client.get(self.sheet_url(self.set_of(log)))
        unknown = self.client.get('/api/logs/changes/sets/999999/')

        self.assertEqual(foreign.status_code, 404)
        self.assertEqual(unknown.status_code, 404)
        self.assertEqual(foreign.json(), NOT_FOUND)
        self.assertEqual(unknown.json(), NOT_FOUND)


class RevertApiTests(UndoApiCase):
    def test_a_revert_answers_with_the_outcomes(self):
        log = self.finished_run_with_a_file()

        response = self.client.post(self.revert_url(self.set_of(log)), {}, format='json')

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['reverted'], 1)
        self.assertEqual(body['status'], 'reverted')
        self.assertEqual(body['outcomes'][0]['outcome'], 'reverted')
        self.assertIsNotNone(self.any_doc('a.md').deleted_at)

    def test_a_second_revert_answers_200_with_nothing_to_do(self):
        log = self.finished_run_with_a_file()
        self.client.post(self.revert_url(self.set_of(log)), {}, format='json')

        response = self.client.post(self.revert_url(self.set_of(log)), {}, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['outcomes'], [])
        self.assertEqual(response.json()['already_reverted'], 1)

    def test_a_live_run_is_409_with_the_reason(self):
        log = self.new_run(name='Researcher')
        with self.in_run(log):
            vfs.write_file(self.scope, '/a.md', 'writing')

        response = self.client.post(self.revert_url(self.set_of(log)), {}, format='json')

        self.assertEqual(response.status_code, 409)
        self.assertIn("'Researcher' is still running", response.json()['detail'])

    def test_a_foreign_or_unknown_set_is_404_with_the_same_body(self):
        log = self.finished_run_with_a_file()
        other = User.objects.create_user('other', 'other@example.com', 'pw')
        foreign_client = APIClient()
        foreign_client.force_authenticate(other)

        foreign = foreign_client.post(self.revert_url(self.set_of(log)), {}, format='json')
        unknown = self.client.post('/api/logs/changes/sets/999999/revert/', {}, format='json')

        self.assertEqual(foreign.status_code, 404)
        self.assertEqual(foreign.json(), NOT_FOUND)
        self.assertEqual(unknown.json(), NOT_FOUND)
        self.assertIsNone(self.any_doc('a.md').deleted_at)

    def test_a_change_id_outside_the_set_is_404_with_the_same_body(self):
        log = self.finished_run_with_a_file()

        response = self.client.post(self.revert_url(self.set_of(log)),
                                    {'change_ids': [999999]}, format='json')

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), NOT_FOUND)

    def test_change_ids_must_be_a_list_of_ints_within_the_cap(self):
        log = self.finished_run_with_a_file()
        url = self.revert_url(self.set_of(log))

        not_a_list = self.client.post(url, {'change_ids': 'one'}, format='json')
        not_ints = self.client.post(url, {'change_ids': ['x']}, format='json')
        too_many = self.client.post(
            url, {'change_ids': list(range(1, thresholds.CHANGE_LIST_LIMIT + 2))}, format='json')

        self.assertEqual(not_a_list.status_code, 400)
        self.assertEqual(not_ints.status_code, 400)
        self.assertEqual(too_many.status_code, 400)
        self.assertIsNone(self.any_doc('a.md').deleted_at)

    def test_a_subset_by_change_id_reverts_only_that_change(self):
        log = self.new_run()
        with self.in_run(log):
            vfs.write_file(self.scope, '/a.md', 'a')
            vfs.write_file(self.scope, '/b.md', 'b')
        self.end(log)
        a_change = self.rows(self.set_of(log)).get(label='/a.md')

        response = self.client.post(self.revert_url(self.set_of(log)),
                                    {'change_ids': [a_change.pk]}, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['reverted'], 1)
        self.assertIsNone(self.any_doc('b.md').deleted_at)


class ExecutionDetailTests(UndoApiCase):
    def test_the_execution_detail_carries_its_change_set(self):
        log = self.finished_run_with_a_file()

        response = self.client.get(f'/api/logs/executions/{log.execution_id}/')

        self.assertEqual(response.status_code, 200)
        summary = response.json()['change_set']
        self.assertEqual(summary['set_id'], self.set_of(log).pk)
        self.assertEqual(summary['total'], 1)
        self.assertEqual(summary['revertible'], 1)

    def test_a_run_with_no_changes_has_a_null_change_set(self):
        log = self.new_run()
        self.end(log)

        response = self.client.get(f'/api/logs/executions/{log.execution_id}/')

        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()['change_set'])
