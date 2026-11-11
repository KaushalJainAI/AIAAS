"""The session list is the sidebar, not a bulk export of every transcript.

`ChatSessionSerializer` nests `messages`, and the list used it — so rendering a
history of titles fetched every message of every listed conversation, one query
per session. These pin the two halves: the list carries no transcript and costs
a fixed number of queries however many conversations there are, while the
detail route still returns the whole transcript.
"""
from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from chat.models import ChatMessage, ChatSession

User = get_user_model()


class SessionListTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="lister", email="lister@example.com", password="pw",
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _session_with_messages(self, n: int) -> ChatSession:
        session = ChatSession.objects.create(user=self.user, title=f"s{n}")
        for i in range(n):
            ChatMessage.objects.create(session=session, role="user", content=f"m{i}")
        return session

    def _list(self):
        response = self.client.get("/api/chat/sessions/")
        self.assertEqual(response.status_code, 200)
        return response.json()["results"]

    def test_the_list_carries_no_transcript(self):
        self._session_with_messages(3)
        (row,) = self._list()
        self.assertNotIn("messages", row)
        self.assertEqual(row["title"], "s3")

    def test_the_list_costs_the_same_however_many_sessions(self):
        self._session_with_messages(2)
        with CaptureQueriesContext(connection) as few:
            self._list()
        for n in range(3, 10):
            self._session_with_messages(n)
        with CaptureQueriesContext(connection) as many:
            self._list()
        self.assertEqual(len(few), len(many))

    def test_the_detail_still_returns_the_transcript(self):
        session = self._session_with_messages(4)
        response = self.client.get(f"/api/chat/sessions/{session.id}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([m["content"] for m in response.json()["messages"]],
                         ["m0", "m1", "m2", "m3"])

    def test_the_detail_does_not_query_per_message(self):
        small = self._session_with_messages(2)
        large = self._session_with_messages(12)
        with CaptureQueriesContext(connection) as few:
            self.client.get(f"/api/chat/sessions/{small.id}/")
        with CaptureQueriesContext(connection) as many:
            self.client.get(f"/api/chat/sessions/{large.id}/")
        self.assertEqual(len(few), len(many))


class SessionRunStateTests(TestCase):
    """`run_state` and `last_agent` on the list rows (the history list's groups).

    The live half is read from the in-process run table, so these tests put a
    run straight into it rather than starting a real turn. That table is shared
    module state, so each test clears what it added.
    """

    def setUp(self):
        from chat.turn import runs

        self.user = User.objects.create_user(
            username="stater", email="stater@example.com", password="pw",
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self._runs = runs._runs
        self.addCleanup(self._runs.clear)

    def _session(self, title: str, **fields) -> ChatSession:
        return ChatSession.objects.create(user=self.user, title=title, **fields)

    def _row(self, session: ChatSession) -> dict:
        rows = self.client.get("/api/chat/sessions/").json()["results"]
        return next(r for r in rows if r["id"] == str(session.id))

    def _mark_running(self, session: ChatSession, user_id: int | None = None) -> None:
        from chat.turn.runs import ChatRun

        self._runs[str(session.id)] = ChatRun(
            key=str(session.id), user_id=self.user.id if user_id is None else user_id)

    def test_a_quiet_session_is_idle_with_no_agent(self):
        session = self._session("quiet")
        row = self._row(session)
        self.assertEqual(row["run_state"], "idle")
        self.assertIsNone(row["last_agent"])

    def test_a_session_with_a_turn_in_flight_is_running(self):
        session = self._session("busy")
        self._mark_running(session)
        self.assertEqual(self._row(session)["run_state"], "running")

    def test_a_turn_by_another_user_does_not_make_this_one_running(self):
        session = self._session("theirs")
        self._mark_running(session, user_id=self.user.id + 999)
        self.assertEqual(self._row(session)["run_state"], "idle")

    def test_waiting_for_approval_outranks_running(self):
        session = self._session("paused", awaiting_approval=True)
        self._mark_running(session)
        self.assertEqual(self._row(session)["run_state"], "waiting")

    def test_a_stored_worker_name_is_listed(self):
        session = self._session("delegated", last_agent="Researcher")
        self.assertEqual(self._row(session)["last_agent"], "Researcher")

    def test_the_active_set_is_read_once_per_list(self):
        from unittest.mock import patch

        from chat.turn import runs

        for n in range(4):
            self._session(f"s{n}")
        with patch.object(runs, "active_keys", wraps=runs.active_keys) as active:
            self.client.get("/api/chat/sessions/")
        self.assertEqual(active.call_count, 1)
