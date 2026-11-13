"""
The `decide` tool is reachable where it should be: the chat orchestrator (it
is a read tool) and any agent holding the `decisions` grant, and every table
that lists grants for the builder, the capabilities endpoint and the tool
library names it. The door itself is tested in `llm/tests/test_decisions.py`.
"""
from __future__ import annotations

from django.test import SimpleTestCase


class WiringTests(SimpleTestCase):
    def test_agents_reach_it_through_the_decisions_grant(self):
        from agents.config import TOOL_KEYS
        from agents.grants import GRANT_TOOLS

        self.assertEqual(GRANT_TOOLS['decisions'], ('decide',))
        self.assertIn('decisions', TOOL_KEYS)

    def test_the_chat_orchestrator_may_call_it(self):
        from chat.tools import PARALLEL_TOOLS, chat_orchestrator_allowed, effect_of

        self.assertEqual(effect_of('decide'), 'read')
        self.assertTrue(chat_orchestrator_allowed('decide'))
        self.assertIn('decide', PARALLEL_TOOLS)

    def test_the_tool_library_and_capabilities_name_the_grant(self):
        from agents.views.builder import TOOL_HELP
        from agents.views.capabilities import GRANT_RISKS, GRANT_SCOPES
        from tools_config.views import GRANT_CATEGORIES, GRANT_META, LIBRARY_GROUPS

        self.assertIn('decisions', TOOL_HELP)
        self.assertIsNone(GRANT_SCOPES['decisions'])
        self.assertIn('decisions', GRANT_RISKS)
        self.assertIn('decisions', GRANT_CATEGORIES)
        self.assertIn('decisions', GRANT_META)
        self.assertEqual(LIBRARY_GROUPS['decisions'], ('decide',))
