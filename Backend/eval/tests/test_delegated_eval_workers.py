"""
A run an eval starts is part of the eval (2026-09-28).

Workers delegated from an eval run used to run as `caller='orchestrator'`:
they could pause on an approval nobody answers, needed `allow_unattended`,
and their cost counted against the owner's real spend cap. They now inherit
`eval` and the eval's gated-call policy. (In a world eval the delegation tools
are withheld entirely — `EvalEnvironment.withheld_names` — so this matters for
cases that run outside a world: imports and hand-added cases.)
"""
import inspect

from django.test import SimpleTestCase

from chat.tools import agents as agent_tools
from chat.tools import tasks as task_tools
from chat.tools.agents import worker_caller


class WorkerCallerTests(SimpleTestCase):
    def test_an_eval_parent_makes_an_eval_worker(self):
        self.assertEqual(worker_caller({'caller': 'eval', 'record_intents': 'block'}),
                         ('eval', 'block'))
        self.assertEqual(worker_caller({'caller': 'eval', 'record_intents': ''}),
                         ('eval', 'run'))

    def test_other_parents_are_unchanged(self):
        self.assertEqual(worker_caller({'caller': 'chat'}), ('orchestrator', 'run'))
        self.assertEqual(worker_caller({'caller': 'trigger'}), ('orchestrator', 'run'))
        self.assertEqual(worker_caller({}, default='chat'), ('chat', 'run'))

    def test_no_launch_site_hardcodes_orchestrator(self):
        # Every place a worker is started goes through `worker_caller`, so a
        # new launch site cannot quietly drop an eval back into a real run.
        for module in (agent_tools, task_tools):
            source = inspect.getsource(module)
            self.assertNotIn('caller="orchestrator"', source, module.__name__)
            self.assertNotIn("caller='orchestrator'", source, module.__name__)
            self.assertNotIn('caller="chat"', source, module.__name__)

    def test_the_tool_context_carries_the_policy(self):
        from chat.turn import agent as turn_agent

        self.assertIn('"record_intents": turn.record_intents',
                      inspect.getsource(turn_agent))
