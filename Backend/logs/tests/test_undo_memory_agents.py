"""
Undo for memory and agent settings (logs/undo.py, docs/UNDO_PLAN.md §6.4, Phase 7).

Each case drives the real chat tools (`remember_about_user`, `forget_about_user`,
`create_agent`, `update_agent`) through `chat.tools.execute_tool` under a run
binding, as `_dispatch_one` does per tool call, then reverts the run's set.
The helpers come from `UndoCase` (logs/tests/test_undo_documents.py).

The cases that matter most are the ones where the undo must *not* act: a fact
the user has edited since, and an agent edited by hand since (D2 — an undo
never overwrites work done after the run).
"""
from __future__ import annotations

import json

from asgiref.sync import async_to_sync

from agents.config import AgentSerializer
from agents.models import SubAgent
from chat.tools import execute_tool
from core import memory as user_memory
from core.models import UserMemory
from logs import undo
from logs.models import SubAgentRevision
from logs.tests.test_undo_documents import UndoCase


class _ToolCase(UndoCase):
    """Calls a chat tool the way the chat turn does, for this test's user."""

    def call(self, name, args):
        context = {'user_id': self.user.id}
        return json.loads(async_to_sync(execute_tool)(name, args, context))

    def facts(self, text):
        return UserMemory.objects.filter(user=self.user, text=text)

    def brief_of(self, agent_id):
        """The brief as the builder sees it: `prompt` is stored under `brief`."""
        agent = SubAgent.objects.get(pk=agent_id, user=self.user)
        return AgentSerializer.to_config(agent)['brief']

    def make_agent(self, brief='Sort the inbox each morning.'):
        """An agent made outside any run, so its own set is not under test."""
        out = self.call('create_agent', {'name': 'Inbox Triage', 'brief': brief})
        return out['agent_id']


class MemoryUndoTests(_ToolCase):
    def test_a_remembered_fact_is_forgotten_by_the_revert(self):
        log = self.new_run()
        with self.in_run(log, tool='remember_about_user'):
            self.call('remember_about_user', {'text': 'Works in IST', 'category': 'profile'})
        self.end(log)
        self.assertEqual(self.facts('Works in IST').count(), 1)

        result = self.revert(log)

        self.assertEqual(result['reverted'], 1)
        self.assertFalse(self.facts('Works in IST').exists())

    def test_a_fact_the_user_edited_since_is_left_alone(self):
        log = self.new_run()
        with self.in_run(log, tool='remember_about_user'):
            self.call('remember_about_user', {'text': 'Works in IST', 'category': 'profile'})
        self.end(log)
        self.facts('Works in IST').update(text='Works in IST, mostly remote')

        result = self.revert(log)

        [change] = self.rows(self.set_of(log))
        self.assertEqual(change.outcome, 'skipped')
        self.assertEqual(change.outcome_note, undo.NOTE_CHANGED_MEMORY)
        self.assertEqual(result['skipped'], 1)
        self.assertTrue(UserMemory.objects.filter(
            user=self.user, text='Works in IST, mostly remote').exists())

    def test_a_forgotten_fact_is_remembered_again_by_the_revert(self):
        user_memory.remember(self.user, 'Prefers short answers', 'preference')
        log = self.new_run()
        with self.in_run(log, tool='forget_about_user'):
            # Matched the way `forget` matches: case and end punctuation ignored.
            out = self.call('forget_about_user', {'text': 'prefers short answers.'})
        self.end(log)
        self.assertEqual(out['removed'], 1)
        self.assertFalse(self.facts('Prefers short answers').exists())

        result = self.revert(log)

        self.assertEqual(result['reverted'], 1)
        restored = self.facts('Prefers short answers').get()
        self.assertEqual(restored.category, 'preference')


class AgentSettingsUndoTests(_ToolCase):
    def test_an_update_is_reverted_and_the_timeline_shows_a_restore(self):
        agent_id = self.make_agent(brief='Old brief: sort the inbox.')
        log = self.new_run()
        with self.in_run(log, tool='update_agent'):
            self.call('update_agent', {'agent_id': agent_id, 'brief': 'New brief: do more.'})
        self.end(log)
        self.assertEqual(self.brief_of(agent_id), 'New brief: do more.')

        result = self.revert(log)

        self.assertEqual(result['reverted'], 1)
        self.assertEqual(self.brief_of(agent_id), 'Old brief: sort the inbox.')
        newest = SubAgentRevision.objects.filter(subagent_id=agent_id).order_by('-number').first()
        self.assertEqual(newest.source, 'restore')

    def test_an_agent_edited_by_hand_after_the_run_is_left_alone(self):
        agent_id = self.make_agent(brief='Old brief: sort the inbox.')
        log = self.new_run()
        with self.in_run(log, tool='update_agent'):
            self.call('update_agent', {'agent_id': agent_id, 'brief': 'Run brief.'})
        self.end(log)
        # A later edit, made outside the run (the builder screen, say).
        self.call('update_agent', {'agent_id': agent_id, 'brief': 'Hand-written brief.'})

        result = self.revert(log)

        [change] = self.rows(self.set_of(log))
        self.assertEqual(change.outcome, 'skipped')
        self.assertEqual(change.outcome_note, undo.NOTE_AGENT_EDITED)
        self.assertEqual(result['skipped'], 1)
        self.assertEqual(self.brief_of(agent_id), 'Hand-written brief.')

    def test_an_agent_created_by_the_run_is_listed_not_offered(self):
        # Listed as not revertible (with the note as its reason), never
        # deleted, and it does not keep the set "partly reverted" for ever.
        log = self.new_run()
        with self.in_run(log, tool='create_agent'):
            out = self.call('create_agent', {'name': 'Made in run', 'brief': 'Do a thing.'})
        self.end(log)

        result = self.revert(log)

        [change] = self.rows(self.set_of(log))
        self.assertFalse(change.revertible)
        self.assertEqual(change.reason, undo.NOTE_AGENT_CREATED)
        self.assertEqual(result['not_revertible'], 1)
        self.assertEqual(result['status'], 'reverted')
        self.assertTrue(SubAgent.objects.filter(pk=out['agent_id']).exists())
