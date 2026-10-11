"""
What the chat upload route refuses, and how many times it stores a file.

`POST /api/chat/sessions/<id>/upload/` had no test and no limit of its own: the
file library validated size, executables and zip bombs, and this route — which
reads the whole upload into memory — relied on the proxy's 55 MB body cap. It
also saved every file twice, once on the `ChatAttachment` and once on the
`Document` beside it, so a chat attachment cost double its size on disk.
"""
from __future__ import annotations

import os
import shutil
import tempfile
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from chat.models import ChatAttachment, ChatSession
from chat.sources import attachments
from inference import quota
from inference.models import Document
from workflow_backend import thresholds

User = get_user_model()


def stored_files(root: str) -> list[str]:
    return [os.path.join(folder, name)
            for folder, _dirs, names in os.walk(root) for name in names]


class ChatUploadTestCase(TestCase):
    def setUp(self):
        self._media = tempfile.mkdtemp()
        self._override = override_settings(MEDIA_ROOT=self._media)
        self._override.enable()
        self.user = User.objects.create_user('owner', 'owner@example.com', 'pw')
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.session = ChatSession.objects.create(user=self.user)
        self._index = patch('inference.indexing.index_document')
        self.queued = self._index.start()

    def tearDown(self):
        self._index.stop()
        self._override.disable()
        shutil.rmtree(self._media, ignore_errors=True)

    def upload(self, name='notes.txt', data=b'hello world', content_type='text/plain'):
        return self.client.post(f'/api/chat/sessions/{self.session.id}/upload/', {
            'file': SimpleUploadedFile(name, data, content_type=content_type),
        }, format='multipart')


class RefusalTests(ChatUploadTestCase):

    def test_a_file_over_the_size_limit_is_refused(self):
        with patch('inference.utils.MAX_DOCUMENT_SIZE', 10):
            response = self.upload(data=b'x' * 100)

        self.assertEqual(response.status_code, 400)
        self.assertIn('too large', response.data['error'])
        self.assertFalse(ChatAttachment.objects.exists())
        self.assertEqual(stored_files(self._media), [])

    def test_an_executable_is_refused(self):
        response = self.upload(name='setup.exe', data=b'MZ' + b'\x00' * 64,
                               content_type='application/octet-stream')

        self.assertEqual(response.status_code, 400)
        self.assertIn('Executable', response.data['error'])
        self.assertFalse(Document.objects.exists())

    def test_a_full_account_is_refused(self):
        with patch.dict(thresholds.STORAGE_QUOTA_MB, {'free': 1}), \
                patch.object(quota, 'usage', return_value={'used_bytes': 1_048_576}):
            response = self.upload()

        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.data['code'], 'STORAGE_FULL')
        self.assertFalse(ChatAttachment.objects.exists())

    def test_a_chat_holds_a_bounded_number_of_files(self):
        with patch('chat.views.MAX_ATTACHMENTS_PER_SESSION', 1):
            self.assertEqual(self.upload(name='one.txt').status_code, 200)
            response = self.upload(name='two.txt')

        self.assertEqual(response.status_code, 400)
        self.assertIn('new chat', response.data['error'])


class StoredOnceTests(ChatUploadTestCase):

    def test_an_upload_is_written_to_disk_once(self):
        response = self.upload(data=b'quarterly numbers')

        self.assertEqual(response.status_code, 200)
        attachment = ChatAttachment.objects.get()
        document = Document.objects.get()
        self.assertEqual(attachment.inference_document_id, document.id)
        self.assertEqual(attachment.file.name, document.file.name)
        self.assertEqual(len(stored_files(self._media)), 1,
                         'The attachment and its document must share one file.')
        with attachment.file.open('rb') as handle:
            self.assertEqual(handle.read(), b'quarterly numbers')

    def test_the_document_is_filed_under_chat_and_queued_for_indexing(self):
        self.upload()

        document = Document.objects.get()
        self.assertEqual(document.folder.name, thresholds.CHAT_HOME_ROOT)
        self.queued.assert_called_once_with(document.id)

    def test_the_documents_text_is_capped_like_the_attachments(self):
        with patch.object(thresholds, 'DOCUMENT_EXTRACT_CAP', 20), \
                patch('chat.views.DOCUMENT_EXTRACT_CAP', 20):
            self.upload(data=b'a' * 500)

        self.assertEqual(len(Document.objects.get().content_text), 20)
        self.assertEqual(len(ChatAttachment.objects.get().extracted_text), 20)

    def test_an_upload_counts_once_against_the_quota(self):
        self.upload(data=b'z' * 4000)

        self.assertEqual(quota.usage(self.user)['used_bytes'], 4000)

    def test_a_failed_document_store_still_keeps_the_file_on_the_attachment(self):
        with patch.object(attachments, 'store_document', side_effect=RuntimeError('db down')):
            response = self.upload(data=b'kept anyway')

        self.assertEqual(response.status_code, 200)
        attachment = ChatAttachment.objects.get()
        self.assertIsNone(attachment.inference_document_id)
        with attachment.file.open('rb') as handle:
            self.assertEqual(handle.read(), b'kept anyway')
        self.queued.assert_not_called()


class CleanupTests(ChatUploadTestCase):

    def test_deleting_the_chat_removes_the_file(self):
        self.upload()
        self.assertEqual(len(stored_files(self._media)), 1)

        response = self.client.delete(f'/api/chat/sessions/{self.session.id}/')

        self.assertIn(response.status_code, (200, 204))
        self.assertFalse(Document.objects.exists())
        self.assertEqual(stored_files(self._media), [],
                         'A deleted chat used to leave every attachment on disk.')

    def test_a_trashed_document_keeps_the_file_when_its_chat_is_deleted(self):
        from inference import recycle

        self.upload()
        recycle.trash(self.user, documents=[Document.objects.get()])

        attachments.purge_session(self.session)

        self.assertEqual(len(stored_files(self._media)), 1,
                         'The trashed file is still restorable, so its bytes stay.')
