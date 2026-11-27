"""
Checkpoints load only the classes we name (`chat/turn/checkpoints.py::checkpoint_types`).

LangGraph's loader rebuilds whatever class a checkpoint names, and warns that a
future version will refuse any it was not told about. Production logged one,
`llm.usage.TokenUsage` (2026-11-26). These tests pin the fix: the savers use an
explicit list, that list round-trips, and a real chat turn, loaded back from its
checkpoint, carries no class outside it.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from unittest.mock import AsyncMock, patch

from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase, override_settings
from langgraph.checkpoint.serde.event_hooks import register_serde_event_listener

from chat.models import ChatSession
from chat.turn import checkpoints
from chat.turn.pipeline import TurnRequest, run_chat_turn
from llm.testing import always, scripted_model, text
from llm.usage import TokenUsage

User = get_user_model()
MODEL = "anthropic/claude-haiku-5.5"


@dataclass
class NotListed:
    value: int = 1


def _events():
    seen: list[dict] = []
    stop = register_serde_event_listener(seen.append)
    return seen, stop


class SerializerTests(SimpleTestCase):
    def test_token_usage_round_trips_without_a_warning(self):
        seen, stop = _events()
        self.addCleanup(stop)
        serde = checkpoints.serializer()
        usage = TokenUsage(input=3, output=4, reported_cost_usd=Decimal("0.01"))
        self.assertEqual(serde.loads_typed(serde.dumps_typed({"usage": usage})), {"usage": usage})
        self.assertEqual([e for e in seen if e["kind"].startswith("msgpack_")], [])

    def test_a_class_not_listed_is_not_rebuilt(self):
        seen, stop = _events()
        self.addCleanup(stop)
        serde = checkpoints.serializer()
        back = serde.loads_typed(serde.dumps_typed({"x": NotListed(5)}))
        self.assertNotIsInstance(back["x"], NotListed)
        self.assertIn("msgpack_blocked", [e["kind"] for e in seen])

    def test_every_backend_gets_the_strict_serializer(self):
        saver = checkpoints._memory()
        self.assertIsNot(saver.serde._allowed_msgpack_modules, True)
        self.assertIn((TokenUsage.__module__, "TokenUsage"), saver.serde._allowed_msgpack_modules)


async def _quiet(event, payload) -> None:
    return None


@override_settings(OPENROUTER_API_KEY="k", AGENT_CHECKPOINTER="memory")
class RealTurnTests(TestCase):
    """Two turns on one thread: the second loads the first's checkpoint."""

    def setUp(self) -> None:
        self.user = User.objects.create_user("ck", "ck@example.com", "pw")
        self.session = ChatSession.objects.create(
            user=self.user, title="t", llm_provider="openrouter", llm_model=MODEL,
            llm_effort="medium")
        patcher = patch("chat.turn.agent.suggest_follow_ups", AsyncMock(return_value=[]))
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_state_holds_only_listed_classes(self):
        seen, stop = _events()
        self.addCleanup(stop)
        for prompt in ("Say hi.", "Say hi again."):
            with scripted_model(always(lambda _r: text("hi")), model=MODEL):
                async_to_sync(run_chat_turn)(
                    session=self.session, user=self.user,
                    request=TurnRequest.parse({"content": prompt}), sink=_quiet)
        bad = [e for e in seen if e["kind"] in ("msgpack_blocked", "msgpack_unregistered_allowed")]
        self.assertEqual(bad, [], "add these classes to checkpoints.checkpoint_types()")
