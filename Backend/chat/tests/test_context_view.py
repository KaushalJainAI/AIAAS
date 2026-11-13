"""
`GET /api/chat/sessions/<id>/context/`: what the assistant sees, for the user.

Pinned: owner only (another user's id is the same 404 as an unknown one);
the cache hit rate is cached read over the whole prompt (input is the
uncached part); the plan is the newest reply's todos; the notes and the
replayed messages are the ones the turn itself would use.
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from chat.models import ChatMessage, ChatSession


class ContextViewTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='c', email='c@e.com', password='pw')
        self.other = User.objects.create_user(username='d', email='d@e.com', password='pw')
        self.session = ChatSession.objects.create(
            user=self.user, title='Ctx', system_prompt='Answer briefly.')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _url(self, session=None):
        return f'/api/chat/sessions/{(session or self.session).id}/context/'

    def test_another_users_session_is_not_found(self):
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(self._url()).status_code, 404)

    def test_reports_prompt_history_plan_and_cache(self):
        ChatMessage.objects.create(session=self.session, role='user', content='first question')
        ChatMessage.objects.create(
            session=self.session, role='assistant', content='first answer',
            input_tokens=1000, cached_read_tokens=0, cached_write_tokens=0, output_tokens=50)
        ChatMessage.objects.create(session=self.session, role='user', content='second question')
        ChatMessage.objects.create(
            session=self.session, role='assistant', content='second answer',
            input_tokens=200, cached_read_tokens=800, output_tokens=40,
            metadata={'todos': [{'text': 'Draft', 'status': 'doing'}],
                      'todo_history': [{'n': 1}, {'n': 2}]})

        body = self.client.get(self._url()).json()

        self.assertIn('Answer briefly.', body['system_prompt']['full'])
        self.assertEqual(body['history']['mode'], 'window')
        self.assertEqual(body['history']['replayed'], 4)
        self.assertEqual(body['history']['not_shown'], 0)
        self.assertEqual(body['plan']['todos'][0]['text'], 'Draft')
        self.assertEqual(body['plan']['revisions'], 2)
        self.assertEqual(body['cache']['last_turn']['hit_rate'], 0.8)
        self.assertEqual(body['cache']['conversation']['prompt_tokens'], 2000)
        self.assertEqual(body['cache']['conversation']['hit_rate'], 0.4)
        self.assertGreater(body['tokens']['total'], 0)
        self.assertEqual(body['tokens']['total'], sum(
            body['tokens'][k] for k in ('system', 'notes', 'history', 'tools')))

    def test_a_conversation_with_notes_shows_them_and_replays_the_task(self):
        u = ChatMessage.objects.create(session=self.session, role='user', content='plan it')
        a = ChatMessage.objects.create(session=self.session, role='assistant', content='planned')
        self.session.notes_state = {
            'summary': 'Planning a launch.', 'through': a.id, 'current': 'T1',
            'tasks': [{'id': 'T1', 'title': 'Launch plan', 'status': 'in_progress',
                       'messages': [u.id, a.id]}],
        }
        self.session.save()

        body = self.client.get(self._url()).json()
        self.assertEqual(body['history']['mode'], 'task')
        self.assertIn('Planning a launch.', body['notes']['text'])
        self.assertEqual(body['notes']['tasks'][0]['title'], 'Launch plan')
        self.assertGreater(body['tokens']['notes'], 0)

    def test_memory_off_replays_nothing(self):
        self.session.memory_enabled = False
        self.session.save()
        ChatMessage.objects.create(session=self.session, role='user', content='hi')
        body = self.client.get(self._url()).json()
        self.assertEqual(body['history']['mode'], 'off')
        self.assertEqual(body['history']['replayed'], 0)
        self.assertIsNone(body['cache']['last_turn'])
