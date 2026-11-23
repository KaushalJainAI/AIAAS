"""
`chat/turn/history.py`: how much of a conversation is replayed, and what an
earlier upload looks like to the model.

Pinned: the replayed window moves in steps of `HISTORY_WINDOW_STEP`, so the
prefix stays identical across consecutive turns (prompt caching); an upload
marker reaches the model only as a pointer built from its metadata; a deleted
file's pointer says so, and that flag never touches the database; documents
reach the model only when uploaded after the last reply, images from the last
few messages.
"""
from __future__ import annotations

from datetime import timedelta
from unittest import mock

from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from chat.models import ChatAttachment, ChatMessage, ChatSession
from chat.turn import history, session_notes
from llm.access import estimate_tokens


def _marker(**meta):
    """An upload marker as `chat/views.py` writes it, UI card and all."""
    content = "📎 File uploaded: **report.pdf** (pdf, 123 bytes)\nWorking file: `/Chat/report.pdf`"
    return ChatMessage(role="system", content=content, metadata=meta)


class HistoryWindowTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='w', email='w@e.com', password='pw')
        self.session = ChatSession.objects.create(user=self.user, title='Window')

    def _conversation(self, n):
        """n alternating turns, m0 oldest. created_at is set explicitly, since
        auto_now_add would make the order depend on the clock's resolution."""
        base = timezone.now() - timedelta(hours=1)
        for i in range(n):
            role = 'user' if i % 2 == 0 else 'assistant'
            message = ChatMessage.objects.create(session=self.session, role=role, content=f'm{i}')
            ChatMessage.objects.filter(pk=message.pk).update(
                created_at=base + timedelta(seconds=i))

    def _replayed(self):
        return history.load_history_sync(self.session, exclude_id=None)

    # ── window snapping ──

    def test_the_first_replayed_message_only_moves_in_steps(self):
        # total -> (number replayed, oldest replayed). Totals up to the window
        # replay everything; after it the oldest moves only every 10 messages.
        expected = {20: 20, 21: 21, 29: 29, 30: 20, 31: 21}
        first_of = {20: 'm0', 21: 'm0', 29: 'm0', 30: 'm10', 31: 'm10'}
        for total, replayed in expected.items():
            with self.subTest(total=total):
                ChatMessage.objects.filter(session=self.session).delete()
                self._conversation(total)
                past = self._replayed()
                self.assertEqual(len(past), replayed)
                self.assertEqual(past[0].content, first_of[total])

    def test_the_prefix_is_identical_for_ten_turns_then_moves(self):
        starts = []
        for total in range(30, 41):
            with self.subTest(total=total):
                ChatMessage.objects.filter(session=self.session).delete()
                self._conversation(total)
                starts.append(self._replayed()[0].content)
        self.assertEqual(starts[:10], ['m10'] * 10)   # totals 30-39
        self.assertEqual(starts[10], 'm20')           # total 40

    def test_under_the_window_everything_is_replayed(self):
        self._conversation(7)
        self.assertEqual([m.content for m in self._replayed()],
                         [f'm{i}' for i in range(7)])

    def test_notes_tail_snaps_the_same_way(self):
        # With notes, history is the focus plus a tail. Here the focus is empty
        # (everything is filed), so the tail alone decides what is replayed.
        self._conversation(16)
        through = ChatMessage.objects.filter(session=self.session).order_by('-id').first().id
        with mock.patch.object(session_notes, 'focus', return_value=([], through)):
            # total 16 - RECENT_TAIL_MESSAGES 6 = 10: the tail is 6 + 10 % 10 = 6
            # newest, so the oldest replayed is m10 (the window has not moved yet).
            self.assertEqual([m.content for m in self._replayed()],
                             ['m10', 'm11', 'm12', 'm13', 'm14', 'm15'])

    def test_notes_tail_under_its_size_is_all_of_it(self):
        self._conversation(5)
        through = ChatMessage.objects.filter(session=self.session).order_by('-id').first().id
        with mock.patch.object(session_notes, 'focus', return_value=([], through)):
            self.assertEqual(len(self._replayed()), 5)


class UploadPointerTests(TestCase):
    """What an earlier upload looks like once it is in the replayed history."""

    def test_pointer_is_built_from_metadata_not_the_ui_card(self):
        marker = _marker(attachment_id='9f1c', filename='report.pdf',
                         file_type='pdf', vfs_path='/Chat/report.pdf')
        wire = history.to_wire_history([marker])
        self.assertEqual(wire, [{
            'role': 'system',
            'content': ('[File uploaded earlier: report.pdf (pdf), attachment id 9f1c. '
                        'Working file `/Chat/report.pdf`. Read it with read_attachment_text '
                        'or read_file when needed.]'),
        }])
        self.assertNotIn('UI card', wire[0]['content'])
        self.assertNotIn('uploaded**', wire[0]['content'])

    def test_a_deleted_file_says_so(self):
        marker = _marker(attachment_id='9f1c', filename='report.pdf', file_type='pdf',
                         vfs_path='/Chat/report.pdf', attachment_deleted=True)
        wire = history.to_wire_history([marker])
        self.assertEqual(wire[0]['content'],
                         '[File uploaded earlier: report.pdf (pdf), attachment id 9f1c. '
                         'It has been deleted and is no longer available.]')

    def test_missing_keys_fall_back_without_breaking(self):
        wire = history.to_wire_history([_marker(attachment_id='9f1c')])
        self.assertEqual(
            wire[0]['content'],
            '[File uploaded earlier: a file, attachment id 9f1c. '
            'Read it with read_attachment_text or read_file when needed.]')

    def test_a_missing_type_drops_the_brackets_not_the_name(self):
        wire = history.to_wire_history([_marker(attachment_id='9f1c', filename='notes.txt')])
        self.assertIn('[File uploaded earlier: notes.txt, attachment id 9f1c.', wire[0]['content'])

    def test_other_system_rows_are_still_skipped(self):
        notice = ChatMessage(role='system', content='Memory is off.', metadata={})
        wire = history.to_wire_history([notice])
        self.assertEqual(wire, [])

    def test_markers_keep_their_place_in_the_conversation(self):
        q = ChatMessage(role='user', content='summarise it')
        a = ChatMessage(role='assistant', content='here it is')
        wire = history.to_wire_history([q, _marker(attachment_id='9f1c', filename='r.pdf'), a])
        self.assertEqual([m['role'] for m in wire], ['user', 'system', 'assistant'])

    def test_the_pointer_counts_against_the_budget(self):
        pointer = _marker(attachment_id='9f1c', filename='r.pdf', file_type='pdf')
        cost = estimate_tokens(history.to_wire_history([pointer])[0]['content'])
        older = ChatMessage(role='user', content='x' * 4000)
        wire = history.to_wire_history([older, pointer], max_tokens=cost)
        self.assertEqual([m['role'] for m in wire], ['system'])


class UploadLoadingTests(TestCase):
    """The database side: flagging deleted files, and never loading their text."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='u', email='u@e.com', password='pw')
        self.session = ChatSession.objects.create(user=self.user, title='Uploads')
        # Markers are replayed only within the span of the turns (`turns[-1]`),
        # so a conversation with no turn yet would hide them. Real uploads always
        # come after a turn, so the fixture starts with one.
        ChatMessage.objects.create(session=self.session, role='user', content='start')

    def _attachment(self, **overrides):
        fields = dict(session=self.session, filename='report.pdf', file_type='pdf',
                      extracted_text='BODY ' * 40_000, file='report.pdf')
        fields.update(overrides)
        return ChatAttachment.objects.create(**fields)

    def _marker(self, attachment_id, filename='report.pdf'):
        return ChatMessage.objects.create(
            session=self.session, role='system', content='📎 File uploaded: report.pdf',
            message_type='system',
            metadata={'attachment_id': str(attachment_id), 'filename': filename,
                      'file_type': 'pdf', 'vfs_path': f'/Chat/{filename}'})

    def test_a_present_file_is_not_flagged_and_its_text_is_not_loaded(self):
        attachment = self._attachment()
        marker = self._marker(attachment.id)
        past = history.load_history_sync(self.session, exclude_id=None)
        loaded = next(m for m in past if m.id == marker.id)

        self.assertNotIn('attachment_deleted', loaded.metadata)
        self.assertEqual(loaded.content, marker.content)      # no appended text
        wire = history.to_wire_history(past)
        self.assertNotIn('BODY BODY', str(wire))
        pointer = next(m['content'] for m in wire if m['role'] == 'system')
        self.assertIn(f'attachment id {attachment.id}', pointer)
        self.assertNotIn('deleted', pointer)

    def test_a_deleted_file_is_flagged_in_memory_only(self):
        gone = '3c1e0c8e-9a4b-4f0e-8d2a-1b2c3d4e5f60'
        marker = self._marker(gone)
        past = history.load_history_sync(self.session, exclude_id=None)
        loaded = next(m for m in past if m.id == marker.id)

        self.assertTrue(loaded.metadata['attachment_deleted'])
        marker.refresh_from_db()
        self.assertNotIn('attachment_deleted', marker.metadata)   # never saved
        self.assertIn('no longer available', str(history.to_wire_history(past)))

    def test_a_malformed_id_counts_as_deleted(self):
        marker = self._marker('not-a-uuid')
        past = history.load_history_sync(self.session, exclude_id=None)
        loaded = next(m for m in past if m.id == marker.id)
        self.assertTrue(loaded.metadata.get('attachment_deleted'))

    def test_the_marker_is_replayed_with_the_turns_it_sits_among(self):
        attachment = self._attachment()
        ChatMessage.objects.create(session=self.session, role='user', content='read this')
        self._marker(attachment.id)
        ChatMessage.objects.create(session=self.session, role='assistant', content='done')
        wire = history.to_wire_history(history.load_history_sync(self.session, exclude_id=None))
        # The setUp opening turn comes first; the marker sits between the two turns.
        self.assertEqual([m['role'] for m in wire], ['user', 'user', 'system', 'assistant'])
        self.assertEqual(wire[2]['role'], 'system')


class RecentAttachmentsTests(TestCase):
    """Documents only for the turn they were uploaded for; images for a few messages."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='r', email='r@e.com', password='pw')
        self.session = ChatSession.objects.create(user=self.user, title='Recent')
        self.doc = ChatAttachment.objects.create(
            session=self.session, filename='spec.pdf', file_type='pdf',
            extracted_text='spec', file='spec.pdf')
        self.image = ChatAttachment.objects.create(
            session=self.session, filename='chart.png', file_type='image', file='chart.png')

    def _marker(self, attachment):
        return ChatMessage(role='system', content='', metadata={
            'attachment_id': str(attachment.id), 'filename': attachment.filename,
            'file_type': attachment.file_type})

    def _user(self, text='q'):
        return ChatMessage(role='user', content=text)

    def _assistant(self, text='a'):
        return ChatMessage(role='assistant', content=text)

    def _recent(self, messages):
        return async_to_sync(history.recent_attachments)(messages)

    def test_a_document_from_before_the_last_reply_is_not_resent(self):
        messages = [self._marker(self.doc), self._user(), self._assistant(), self._user('next')]
        self.assertEqual(self._recent(messages), [])

    def test_a_document_uploaded_after_the_last_reply_is_sent(self):
        messages = [self._user(), self._assistant(), self._marker(self.doc), self._user('read it')]
        self.assertEqual([a.id for a in self._recent(messages)], [self.doc.id])

    def test_an_image_inside_the_lookback_is_sent_after_a_reply(self):
        messages = [self._user(), self._marker(self.image), self._assistant(),
                    self._user(), self._assistant()]
        self.assertEqual([a.id for a in self._recent(messages)], [self.image.id])

    def test_an_image_outside_the_lookback_is_dropped(self):
        messages = [self._marker(self.image), self._user(), self._assistant(),
                    self._user(), self._assistant(), self._user(), self._assistant()]
        self.assertEqual(self._recent(messages), [])

    def test_an_oversized_document_is_never_sent(self):
        self.doc.is_large_file = True
        self.doc.save()
        messages = [self._user(), self._assistant(), self._marker(self.doc)]
        self.assertEqual(self._recent(messages), [])

    def test_no_markers_means_nothing(self):
        self.assertEqual(self._recent([self._user(), self._assistant()]), [])
