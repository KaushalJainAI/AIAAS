"""
An uploaded image reaches the model as an `image_url` block.

Found by the live end-to-end run of 2026-11-25: a chat turn after an image
upload was answered "I don't see an image in this conversation". This drives
the real path a person takes: the upload's system marker in history, then
`run_chat_turn`, with the model scripted at the wire (`llm.testing`), and reads
what actually left for the provider.
"""
from __future__ import annotations

import base64
import shutil
import tempfile
from unittest.mock import AsyncMock, patch

from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.test import TestCase, override_settings

from chat.models import ChatAttachment, ChatMessage, ChatSession
from chat.turn.pipeline import TurnRequest, run_chat_turn
from llm.testing import always, scripted_model, text

User = get_user_model()

# A 1x1 PNG.
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)
MODEL = "anthropic/claude-haiku-5.5"


async def _quiet(event, payload) -> None:
    return None


def _parts(request) -> list[str]:
    """Every content-part type the request carried, across all messages."""
    kinds: list[str] = []
    for message in request.body.get("messages", []):
        content = message.get("content")
        if isinstance(content, list):
            kinds += [part.get("type") for part in content if isinstance(part, dict)]
    return kinds


@override_settings(OPENROUTER_API_KEY="k")
class UploadedImageReachesModelTests(TestCase):
    def setUp(self) -> None:
        self.media = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.media, ignore_errors=True)
        media = override_settings(MEDIA_ROOT=self.media)
        media.enable()
        self.addCleanup(media.disable)

        self.user = User.objects.create_user("img", "img@example.com", "pw")
        from core.models import UserProfile

        UserProfile.objects.update_or_create(user=self.user, defaults={
            "llm_provider": "openrouter", "llm_model": MODEL, "llm_effort": "medium"})
        from llm.models import AIModel, AIProvider

        provider, _ = AIProvider.objects.get_or_create(slug="openrouter", defaults={"name": "OpenRouter"})
        AIModel.objects.update_or_create(value=MODEL, defaults={
            "provider": provider, "name": "Claude Haiku 5.5", "is_active": True,
            "supports_image_input": True})
        self.session = ChatSession.objects.create(
            user=self.user, title="t", llm_provider="openrouter", llm_model=MODEL,
            llm_effort="medium")
        attachment = ChatAttachment(session=self.session, filename="pic.png",
                                    file_type="image", file_size=len(PNG))
        attachment.file.save("pic.png", ContentFile(PNG), save=True)
        # What the upload route leaves in history: a system marker naming the id.
        ChatMessage.objects.create(
            session=self.session, role="system", content="File uploaded: pic.png",
            metadata={"attachment_id": str(attachment.id), "file_type": "image",
                      "filename": "pic.png"},
        )
        # Hermetic: no vision witness, no follow-up call.
        for target, value in (
            ("chat.vision.witness_available", AsyncMock(return_value=False)),
            ("chat.turn.agent.suggest_follow_ups", AsyncMock(return_value=[])),
        ):
            patcher = patch(target, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_the_image_is_in_the_first_request(self):
        with scripted_model(always(lambda _r: text("A pixel.")), model=MODEL) as model:
            async_to_sync(run_chat_turn)(
                session=self.session, user=self.user,
                request=TurnRequest.parse({"content": "Describe this image."}), sink=_quiet)
        self.assertTrue(model.requests, "no request left for the provider")
        self.assertIn("image_url", _parts(model.requests[0]),
                      "the uploaded image never reached the model")
