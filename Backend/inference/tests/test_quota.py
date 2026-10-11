"""
The storage quota and the limits that came with it (`inference/quota.py`,
`inference/indexing.py`).

Before these, every cap in the system bounded one request and none bounded the
loop: an account could upload 50 MB a thousand times an hour, an agent could
write files until the volume was full, and a multi-file upload started one
indexing thread per file.

What is pinned here is the part a refactor would break quietly: that usage
counts each stored blob once, that trash still counts, that every door a
person or a model pushes bytes through refuses the same way, and that
deleting a row frees the bytes it was charged for.
"""
from __future__ import annotations

import os
import shutil
import tempfile
import threading
import time
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from chat.models import ChatAttachment, ChatSession
from inference import indexing, office_edit, quota, recycle, versions, vfs
from inference.models import Document, PublishedPage
from inference.pages import PublishError, publish
from workflow_backend import thresholds

User = get_user_model()

MB = 1_048_576


def tiny_quota(mb: int = 1):
    """A free tier of `mb` megabytes for the length of a test."""
    return patch.dict(thresholds.STORAGE_QUOTA_MB, {'free': mb})


class QuotaTestCase(TestCase):
    def setUp(self):
        self._media = tempfile.mkdtemp()
        self._override = override_settings(MEDIA_ROOT=self._media)
        self._override.enable()
        self.user = User.objects.create_user('owner', 'owner@example.com', 'pw')
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        # No test here is about indexing; a real job would embed in a thread.
        self._index = patch('inference.indexing.index_document')
        self.queued = self._index.start()

    def tearDown(self):
        self._index.stop()
        self._override.disable()
        shutil.rmtree(self._media, ignore_errors=True)

    def doc(self, name='a.bin', size=1000, **kw) -> Document:
        doc = Document(user=self.user, name=name, file_type='other',
                       file_size=size, status='stored', **kw)
        doc.file.save(name, ContentFile(b'x' * size), save=False)
        doc.save()
        return doc

    def upload(self, name='notes.txt', size=100):
        return self.client.post('/api/inference/documents/', {
            'file': SimpleUploadedFile(name, b'a' * size, content_type='text/plain'),
        }, format='multipart')


class UsageTests(QuotaTestCase):

    def test_an_empty_account_uses_nothing(self):
        used = quota.usage(self.user)

        self.assertEqual(used['used_bytes'], 0)
        self.assertEqual(used['file_count'], 0)
        self.assertEqual(used['limit_bytes'], thresholds.STORAGE_QUOTA_MB['free'] * MB)

    def test_trashed_files_still_count(self):
        doc = self.doc(size=4000)
        recycle.trash(self.user, documents=[doc])

        used = quota.usage(self.user)

        self.assertEqual(used['breakdown']['documents'], 0)
        self.assertEqual(used['breakdown']['trash'], 4000)
        self.assertEqual(used['used_bytes'], 4000,
                         'A trashed file is still on disk until the sweep purges it.')

    def test_kept_versions_count(self):
        doc = self.doc(name='report.bin', size=3000)
        versions.snapshot(doc, 'app', force=True)

        self.assertEqual(quota.usage(self.user)['breakdown']['versions'], 3000)

    def test_an_attachment_sharing_its_documents_file_is_counted_once(self):
        doc = self.doc(name='photo.bin', size=5000)
        session = ChatSession.objects.create(user=self.user)
        ChatAttachment.objects.create(
            session=session, file=doc.file.name, filename=doc.name,
            file_size=5000, inference_document=doc)

        used = quota.usage(self.user)

        self.assertEqual(used['breakdown']['chat_attachments'], 0)
        self.assertEqual(used['used_bytes'], 5000)

    def test_an_attachment_with_its_own_copy_is_counted(self):
        # The shape every upload had before the double store was removed.
        doc = self.doc(name='old.bin', size=5000)
        session = ChatSession.objects.create(user=self.user)
        attachment = ChatAttachment(session=session, filename='old.bin',
                                    file_size=5000, inference_document=doc)
        attachment.file.save('old.bin', ContentFile(b'y' * 5000), save=True)

        self.assertEqual(quota.usage(self.user)['used_bytes'], 10000)

    def test_another_accounts_files_are_not_mine(self):
        other = User.objects.create_user('other', 'other@example.com', 'pw')
        Document.objects.create(user=other, name='theirs.txt', file_type='txt',
                                file_size=9000, status='stored')

        self.assertEqual(quota.usage(self.user)['used_bytes'], 0)

    def test_the_tier_decides_the_limit(self):
        from core.models import UserProfile

        self.assertEqual(quota.limit_for(self.user), thresholds.STORAGE_QUOTA_MB['free'] * MB,
                         'An account with no profile row is on the free tier.')
        UserProfile.objects.update_or_create(user=self.user, defaults={'tier': 'pro'})
        self.user = User.objects.get(pk=self.user.pk)

        self.assertEqual(quota.limit_for(self.user), thresholds.STORAGE_QUOTA_MB['pro'] * MB)


class CheckTests(QuotaTestCase):

    def test_a_write_that_fits_is_allowed(self):
        with tiny_quota(1):
            quota.check(self.user, 1000)

    def test_a_write_that_does_not_fit_is_refused(self):
        self.doc(size=MB - 100)
        with tiny_quota(1):
            with self.assertRaises(quota.QuotaExceeded) as refused:
                quota.check(self.user, 1000)

        self.assertIn('empty the trash', str(refused.exception))

    def test_a_zero_quota_switches_the_byte_limit_off(self):
        self.doc(size=5 * MB)
        with tiny_quota(0):
            quota.check(self.user, 50 * MB)

    def test_the_file_count_has_its_own_limit(self):
        self.doc()
        self.doc(name='b.bin')
        with patch.object(thresholds, 'MAX_DOCUMENTS_PER_USER', 2):
            with self.assertRaises(quota.QuotaExceeded):
                quota.check(self.user, 1)
            # An overwrite adds bytes, not a row.
            quota.check(self.user, 1, new_file=False)


class DoorTests(QuotaTestCase):
    """Every way bytes get in answers a full account the same way."""

    def test_a_library_upload_over_quota_is_refused_before_anything_is_stored(self):
        self.doc(size=MB - 100)
        with tiny_quota(1):
            response = self.upload(size=5000)

        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.data['code'], 'STORAGE_FULL')
        self.assertEqual(Document.objects.filter(name='notes.txt').count(), 0)
        self.queued.assert_not_called()

    def test_a_library_upload_that_fits_is_stored_and_queued_for_indexing(self):
        response = self.upload()

        self.assertEqual(response.status_code, 201)
        self.queued.assert_called_once()

    def test_an_upload_past_the_file_count_is_refused(self):
        self.doc()
        with patch.object(thresholds, 'MAX_DOCUMENTS_PER_USER', 1):
            response = self.upload()

        self.assertEqual(response.status_code, 413)

    def test_an_agent_text_write_over_quota_is_told_to_stop(self):
        self.doc(size=MB - 100)
        scope = vfs.build_scope(self.user, 'full')
        with tiny_quota(1):
            with self.assertRaises(vfs.VfsError) as refused:
                vfs.write_file(scope, '/reports/deep/q1.md', 'x' * 5000)

        self.assertIn('Do not retry', str(refused.exception))
        self.assertFalse(
            Document.objects.filter(name='q1.md').exists())
        from inference.models import Folder
        self.assertFalse(Folder.objects.filter(user=self.user, name='reports').exists(),
                         'A refused write must not leave its folders behind.')

    def test_an_agent_binary_write_over_quota_is_refused(self):
        self.doc(size=MB - 100)
        scope = vfs.build_scope(self.user, 'full')
        with tiny_quota(1):
            with self.assertRaises(vfs.VfsError):
                vfs.write_binary(scope, '/chart.png', b'\x89PNG' + b'0' * 5000)

    def test_an_agent_may_still_overwrite_at_the_file_count_limit(self):
        scope = vfs.build_scope(self.user, 'full')
        vfs.write_file(scope, '/notes.md', 'first')
        with patch.object(thresholds, 'MAX_DOCUMENTS_PER_USER', 1):
            vfs.write_file(scope, '/notes.md', 'second')
            with self.assertRaises(vfs.VfsError):
                vfs.write_file(scope, '/other.md', 'new file')

        self.assertEqual(Document.objects.get(name='notes.md').content_text, 'second')

    def test_a_new_file_in_an_app_over_quota_is_refused(self):
        self.doc(size=MB - 100)
        with tiny_quota(1):
            response = self.client.post('/api/inference/documents/new/', {
                'name': 'big.txt', 'content': 'x' * 5000}, format='json')

        self.assertEqual(response.status_code, 413)

    def test_a_copy_over_quota_is_refused(self):
        doc = self.doc(size=MB - 100)
        with tiny_quota(1):
            with self.assertRaises(office_edit.EditError) as refused:
                office_edit.copy(doc, None)

        self.assertEqual(refused.exception.status, 413)

    def test_an_embedded_image_is_refused_by_size_before_it_is_read(self):
        doc = self.doc(name='memo.docx')
        with patch.object(thresholds, 'AGENT_FILE_BINARY_BYTES', 10):
            response = self.client.post(f'/api/inference/documents/{doc.pk}/images/', {
                'file': SimpleUploadedFile('pic.png', b'\x89PNG' + b'0' * 100,
                                           content_type='image/png'),
            }, format='multipart')

        self.assertEqual(response.status_code, 413)

    def test_the_storage_endpoint_reports_what_is_held(self):
        self.doc(size=2000)

        response = self.client.get('/api/inference/storage/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['used_bytes'], 2000)
        self.assertEqual(response.data['file_count'], 1)
        self.assertIn('trash', response.data['breakdown'])

    def test_the_storage_endpoint_needs_an_account(self):
        self.assertEqual(APIClient().get('/api/inference/storage/').status_code, 401)


class FreedBytesTests(QuotaTestCase):
    """A deleted row gives back the disk it was charged for."""

    def test_deleting_a_document_removes_its_file(self):
        doc = self.doc()
        path = doc.file.path
        self.assertTrue(os.path.exists(path))

        doc.delete()

        self.assertFalse(os.path.exists(path),
                         'Only the recycle sweep used to remove a file; every '
                         'other delete left the bytes on disk for ever.')

    def test_trashing_a_document_keeps_its_file(self):
        doc = self.doc()
        path = doc.file.path

        recycle.trash(self.user, documents=[doc])

        self.assertTrue(os.path.exists(path), 'Trash is restorable.')

    def test_a_file_another_row_still_names_is_kept(self):
        first = self.doc()
        second = Document.objects.create(
            user=self.user, name='twin.bin', file=first.file.name,
            file_type='other', file_size=1000, status='stored')
        path = first.file.path

        first.delete()

        self.assertTrue(os.path.exists(path))
        second.delete()
        self.assertFalse(os.path.exists(path))

    def test_replacing_a_files_bytes_moves_the_attachment_that_shares_them(self):
        doc = self.doc(name='sheet.bin')
        session = ChatSession.objects.create(user=self.user)
        attachment = ChatAttachment.objects.create(
            session=session, file=doc.file.name, filename=doc.name,
            file_size=doc.file_size, inference_document=doc)

        doc = office_edit.replace_bytes(doc, b'new bytes', version_source=None)

        attachment.refresh_from_db()
        self.assertEqual(attachment.file.name, doc.file.name,
                         'The attachment must not be left naming deleted bytes.')
        self.assertTrue(os.path.exists(attachment.file.path))


class PublishedPageLimitTests(QuotaTestCase):

    def _file_page(self, doc):
        import json
        return publish(self.user, title='Shared file', kind='file',
                       body=json.dumps({'document_id': doc.pk}), visibility='link')

    def test_a_file_page_records_the_size_of_its_snapshot(self):
        page = self._file_page(self.doc(size=1234))

        self.assertEqual(page.file_size, 1234)
        self.assertEqual(quota.usage(self.user)['breakdown']['published_pages'], 1234)

    def test_a_snapshot_needs_room(self):
        doc = self.doc(size=MB - 100)
        with tiny_quota(1):
            with self.assertRaises(PublishError):
                self._file_page(doc)

    def test_withdrawing_a_file_page_frees_its_snapshot(self):
        page = self._file_page(self.doc(size=1234))
        path = page.file.path

        response = self.client.delete(f'/api/inference/pages/{page.slug}/')

        self.assertEqual(response.status_code, 204)
        self.assertFalse(os.path.exists(path))
        self.assertEqual(quota.usage(self.user)['breakdown']['published_pages'], 0)
        self.assertTrue(PublishedPage.objects.filter(pk=page.pk).exists(),
                        'Withdrawn, not deleted: the row and its slug stay.')

    def test_live_pages_are_capped_and_withdrawn_ones_do_not_count(self):
        with patch.object(thresholds, 'MAX_PUBLISHED_PAGES_PER_USER', 1):
            first = publish(self.user, title='One', kind='report', body='# a', visibility='link')
            with self.assertRaises(PublishError):
                publish(self.user, title='Two', kind='report', body='# b', visibility='link')

            self.client.delete(f'/api/inference/pages/{first.slug}/')
            publish(self.user, title='Two', kind='report', body='# b', visibility='link')


class IndexingQueueTests(TestCase):
    """However many files arrive, a fixed number are processed at once."""

    def test_jobs_never_run_more_than_the_configured_number_at_a_time(self):
        running, peak, lock = [0], [0], threading.Lock()

        def job():
            with lock:
                running[0] += 1
                peak[0] = max(peak[0], running[0])
            time.sleep(0.03)
            with lock:
                running[0] -= 1

        for _ in range(12):
            indexing.submit(job)

        self.assertTrue(indexing.wait(10), 'The queue did not drain.')
        self.assertLessEqual(peak[0], thresholds.INDEXING_CONCURRENCY)
        self.assertGreaterEqual(peak[0], 1)

    def test_a_job_that_raises_does_not_stop_the_queue(self):
        done = []

        def bad():
            raise RuntimeError('this document cannot be read')

        indexing.submit(bad)
        indexing.submit(lambda: done.append(True))

        self.assertTrue(indexing.wait(10))
        self.assertEqual(done, [True])
