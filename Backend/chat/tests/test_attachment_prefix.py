"""
Raw attachments ride the cached prefix, not the trailing nudge.

A raw file on a chat turn used to be attached to whatever message came last. On
the first pass that is the question; on every later pass it is the continuation
nudge after the whole transcript, so a long run paid for the file on every pass
and at a position no provider can cache. From the second pass on, the file now
rides on the question inside the transcript: the same position and the same
bytes on every pass, so it falls inside the cached prefix.

Drives the real graph with a stub model (as `test_curation_e2e.py` does) and
asserts what actually left for the provider.
"""
from __future__ import annotations

import base64
import json
import shutil
import tempfile
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from chat.turn.agent import TurnContext, run_turn

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
    """Calls a tool for `turns` passes, then answers. Records every request."""

    def __init__(self, turns: int, *, overflow_on: int | None = None) -> None:
        self.turns = turns
        self.overflow_on = overflow_on
        self.calls: list[dict] = []

    def __call__(self, **kwargs):
        self.calls.append(kwargs)
        step = len(self.calls)
        overflow = step == self.overflow_on
        answering = step > self.turns

        async def chunks():
            if overflow:
                yield {
                    "type": "error", "status": 400,
                    "message": "This model's maximum context length is 4096 tokens.",
                }
                return
            if answering:
                yield {"type": "content", "content": "done"}
            else:
                yield {"type": "tool_calls", "tool_calls": [{
                    "index": 0,
                    "id": f"call-{step}",
                    "function": {
                        "name": "read_file",
                        "arguments": json.dumps({"path": f"/step-{step}.md"}),
                    },
                }]}
            yield {"type": "metadata", "usage": {"total_tokens": 10}}

        return chunks()


async def _dispatch(name: str, args: dict, context: dict) -> str:
    return f"result for {args.get('path', '')}"


async def _never(name, args, context) -> bool:
    return False


def _list_entries(history: list[dict]) -> list[dict]:
    return [e for e in history if isinstance(e.get("content"), list)]


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
            tool_dispatch=_dispatch, approval_policy=_never,
        )
        with patch("llm.access.stream", new=stub):
            async_to_sync(run_turn)(
                turn, prompt=QUESTION, thread_id=f"thread-{uuid.uuid4()}",
            )
        return stub

    # ── the first pass is unchanged ─────────────────────────────────────────

    def test_first_pass_sends_the_file_on_the_question(self):
        stub = self._run("openrouter", turns=2)

        first = stub.calls[0]
        self.assertEqual(first["prompt"], QUESTION)
        self.assertEqual(len(first["attachments"]), 1)
        self.assertEqual(
            _list_entries(first["history"]), [],
            "the question is the prompt on pass 0, so the transcript has no file",
        )

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
            self.assertEqual(call["attachments"], [],
                             "raw files must not ride the trailing prompt")
            self.assertNotEqual(call["prompt"], QUESTION,
                                "a later pass prompts with the continuation nudge")
            self.assertEqual(call["history"][:2], list(prior),
                             "earlier turns are untouched")
            question = call["history"][2]
            self.assertEqual(question["role"], "user")
            self.assertEqual(
                question["content"],
                [{"type": "text", "text": QUESTION}, PDF_PART],
            )

    def test_the_question_entry_is_identical_on_every_later_pass(self):
        """The point of the change: the same bytes at the same place, so the
        provider's prefix cache can cover them from pass to pass."""
        stub = self._run("openrouter", turns=3)

        later = [call["history"] for call in stub.calls[1:]]
        self.assertGreaterEqual(len(later), 2)
        questions = [history[0] for history in later]
        for question in questions[1:]:
            self.assertEqual(question, questions[0])

    def test_the_overflow_retry_keeps_the_file_in_the_transcript(self):
        """A refused pass is retried with the transcript rebuilt. The rebuilt
        request must not fall back to sending the file on the prompt."""
        stub = self._run(
            "openrouter", model=OVERFLOW_MODEL, turns=3, overflow_on=2,
        )

        retry = stub.calls[2]
        self.assertEqual(retry["attachments"], [])
        self.assertEqual(
            _list_entries(retry["history"])[0]["content"],
            [{"type": "text", "text": QUESTION}, PDF_PART],
        )

    # ── providers that cannot take list history keep the old shape ──────────

    def test_a_provider_without_list_history_keeps_the_file_on_the_prompt(self):
        stub = self._run("ollama", turns=2)

        for call in stub.calls:
            self.assertEqual(len(call["attachments"]), 1)
        for call in stub.calls:
            self.assertEqual(_list_entries(call["history"]), [])
