"""
Drafts, sharing on purpose, and curators (K2).

Where a new solution starts is one table (`api.starting_state`); the first
block pins every row of it. The rest pins what the table cannot say: who can
see a draft or a row waiting for review, what approving and sending back do,
what a correction does while it waits, and what the chat card is told.
"""
from __future__ import annotations

from unittest import mock

from asgiref.sync import async_to_sync
from django.core.cache import cache
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APITestCase

from chat.models import ChatMessage, ChatSession
from core import orgs
from core.models import Membership, Organization
from notifications.models import Notification
from solutions import api, capture
from solutions.access import can_manage, get_visible, visible
from solutions.models import Solution, SolutionReview

from .helpers import SolutionsTestMixin

PROBLEM = 'Celery worker does not pick up tasks after deploy'
QUERY = 'celery worker not picking up tasks after deploy'


def org_with(capture_mode='auto', review_policy='open'):
    """An unsaved org: `starting_state` reads only these two fields."""
    return Organization(capture_mode=capture_mode, review_policy=review_policy)


# ── The starting_state table, one test per row ──────────────────────────────

class StartingStateTableTests(SimpleTestCase):
    def test_personal_chat_is_active_and_private(self):
        for captured_by in ('auto', 'tool', 'user'):
            self.assertEqual(api.starting_state(None, captured_by=captured_by, share=True),
                             ('active', False), captured_by)

    def test_auto_or_tool_in_a_suggest_org_is_a_draft_whatever_the_share(self):
        for review in ('open', 'curated'):
            for share in (False, True):
                for captured_by in ('auto', 'tool'):
                    self.assertEqual(
                        api.starting_state(org_with('suggest', review),
                                           captured_by=captured_by, share=share),
                        ('draft', False), (review, share, captured_by))

    def test_auto_in_an_auto_org_without_share_is_active_and_private(self):
        for review in ('open', 'curated'):
            for captured_by in ('auto', 'tool'):
                self.assertEqual(
                    api.starting_state(org_with('auto', review), captured_by=captured_by, share=False),
                    ('active', False), (review, captured_by))

    def test_auto_in_an_auto_org_with_share_and_open_review_is_shared_at_once(self):
        for captured_by in ('auto', 'tool'):
            self.assertEqual(
                api.starting_state(org_with('auto', 'open'), captured_by=captured_by, share=True),
                ('active', True), captured_by)

    def test_auto_in_an_auto_org_with_share_and_curated_review_waits(self):
        for captured_by in ('auto', 'tool'):
            self.assertEqual(
                api.starting_state(org_with('auto', 'curated'), captured_by=captured_by, share=True),
                ('pending_review', True), captured_by)

    def test_a_person_without_share_is_active_and_private_in_any_org(self):
        for capture_mode in ('suggest', 'auto'):
            for review in ('open', 'curated'):
                self.assertEqual(
                    api.starting_state(org_with(capture_mode, review), captured_by='user',
                                       share=False),
                    ('active', False), (capture_mode, review))

    def test_a_person_sharing_with_open_review_is_shared_at_once(self):
        for capture_mode in ('suggest', 'auto'):
            self.assertEqual(
                api.starting_state(org_with(capture_mode, 'open'), captured_by='user', share=True),
                ('active', True), capture_mode)

    def test_a_person_sharing_with_curated_review_waits(self):
        for capture_mode in ('suggest', 'auto'):
            self.assertEqual(
                api.starting_state(org_with(capture_mode, 'curated'), captured_by='user',
                                   share=True),
                ('pending_review', True), capture_mode)

    def test_an_import_is_always_a_draft(self):
        for org in (None, org_with('auto', 'open'), org_with('suggest', 'curated')):
            self.assertEqual(api.starting_state(org, captured_by='import', share=True),
                             ('draft', False))


# ── Who can see what ────────────────────────────────────────────────────────

class WorkflowBase(SolutionsTestMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.owner = self.make_user('owner')
        self.writer = self.make_user('writer')     # a member who solves things
        self.reader = self.make_user('reader')     # another member
        self.curator = self.make_user('curator')
        self.org = self.make_org(self.owner, 'Acme', self.writer, self.reader,
                                 capture_mode='suggest')
        self.join(self.org, self.curator, role='curator')

    def set_policy(self, *, review_policy=None, capture_mode=None):
        fields = {}
        if review_policy:
            fields['review_policy'] = review_policy
        if capture_mode:
            fields['capture_mode'] = capture_mode
        Organization.objects.filter(id=self.org.id).update(**fields)

    def new(self, user, *, captured_by='auto', share=True, org=None, **fields):
        """A solution saved the way capture or a tool saves it."""
        org = org or self.org
        fields.setdefault('problem', PROBLEM)
        fields.setdefault('resolution', 'Restart the worker with the new queue name.')
        solution = api.save(user, org_id=org.id if org else None, share=share,
                            draft=api.Draft(**fields), captured_by=captured_by)
        async_to_sync(api.aindex)(solution.id)
        return solution

    def find(self, user, org=None, query=QUERY):
        from solutions.search import search

        org = org if org is not None else self.org
        return async_to_sync(search)(user.id, org.id if org else None, query,
                                     record_use=False)['results']


class DraftVisibilityTests(WorkflowBase):
    def test_a_draft_is_saved_private_and_unsearched_even_by_its_author(self):
        draft = self.new(self.writer)
        self.assertEqual(draft.status, 'draft')
        self.assertFalse(draft.shared)
        self.assertEqual(self.find(self.writer), [])

    def test_a_draft_is_invisible_to_other_members_and_curators(self):
        draft = self.new(self.writer)
        for user in (self.reader, self.curator, self.owner):
            self.assertIsNone(get_visible(user.id, self.org.id, draft.id, include_inactive=True),
                              user.username)

    def test_the_author_sees_their_draft_in_the_org_scope(self):
        draft = self.new(self.writer)
        self.assertIsNotNone(get_visible(self.writer.id, self.org.id, draft.id,
                                         include_inactive=True))

    def test_a_draft_is_not_offered_outside_its_org(self):
        draft = self.new(self.writer)
        self.assertIsNone(get_visible(self.writer.id, None, draft.id, include_inactive=True))

    def test_a_discarded_draft_is_found_by_no_one(self):
        draft = self.new(self.writer)
        api.discard(self.writer, draft.id, self.org.id)
        self.assertEqual(Solution.objects.get(id=draft.id).status, 'retracted')
        self.assertEqual(self.find(self.writer), [])


class PendingVisibilityTests(WorkflowBase):
    def setUp(self):
        super().setUp()
        self.set_policy(review_policy='curated')
        self.pending = self.new(self.writer, captured_by='user', share=True)

    def test_a_waiting_solution_is_visible_to_its_author_and_to_curators_only(self):
        self.assertEqual(self.pending.status, 'pending_review')
        self.assertIsNotNone(get_visible(self.writer.id, self.org.id, self.pending.id,
                                         include_inactive=True))
        self.assertIsNotNone(get_visible(self.curator.id, self.org.id, self.pending.id,
                                         include_inactive=True))
        self.assertIsNone(get_visible(self.reader.id, self.org.id, self.pending.id,
                                      include_inactive=True))

    def test_a_waiting_solution_is_not_in_any_other_members_list(self):
        listed = visible(self.reader.id, self.org.id, include_inactive=True)
        self.assertFalse(listed.filter(id=self.pending.id).exists())

    def test_a_waiting_solution_is_never_searched(self):
        for user in (self.writer, self.reader, self.curator):
            self.assertEqual(self.find(user), [], user.username)

    def test_a_curator_of_another_org_sees_none_of_this_queue(self):
        other_owner = self.make_user('other-owner')
        other_org = self.make_org(other_owner, 'Other', capture_mode='suggest')
        other_curator = self.make_user('other-curator')
        self.join(other_org, other_curator, role='curator')
        self.assertIsNone(get_visible(other_curator.id, self.org.id, self.pending.id,
                                      include_inactive=True))
        self.assertFalse(visible(other_curator.id, self.org.id,
                                 include_inactive=True).filter(id=self.pending.id).exists())


# ── Publish, discard, approve, send back ────────────────────────────────────

class PublishTests(WorkflowBase):
    def test_publishing_into_the_team_in_an_open_org_shares_at_once(self):
        draft = self.new(self.writer)
        published = api.publish(self.writer, draft.id, self.org.id, share=True)
        self.assertEqual((published.status, published.shared), ('active', True))
        self.assertIn(published.id, [r['id'] for r in self.find(self.reader)])
        self.assertTrue(SolutionReview.objects.filter(
            solution=draft, kind='edited', reason='Published from a draft').exists())

    def test_keeping_it_private_leaves_it_with_the_author(self):
        draft = self.new(self.writer)
        published = api.publish(self.writer, draft.id, self.org.id, share=False)
        self.assertEqual((published.status, published.shared), ('active', False))
        self.assertEqual(self.find(self.reader), [])
        self.assertEqual([r['id'] for r in self.find(self.writer)], [published.id])

    def test_publishing_into_a_curated_org_waits_for_a_curator(self):
        self.set_policy(review_policy='curated')
        draft = self.new(self.writer)
        published = api.publish(self.writer, draft.id, self.org.id, share=True)
        self.assertEqual(published.status, 'pending_review')
        self.assertIsNone(get_visible(self.reader.id, self.org.id, published.id,
                                      include_inactive=True))

    def test_publishing_someone_elses_draft_is_a_404(self):
        draft = self.new(self.writer)
        with self.assertRaises(api.SolutionError) as caught:
            api.publish(self.reader, draft.id, self.org.id, share=True)
        self.assertEqual(caught.exception.status, 404)

    def test_only_a_draft_can_be_published(self):
        shared = self.new(self.writer, captured_by='user', share=True)
        with self.assertRaises(api.SolutionError):
            api.publish(self.writer, shared.id, self.org.id, share=True)

    def test_discard_keeps_the_row_and_blocks_capturing_the_same_answer_again(self):
        draft = api.save(self.writer, org_id=self.org.id, share=True,
                         draft=api.Draft(problem=PROBLEM, resolution='Restart the worker.'),
                         captured_by='auto', source_message_id=4242)
        api.discard(self.writer, draft.id, self.org.id)
        row = Solution.objects.get(id=draft.id)
        self.assertEqual(row.status, 'retracted')
        with self.assertRaises(api.SolutionError) as caught:
            api.save(self.writer, org_id=self.org.id, share=True,
                     draft=api.Draft(problem=PROBLEM, resolution='Restart the worker.'),
                     captured_by='auto', source_message_id=4242)
        self.assertEqual(caught.exception.status, 409)

    def test_only_a_draft_can_be_discarded(self):
        shared = self.new(self.writer, captured_by='user', share=True)
        with self.assertRaises(api.SolutionError):
            api.discard(self.writer, shared.id, self.org.id)


class ApproveAndSendBackTests(WorkflowBase):
    def setUp(self):
        super().setUp()
        self.set_policy(review_policy='curated')
        self.pending = self.new(self.writer, captured_by='user', share=True)

    def test_a_member_cannot_approve_their_own_solution(self):
        with self.assertRaises(api.SolutionError) as caught:
            api.approve(self.writer, self.pending.id, self.org.id)
        self.assertEqual(caught.exception.status, 403)  # the row is theirs, so they see it

    def test_another_member_cannot_approve_it_because_they_cannot_see_it(self):
        with self.assertRaises(api.SolutionError) as caught:
            api.approve(self.reader, self.pending.id, self.org.id)
        self.assertEqual(caught.exception.status, 404)

    def test_a_curator_approves_it_into_the_library_and_the_author_is_told(self):
        approved = api.approve(self.curator, self.pending.id, self.org.id)
        self.assertEqual((approved.status, approved.shared), ('active', True))
        self.assertIn(approved.id, [r['id'] for r in self.find(self.reader)])
        self.assertTrue(Notification.objects.filter(
            user=self.writer, title='Approved for the team').exists())
        self.assertTrue(SolutionReview.objects.filter(
            solution=approved, kind='cleared', reason='Approved for the team').exists())

    def test_approving_something_not_waiting_is_refused(self):
        api.approve(self.curator, self.pending.id, self.org.id)
        with self.assertRaises(api.SolutionError) as caught:
            api.approve(self.curator, self.pending.id, self.org.id)
        self.assertEqual(caught.exception.status, 400)

    def test_send_back_needs_a_reason(self):
        for reason in ('', '   '):
            with self.assertRaises(api.SolutionError):
                api.send_back(self.curator, self.pending.id, self.org.id, reason)
        self.assertEqual(Solution.objects.get(id=self.pending.id).status, 'pending_review')

    def test_send_back_makes_it_the_authors_private_fix_and_tells_them_why(self):
        returned = api.send_back(self.curator, self.pending.id, self.org.id,
                                 'The restart drops in-flight tasks; say so first.')
        self.assertEqual((returned.status, returned.shared), ('active', False))
        self.assertIsNotNone(get_visible(self.writer.id, self.org.id, returned.id,
                                         include_inactive=True))
        self.assertEqual([r['id'] for r in self.find(self.reader)], [])
        note = Notification.objects.get(user=self.writer, title='Sent back to you')
        self.assertIn('drops in-flight tasks', note.message)

    def test_a_member_cannot_send_back(self):
        with self.assertRaises(api.SolutionError) as caught:
            api.send_back(self.writer, self.pending.id, self.org.id, 'no')
        self.assertEqual(caught.exception.status, 403)

    def test_withdrawing_a_waiting_share_returns_it_to_the_author(self):
        withdrawn = api.set_shared(self.writer, self.pending.id, self.org.id, False)
        self.assertEqual((withdrawn.status, withdrawn.shared), ('active', False))


class ShareTests(WorkflowBase):
    def test_sharing_a_private_fix_in_a_curated_org_goes_to_the_queue(self):
        self.set_policy(review_policy='curated')
        private = self.new(self.writer, captured_by='user', share=False)
        result = api.set_shared(self.writer, private.id, self.org.id, True)
        self.assertEqual((result.status, result.shared), ('pending_review', True))
        self.assertTrue(Notification.objects.filter(
            user=self.curator, data__kind='solution_review_queue').exists())

    def test_sharing_in_an_open_org_shares_at_once(self):
        private = self.new(self.writer, captured_by='user', share=False)
        result = api.set_shared(self.writer, private.id, self.org.id, True)
        self.assertEqual((result.status, result.shared), ('active', True))

    def test_a_draft_cannot_be_shared_by_this_route(self):
        draft = self.new(self.writer)
        with self.assertRaises(api.SolutionError):
            api.set_shared(self.writer, draft.id, self.org.id, True)

    def test_a_curator_can_edit_and_retract_a_shared_solution(self):
        shared = self.new(self.writer, captured_by='user', share=True)
        self.assertTrue(can_manage(self.curator.id, shared))
        edited = api.edit(self.curator, shared.id, self.org.id,
                          api.Draft(problem=PROBLEM, resolution='Restart the worker, new queue.'))
        self.assertIn('new queue', edited.resolution)
        api.retract(self.curator, shared.id, self.org.id, 'Superseded by the platform team.')
        self.assertEqual(Solution.objects.get(id=shared.id).status, 'retracted')

    def test_a_curator_cannot_change_roles(self):
        with self.assertRaises(orgs.OrgError) as caught:
            orgs.set_role(self.curator, self.org.id, self.reader.id, 'admin')
        self.assertEqual(caught.exception.status, 403)
        with self.assertRaises(orgs.OrgError):
            orgs.remove_member(self.curator, self.org.id, self.reader.id)


# ── A correction waits with the fix it replaces ─────────────────────────────

class CorrectionTests(WorkflowBase):
    def setUp(self):
        super().setUp()
        self.old = self.new(self.writer, captured_by='user', share=True,
                            problem='Build fails: missing libssl',
                            resolution='Install libssl-dev.')

    def test_a_correction_drafted_leaves_the_team_fix_in_place_until_shared(self):
        correction = api.save(self.writer, org_id=self.org.id, share=True,
                              draft=api.Draft(problem='Build fails: missing libssl',
                                              resolution='Install libssl3 instead.'),
                              captured_by='auto', supersedes_id=self.old.id)
        self.assertEqual(correction.status, 'draft')
        self.assertEqual(Solution.objects.get(id=self.old.id).status, 'active')
        api.publish(self.writer, correction.id, self.org.id, share=True)
        self.old.refresh_from_db()
        self.assertEqual(self.old.status, 'superseded')
        self.assertEqual(self.old.superseded_by_id, correction.id)

    def test_a_correction_in_a_curated_org_retires_the_old_fix_only_when_approved(self):
        self.set_policy(review_policy='curated')
        correction = api.save(self.writer, org_id=self.org.id, share=True,
                              draft=api.Draft(problem='Build fails: missing libssl',
                                              resolution='Install libssl3 instead.'),
                              captured_by='auto', supersedes_id=self.old.id)
        self.assertEqual(correction.status, 'draft')
        api.publish(self.writer, correction.id, self.org.id, share=True)
        self.assertEqual(Solution.objects.get(id=self.old.id).status, 'active')
        api.approve(self.curator, correction.id, self.org.id)
        self.old.refresh_from_db()
        self.assertEqual(self.old.status, 'superseded')

    def test_a_colleagues_correction_only_flags_the_original(self):
        correction = api.save(self.reader, org_id=self.org.id, share=True,
                              draft=api.Draft(problem='Build fails: missing libssl',
                                              resolution='Install libssl3 instead.'),
                              captured_by='user', supersedes_id=self.old.id)
        self.assertEqual(correction.status, 'active')
        self.old.refresh_from_db()
        self.assertEqual(self.old.status, 'needs_check')
        self.assertEqual(self.old.superseded_by_id, correction.id)


# ── Capture writes the draft card; the card is resolved by what the author does ──

class CaptureDraftCardTests(WorkflowBase):
    EXTRACTED = {
        'decision': 'new', 'existing_id': None,
        'problem': PROBLEM, 'symptoms': 'Tasks stay PENDING',
        'root_cause': 'Queue renamed', 'resolution': 'Start the worker with -Q new_queue.',
        'environment': {'celery': '5.3'},
        'claims': [{'text': 'The queue is called new_queue', 'kind': 'config'}],
        'phrasings': ['tasks stuck pending'], 'tags': ['celery'],
    }

    def setUp(self):
        super().setUp()
        cache.clear()
        self.session = ChatSession.objects.create(user=self.writer, title='t', org=self.org,
                                                  share_solutions=True)
        ChatMessage.objects.create(session=self.session, role='user', content=PROBLEM)
        self.answer = ChatMessage.objects.create(session=self.session, role='assistant',
                                                 content='Start the worker with -Q new_queue.')

    def capture(self, result=None, answer=None):
        answer = answer or self.answer

        async def extract(user_id, transcript, similar):
            return dict(result or self.EXTRACTED), 0, 'fake:model'

        with mock.patch.object(capture, '_extract', extract):
            return async_to_sync(capture.capture_answer)(answer.id, trigger='test')

    def card(self, answer=None):
        answer = answer or self.answer
        return ChatMessage.objects.get(id=answer.id).metadata.get('solution_draft')

    def test_a_suggest_org_captures_a_draft_and_writes_the_card(self):
        out = self.capture()
        self.assertEqual(out['outcome'], 'drafted')
        solution = Solution.objects.get(id=out['solution_id'])
        self.assertEqual((solution.status, solution.shared), ('draft', False))
        self.assertEqual(self.card(), {
            'id': solution.id, 'problem': PROBLEM, 'share_requested': True,
            'org_name': 'Acme', 'resolved': None,
        })
        self.assertTrue(Notification.objects.filter(
            user=self.writer, title='Solution drafted',
            data__action_url=f'/solutions?id={solution.id}&org={self.org.id}').exists())

    def test_an_auto_org_saves_as_before_and_writes_no_card(self):
        self.set_policy(capture_mode='auto')
        out = self.capture()
        self.assertEqual(out['outcome'], 'saved')
        self.assertEqual(Solution.objects.get(id=out['solution_id']).status, 'active')
        self.assertIsNone(self.card())

    def test_a_curated_org_queues_the_capture_for_a_curator(self):
        self.set_policy(capture_mode='auto', review_policy='curated')
        out = self.capture()
        self.assertEqual(out['outcome'], 'queued')
        self.assertEqual(Solution.objects.get(id=out['solution_id']).status, 'pending_review')
        self.assertTrue(Notification.objects.filter(
            user=self.curator, data__kind='solution_review_queue').exists())

    def test_the_card_is_resolved_when_the_author_publishes_it_privately(self):
        solution = Solution.objects.get(id=self.capture()['solution_id'])
        api.publish(self.writer, solution.id, self.org.id, share=False)
        self.assertEqual(self.card()['resolved'], 'kept_private')

    def test_the_card_is_resolved_as_shared_when_published_to_the_team(self):
        solution = Solution.objects.get(id=self.capture()['solution_id'])
        api.publish(self.writer, solution.id, self.org.id, share=True)
        self.assertEqual(self.card()['resolved'], 'shared')

    def test_the_card_is_resolved_as_waiting_in_a_curated_org(self):
        self.set_policy(review_policy='curated')
        solution = Solution.objects.get(id=self.capture()['solution_id'])
        api.publish(self.writer, solution.id, self.org.id, share=True)
        self.assertEqual(self.card()['resolved'], 'waiting_review')

    def test_the_card_is_resolved_as_discarded(self):
        solution = Solution.objects.get(id=self.capture()['solution_id'])
        api.discard(self.writer, solution.id, self.org.id)
        self.assertEqual(self.card()['resolved'], 'discarded')

    def test_a_curator_approval_and_send_back_are_reflected_on_the_card(self):
        """A draft goes to a curated team: waiting, then approved (shared), and
        a second one goes to the same queue and is sent back (returned)."""
        self.set_policy(review_policy='curated')
        first = Solution.objects.get(id=self.capture()['solution_id'])
        api.publish(self.writer, first.id, self.org.id, share=True)
        self.assertEqual(self.card()['resolved'], 'waiting_review')
        api.approve(self.curator, first.id, self.org.id)
        self.assertEqual(self.card()['resolved'], 'shared')

        second_answer = ChatMessage.objects.create(session=self.session, role='assistant',
                                                   content='Another fix.')
        out = self.capture(answer=second_answer,
                           result={**self.EXTRACTED, 'problem': 'Redis refused in staging'})
        second = Solution.objects.get(id=out['solution_id'])
        api.publish(self.writer, second.id, self.org.id, share=True)
        api.send_back(self.curator, second.id, self.org.id, 'Needs the staging host.')
        self.assertEqual(self.card(second_answer)['resolved'], 'returned')


class QueueNotificationTests(WorkflowBase):
    def test_a_curator_gets_one_queue_notification_however_many_wait(self):
        self.set_policy(review_policy='curated')
        for n in range(3):
            self.new(self.writer, captured_by='user', share=True,
                     problem=f'Problem number {n} with the export job')
        notes = Notification.objects.filter(user=self.curator,
                                            data__kind='solution_review_queue',
                                            data__org_id=self.org.id)
        self.assertEqual(notes.count(), 1)

    def test_a_read_queue_notification_does_not_stop_the_next_one(self):
        self.set_policy(review_policy='curated')
        self.new(self.writer, captured_by='user', share=True)
        Notification.objects.filter(user=self.curator).update(is_read=True)
        self.new(self.writer, captured_by='user', share=True,
                 problem='Another problem with the export job')
        self.assertEqual(Notification.objects.filter(
            user=self.curator, data__kind='solution_review_queue').count(), 2)

    def test_a_queue_notification_goes_to_curators_and_owners_only(self):
        self.set_policy(review_policy='curated')
        self.new(self.writer, captured_by='user', share=True)
        self.assertTrue(Notification.objects.filter(user=self.owner,
                                                    data__kind='solution_review_queue').exists())
        self.assertFalse(Notification.objects.filter(user=self.reader,
                                                     data__kind='solution_review_queue').exists())


# ── The API ────────────────────────────────────────────────────────────────

class WorkflowApiTests(WorkflowBase, APITestCase):
    def setUp(self):
        super().setUp()
        self.draft = self.new(self.writer)
        self.set_policy(review_policy='curated')
        self.waiting = self.new(self.writer, captured_by='user', share=True,
                                problem='Waiting problem about the export job')
        self.shared = self.new(self.reader, captured_by='user', share=False,
                               problem='Reader problem about the billing job')

    def get_list(self, user, query=''):
        self.client.force_authenticate(user)
        return self.client.get(f'/api/solutions/?org={self.org.id}{query}').json()

    def test_the_default_list_leaves_out_drafts_and_waiting_solutions(self):
        ids = [s['id'] for s in self.get_list(self.writer)['solutions']]
        self.assertNotIn(self.draft.id, ids)
        self.assertNotIn(self.waiting.id, ids)

    def test_a_draft_is_listed_by_status_only_to_its_author(self):
        mine = [s['id'] for s in self.get_list(self.writer, '&status=draft')['solutions']]
        self.assertEqual(mine, [self.draft.id])
        self.assertEqual(self.get_list(self.reader, '&status=draft')['solutions'], [])

    def test_the_queue_is_the_curators_and_the_authors_own_waiting_rows_for_others(self):
        queue = [s['id'] for s in self.get_list(self.curator, '&status=pending_review')['solutions']]
        self.assertEqual(queue, [self.waiting.id])
        self.assertEqual([s['id'] for s in self.get_list(self.writer, '&status=pending_review')
                          ['solutions']], [self.waiting.id])
        self.assertEqual(self.get_list(self.reader, '&status=pending_review')['solutions'], [])

    def test_publish_is_a_404_for_someone_else(self):
        self.client.force_authenticate(self.reader)
        resp = self.client.post(f'/api/solutions/{self.draft.id}/publish/',
                                {'org': self.org.id, 'share': True}, format='json')
        self.assertEqual(resp.status_code, 404)

    def test_publish_answers_with_the_solution_and_its_new_state(self):
        self.client.force_authenticate(self.writer)
        resp = self.client.post(f'/api/solutions/{self.draft.id}/publish/',
                                {'org': self.org.id, 'share': True}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['status'], 'pending_review')  # this org is curated

    def test_discard_answers_retracted(self):
        self.client.force_authenticate(self.writer)
        resp = self.client.post(f'/api/solutions/{self.draft.id}/discard/',
                                {'org': self.org.id}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['status'], 'retracted')

    def test_approve_is_403_for_the_author_and_200_for_a_curator(self):
        self.client.force_authenticate(self.writer)
        self.assertEqual(self.client.post(f'/api/solutions/{self.waiting.id}/approve/',
                                          {'org': self.org.id}, format='json').status_code, 403)
        self.client.force_authenticate(self.curator)
        resp = self.client.post(f'/api/solutions/{self.waiting.id}/approve/',
                                {'org': self.org.id}, format='json')
        self.assertEqual((resp.status_code, resp.json()['status']), (200, 'active'))

    def test_send_back_needs_a_reason_over_the_wire(self):
        self.client.force_authenticate(self.curator)
        resp = self.client.post(f'/api/solutions/{self.waiting.id}/send-back/',
                                {'org': self.org.id, 'reason': ''}, format='json')
        self.assertEqual(resp.status_code, 400)
        resp = self.client.post(f'/api/solutions/{self.waiting.id}/send-back/',
                                {'org': self.org.id, 'reason': 'Needs the staging host.'},
                                format='json')
        self.assertEqual((resp.status_code, resp.json()['status'], resp.json()['shared_with_org']),
                         (200, 'active', False))

    def test_a_waiting_row_is_a_404_on_detail_for_another_member(self):
        self.client.force_authenticate(self.reader)
        detail = self.client.get(f'/api/solutions/{self.waiting.id}/?org={self.org.id}')
        unknown = self.client.get(f'/api/solutions/999999/?org={self.org.id}')
        self.assertEqual(detail.status_code, 404)
        self.assertEqual(detail.json(), unknown.json())
        self.assertEqual(self.get_list(self.reader, '&status=pending_review')['solutions'], [])

    def test_a_curator_sees_the_waiting_row_on_detail(self):
        self.client.force_authenticate(self.curator)
        resp = self.client.get(f'/api/solutions/{self.waiting.id}/?org={self.org.id}')
        self.assertEqual((resp.status_code, resp.json()['status']), (200, 'pending_review'))

    def test_a_manager_may_set_capture_and_review_settings_and_a_curator_may_not(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.patch(f'/api/orgs/{self.org.id}/',
                                 {'capture_mode': 'auto', 'review_policy': 'open'}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual((resp.json()['capture_mode'], resp.json()['review_policy']),
                         ('auto', 'open'))
        self.client.force_authenticate(self.curator)
        resp = self.client.patch(f'/api/orgs/{self.org.id}/', {'capture_mode': 'suggest'},
                                 format='json')
        self.assertEqual(resp.status_code, 403)

    def test_an_unknown_setting_value_is_refused_and_nothing_is_written(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.patch(f'/api/orgs/{self.org.id}/',
                                 {'capture_mode': 'yolo', 'share_by_default': False}, format='json')
        self.assertEqual(resp.status_code, 400)
        org = Organization.objects.get(id=self.org.id)
        self.assertEqual(org.capture_mode, 'suggest')
        self.assertTrue(org.share_by_default)


class ChatSaveToolFollowsStartingStateTests(WorkflowBase):
    """The model is told where the fix went, not where it asked to put it."""

    def call(self, **ctx):
        import json

        from chat.tools.solutions import save_solution

        args = {'problem': 'Printer queue stuck after the driver update',
                'resolution': 'Clear the spool folder and restart the spooler.'}
        base = {'user_id': self.writer.id, 'org_id': self.org.id, 'share_solutions': True,
                'session_id': 'abc'}
        return json.loads(async_to_sync(save_solution)(args, {**base, **ctx}))

    def test_in_a_suggest_org_the_tool_saves_a_draft_and_says_so(self):
        out = self.call()
        self.assertTrue(out['saved'])
        self.assertEqual(out['status'], 'draft')
        self.assertEqual(out['visible_to'], 'only this user, as a draft')
        self.assertIn('drafted', out['tell_the_user'])
        self.assertEqual(Solution.objects.get(id=out['id']).status, 'draft')

    def test_in_a_curated_org_the_tool_says_the_fix_is_waiting(self):
        self.set_policy(capture_mode='auto', review_policy='curated')
        out = self.call()
        self.assertEqual(out['status'], 'pending_review')
        self.assertIn('review queue', out['tell_the_user'])
