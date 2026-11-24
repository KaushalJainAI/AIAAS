"""
A run that keeps calling tools ends at its iteration cap with an answer, never
with GraphRecursionError.

Found by the work-tier stress benchmark (2026-09-17): the recursion limit was
`max_iterations * 2 + 10`, written when the loop was agent -> tools; with
curate and steering added it is four node visits per iteration, so a long
month-end close died at about half its configured iterations and the
`at_limit` answer path never ran. Drives the real graph with the model
scripted at the wire (`llm.testing`).
"""
from __future__ import annotations

from asgiref.sync import async_to_sync
from django.contrib.auth.models import User
from django.test import TestCase

from chat.turn import agent as agent_module
from chat.turn.agent import TurnContext, run_turn
from llm.testing import DEFAULT_MODEL, DEFAULT_PROVIDER, always, scripted_model, text, tool_call


def relentless(*, obey_withholding: bool):
    """A model that always wants another tool call.

    `obey_withholding` controls whether it stops calling when the runtime
    offers no tools, as a real provider would. "Offered" is read off the
    request as sent: tools present, and `tool_choice` not "none" (the last
    pass keeps the list, for the prompt cache, and says none).
    """
    def respond(request):
        if request.tools_offered or not obey_withholding:
            return tool_call('update_todos', {'todos': [
                {'text': f'step {request.index}', 'status': 'in_progress'}]},
                id=f'call-{request.index}')
        return text('Stopped at the step limit; here is where I got to.')

    return always(respond)


async def _never(*_args, **_kwargs) -> bool:
    return False


async def _sink(*_args, **_kwargs) -> None:
    return None


class IterationLimitTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user('limit', 'limit@example.com', 'x')

    def run_with(self, model, iterations: int, thread: str):
        turn = TurnContext(
            provider=DEFAULT_PROVIDER, model=DEFAULT_MODEL, system_message='test',
            user_id=self.user.id, session_id=thread, intent='chat', user_text='go',
            memory_enabled=False, max_iterations=iterations,
            approval_policy=_never, sink=_sink,
        )
        with scripted_model(model) as scripted:
            result = async_to_sync(run_turn)(turn, prompt='go', thread_id=thread)
        return result, scripted

    def test_a_long_run_reaches_its_cap_and_answers(self):
        result, model = self.run_with(relentless(obey_withholding=True), iterations=20,
                                      thread='limit-long')
        self.assertEqual(result.error, '')
        self.assertIn('step limit', result.answer)
        # Every configured iteration was actually available, and the last one
        # was the one that withheld the tools.
        self.assertEqual(len(model.requests), 20)
        self.assertTrue(all(r.tools_offered for r in model.requests[:-1]))
        self.assertFalse(model.requests[-1].tools_offered)

    def test_a_model_that_ignores_withheld_tools_still_stops(self):
        result, _ = self.run_with(relentless(obey_withholding=False), iterations=6,
                                  thread='limit-rogue')
        self.assertEqual(result.error, '')

    def test_the_step_budget_matches_the_graph(self):
        graph = agent_module._build_graph()
        loop_nodes = {'agent', 'tools', 'curate', 'steering'}
        self.assertTrue(loop_nodes <= set(graph.nodes))
        # `await_reports` is visited per wait, not per iteration: it is budgeted
        # by `_AWAIT_STEPS`, so it is not one of the per-iteration nodes.
        self.assertEqual(
            agent_module.STEPS_PER_ITERATION,
            len(set(graph.nodes) - {'__start__', 'await_reports'}))
