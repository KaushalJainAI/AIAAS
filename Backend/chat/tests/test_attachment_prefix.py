"""
Raw attachments ride the cached prefix, not the trailing nudge.

A raw file on a chat turn used to be attached to whatever message came last. On
the first pass that is the question; on every later pass it is the continuation
nudge after the whole transcript, so a long run paid for the file on every pass
and at a position no provider can cache. From the second pass on, the file now
rides on the question inside the transcript: the same position and the same
bytes on every pass, so it falls inside the cached prefix.

Drives the real graph with the model scripted at the wire (as
`test_curation_e2e.py` does) and asserts on the requests that actually left.
"""
from __future__ import annotations

import base64
import shutil
import tempfile
import uuid
from pathlib import Path
from types import SimpleNamespace

from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from chat.turn.agent import TurnContext, run_turn
from llm.recorded import replay
from llm.testing import ScriptedModel, ScriptedRequest, always, provider_error, text, tool_call

User = get_user_model()

QUESTION = "what does the contract say about renewal?"
PDF_BYTES = b"%PDF-1.4 a small stand-in for a contract"
PDF_PART = {
    "type": "file",
    "file": {
        "filename": "contract.pdf",
        "file_data": "data:application/pdf;base64,"
                     + base64.b64encode(PDF_BYTES).decode("ascii"),
    },
}
#: A model id no other test uses: a provider refusal teaches the budget a window
#: for the process, and that must not leak into the other suites.
OVERFLOW_MODEL = "stub-prefix-overflow-model"


class _StubProvider:
    """Calls a tool for `turns` passes, then answers; refuses pass `overflow_on`
    with a context-length error. Records every request as it went over the wire.
    """

    def __init__(self, turns: int, *, overflow_on: int | None = None) -> None:
        self.turns = turns
        self.overflow_on = overflow_on
        self.scripted = ScriptedModel([always(self._respond)])

    def _respond(self, request: ScriptedRequest):
        if request.index == self.overflow_on:
            return provider_error(400, "This model's maximum context length is 4096 tokens.")
        if request.index > self.turns:
            return text("done")
        return tool_call("read_file", {"path": f"/step-{request.index}.md"},
                         id=f"call-{request.index}")

    @property
    def calls(self) -> list[list[dict]]:
        """The messages of each request."""
        return [r.messages for r in self.scripted.requests]


async def _read_file_only() -> list[dict]:
    """The one tool these runs call. With the whole chat catalogue the schemas
    alone outgrow the 4,096-token window the overflow test teaches, and the
    run rightly gives up instead of retrying."""
    from chat.tools import AVAILABLE_TOOLS

    return [t for t in AVAILABLE_TOOLS if t["function"]["name"] == "read_file"]


async def _dispatch(name: str, args: dict, context: dict) -> str:
    return f"result for {args.get('path', '')}"


async def _never(name, args, context) -> bool:
    return False


def _list_entries(messages: list[dict]) -> list[dict]:
    """The messages whose content is a list of parts: the ones that carry a file."""
    return [e for e in messages if isinstance(e.get("content"), list)]


def _conversation(messages: list[dict]) -> list[dict]:
    """The messages after the leading system prompt(s)."""
    start = 0
    while start < len(messages) and messages[start].get("role") == "system":
        start += 1
    return messages[start:]


QUESTION_WITH_FILE = [{"type": "text", "text": QUESTION}, PDF_PART]


class AttachmentPrefixTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user("prefix", "prefix@example.com", "x")

    def setUp(self):
        # `validate_attachment_path` only reads files under MEDIA_ROOT.
        media = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, media, ignore_errors=True)
        path = Path(media) / "contract.pdf"
        path.write_bytes(PDF_BYTES)
        self.attachment = SimpleNamespace(
            id="att-1", file_type="pdf", filename="contract.pdf",
            file_size=len(PDF_BYTES), extracted_text="",
            file=SimpleNamespace(path=str(path), name=str(path)),
        )
        override = override_settings(MEDIA_ROOT=media)
        override.enable()
        self.addCleanup(override.disable)

    def _run(self, provider, *, model="stub-model", turns=2, prior=(),
             overflow_on=None):
        stub = _StubProvider(turns, overflow_on=overflow_on)
        turn = TurnContext(
            provider=provider, model=model, system_message="You are a test.",
            user_id=self.user.id, session_id=f"prefix-{uuid.uuid4()}",
            intent="research", user_text=QUESTION,
            history=tuple(prior), attachments=(self.attachment,),
            memory_enabled=False, max_iterations=10,
            tool_dispatch=_dispatch, tool_source=_read_file_only, approval_policy=_never,
        )
        with stub.scripted.installed():
            async_to_sync(run_turn)(
                turn, prompt=QUESTION, thread_id=f"thread-{uuid.uuid4()}",
            )
        return stub

    # ── the first pass is unchanged ─────────────────────────────────────────

    def test_first_pass_sends_the_file_on_the_question(self):
        stub = self._run("openrouter", turns=2)

        first = stub.calls[0]
        self.assertEqual(first[-1]["role"], "user")
        self.assertEqual(first[-1]["content"], QUESTION_WITH_FILE)
        self.assertEqual(_list_entries(first[:-1]), [],
                         "the question is the last message on pass 0; nothing before it has the file")

    # ── later passes carry the file inside the transcript ───────────────────

    def test_later_passes_put_the_file_on_the_question_in_history(self):
        # Two prior turns, so the question's index is an offset, not zero.
        prior = (
            {"role": "user", "content": "an earlier question"},
            {"role": "assistant", "content": "an earlier answer"},
        )
        stub = self._run("openrouter", turns=3, prior=prior)

        self.assertGreaterEqual(len(stub.calls), 3, "the run should have gone on")
        for call in stub.calls[1:]:
            last = call[-1]
            self.assertIsInstance(last["content"], str,
                                  "raw files must not ride the trailing prompt")
            self.assertNotEqual(last["content"], QUESTION,
                                "a later pass prompts with the continuation nudge")
            conversation = _conversation(call)
            self.assertEqual(conversation[:2], list(prior), "earlier turns are untouched")
            question = conversation[2]
            self.assertEqual(question["role"], "user")
            self.assertEqual(question["content"], QUESTION_WITH_FILE)

    def test_the_question_entry_is_identical_on_every_later_pass(self):
        """The point of the change: the same bytes at the same place, so the
        provider's prefix cache can cover them from pass to pass."""
        stub = self._run("openrouter", turns=3)

        later = stub.calls[1:]
        self.assertGreaterEqual(len(later), 2)
        questions = [(call.index(_list_entries(call)[0]), _list_entries(call)[0])
                     for call in later]
        for question in questions[1:]:
            self.assertEqual(question, questions[0])

    def test_the_overflow_retry_keeps_the_file_in_the_transcript(self):
        """A refused pass is retried with the transcript rebuilt. The rebuilt
        request must not fall back to sending the file on the prompt."""
        stub = self._run(
            "openrouter", model=OVERFLOW_MODEL, turns=3, overflow_on=2,
        )

        retry = stub.calls[2]
        self.assertIsInstance(retry[-1]["content"], str)
        self.assertEqual(_list_entries(retry)[0]["content"], QUESTION_WITH_FILE)

    # ── providers that cannot take list history keep the old shape ──────────

    def test_a_provider_without_list_history_keeps_the_file_on_the_prompt(self):
        # Ollama, replayed from a recording: two passes (a tool call, then the
        # answer). Its /api/chat takes string content only, so no request may
        # carry a list of parts; a PDF is not something it takes at all.
        turn = TurnContext(
            provider="ollama", model="qwen3:8b", system_message="You are a test.",
            user_id=self.user.id, session_id=f"prefix-{uuid.uuid4()}",
            intent="research", user_text=QUESTION, attachments=(self.attachment,),
            memory_enabled=False, max_iterations=10,
            tool_dispatch=_dispatch, tool_source=_read_file_only, approval_policy=_never,
        )
        with replay("ollama_chat_tool_then_answer") as tape:
            async_to_sync(run_turn)(turn, prompt=QUESTION, thread_id=f"thread-{uuid.uuid4()}")
        self.assertEqual(len(tape.requests), 2)
        for request in tape.requests:
            self.assertEqual(_list_entries(request.json["messages"]), [])
        self.assertEqual(tape.requests[0].json["messages"][-1]["content"], QUESTION)
