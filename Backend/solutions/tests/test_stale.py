"""
The weekly nudge (K4.2): who is told, how often, and what a removed member gets.
"""
from __future__ import annotations

from datetime import timedelta
from io import StringIO

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from core.models import Membership
from notifications.models import Notification
from solutions import stale
from solutions.models import Solution

from .helpers import SolutionsTestMixin

OLD = timedelta(days=400)  # past the 365-day window of a `procedure` claim


def digests(user):
    return Notification.objects.filter(user=user, data__kind='solution_stale_digest')


class StaleSweepTests(SolutionsTestMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.alice = self.make_user('alice')   # curator (owner)
        self.bob = self.make_user('bob')       # member, author of a stale fix
        self.carol = self.make_user('carol')   # member, author of a stale fix, then removed
        self.org = self.make_org(self.alice, 'Acme', self.bob, self.carol)
        self.bob_fix = self.shared_fix(self.bob, 'Restart the worker after deploy.',
                                       problem='Worker ignores tasks after deploy')
        self.carol_fix = self.shared_fix(self.carol, 'Flush the cache after the migration.',
                                         problem='Stale cache after migration')

    def shared_fix(self, user, resolution, *, problem):
        solution = self.save(user, self.org.id, share=True,
                             problem=problem, resolution=resolution)
        Solution.objects.filter(id=solution.id).update(valid_as_of=timezone.now() - OLD)
        return solution

    def test_a_stale_author_is_told_once_and_the_curator_gets_the_summary(self):
        out = stale.run_stale_sweep()
        self.assertEqual(out['orgs'], 1)
        bob_note = digests(self.bob).get()
        self.assertEqual(bob_note.data['count'], 1)        # only bob's own row
        self.assertEqual(bob_note.data['scope'], f'org:{self.org.id}')
        self.assertIn('1 of your team solutions may be out of date', bob_note.message)
        alice_note = digests(self.alice).get()
        self.assertEqual(alice_note.data['count'], 2)      # every stale shared row
        self.assertEqual(alice_note.data['action_url'],
                         f'/solutions?tab=library&attention=1&org={self.org.id}')

    def test_a_second_run_within_six_days_sends_nothing(self):
        stale.run_stale_sweep()
        before = Notification.objects.count()
        out = stale.run_stale_sweep()
        self.assertEqual(out['notified'], 0)
        self.assertEqual(Notification.objects.count(), before)

    def test_after_six_days_a_new_digest_goes_out(self):
        stale.run_stale_sweep()
        Notification.objects.filter(user=self.bob).update(
            created_at=timezone.now() - timedelta(days=7))
        out = stale.run_stale_sweep()
        self.assertEqual(out['notified'], 1)
        self.assertEqual(digests(self.bob).count(), 2)

    def test_a_fresh_row_sends_nothing(self):
        Solution.objects.filter(id__in=[self.bob_fix.id, self.carol_fix.id]).update(
            valid_as_of=timezone.now())
        out = stale.run_stale_sweep()
        self.assertEqual(out['flagged'], 0)
        self.assertFalse(digests(self.bob).exists())
        self.assertFalse(digests(self.alice).exists())

    def test_a_row_marked_needs_check_is_flagged_even_when_fresh(self):
        Solution.objects.filter(id=self.bob_fix.id).update(
            valid_as_of=timezone.now(), status='needs_check')
        Solution.objects.filter(id=self.carol_fix.id).update(valid_as_of=timezone.now())
        stale.run_stale_sweep()
        self.assertEqual(digests(self.bob).get().data['count'], 1)

    def test_a_removed_member_gets_nothing_about_the_org(self):
        Membership.objects.filter(org=self.org, user=self.carol).delete()
        stale.run_stale_sweep()
        self.assertFalse(digests(self.carol).exists())
        # Her fix is still the org's, so the curator still sees it.
        self.assertEqual(digests(self.alice).get().data['count'], 2)

    def test_personal_solutions_go_to_their_author_once(self):
        mine = self.save(self.bob, None, share=False, problem='Slow package install',
                         resolution='Use the local mirror.')
        Solution.objects.filter(id=mine.id).update(valid_as_of=timezone.now() - OLD)
        self.assertIsNone(mine.org_id)
        stale.run_stale_sweep()
        note = digests(self.bob).get(data__scope='personal')
        self.assertIn('1 of your solutions may be out of date', note.message)

    def test_the_management_command_runs_the_same_sweep(self):
        out = StringIO()
        call_command('solutions_stale_sweep', stdout=out)
        self.assertIn('digest(s) sent', out.getvalue())
        self.assertTrue(digests(self.alice).exists())

    def test_the_celery_task_has_the_beat_name(self):
        from solutions.tasks import sweep_stale

        self.assertEqual(sweep_stale.name, 'solutions.sweep_stale')
