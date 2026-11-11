"""
Read-only sharing of knowledge bases with an organisation (K6).

The rules under test:

* A member of the owner's organisation can search and read a shared knowledge
  base from a chat that belongs to that organisation, and only from there.
* Membership is read live: a removed member loses it on the next call, and so
  does everyone when the owner leaves the organisation.
* Unknown, foreign-unshared, hidden and non-member answers are the same, so an
  id cannot be probed.
* Agent runs never read a team knowledge base, even from an org chat.
* Writes stay with the owner. A curator may only switch sharing off.
* An eval world's hidden corpus can never be shared or read through the door.
"""
from __future__ import annotations

import json
import pathlib
import re
from unittest import mock

from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, TransactionTestCase
from rest_framework.test import APIClient

from chat.tools.knowledge import (
    chat_org_id,
    keyword_search,
    list_documents,
    list_knowledge_bases,
    read_document,
)
from core.models import Membership, Organization
from inference import kb_access
from inference.backends.fulltext import FullTextBackend
from inference.models import HIDDEN_KB_PREFIX, Document, KnowledgeBase

User = get_user_model()


def _orgs_and_people():
    """Org A (owner + member) and org B (one member), plus an outsider."""
    owner = User.objects.create_user('alice', 'alice@example.test', 'pw-alice-1')
    member = User.objects.create_user('bob', 'bob@example.test', 'pw-bob-1')
    outsider = User.objects.create_user('carol', 'carol@example.test', 'pw-carol-1')
    other_org_member = User.objects.create_user('dan', 'dan@example.test', 'pw-dan-1')
    org_a = Organization.objects.create(name='Acme', created_by=owner)
    org_b = Organization.objects.create(name='Other Co', created_by=other_org_member)
    Membership.objects.create(org=org_a, user=owner, role='owner')
    Membership.objects.create(org=org_a, user=member, role='member')
    Membership.objects.create(org=org_b, user=other_org_member, role='owner')
    return owner, member, outsider, other_org_member, org_a, org_b


def _ingest(kb, owner, name, content):
    """A keyword-searchable document in `kb`. Keyword search needs no model call."""
    doc = Document.objects.create(
        user=owner, knowledge_base=kb, name=name, file_type='txt',
        file_size=len(content), content_text=content, status='indexed',
    )
    async_to_sync(FullTextBackend(kb).ingest)(doc)
    return doc


def _chat_ctx(user, org=None, **extra):
    ctx = {'user_id': user.id, 'session_id': 's', 'turn_id': 't'}
    if org is not None:
        ctx['org_id'] = org.id
    ctx.update(extra)
    return ctx


def _client_as(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _same_error_shape(a: str, b: str, ident_a, ident_b) -> bool:
    """Two refusals are indistinguishable when they differ only in the id asked for."""
    return a.replace(str(ident_a), '#') == b.replace(str(ident_b), '#')


class SharingFixture(TransactionTestCase):
    def setUp(self):
        (self.owner, self.member, self.outsider, self.dan,
         self.org_a, self.org_b) = _orgs_and_people()
        self.shared = KnowledgeBase.objects.create(
            user=self.owner, name='Handbook', backend='fulltext',
            org=self.org_a, shared_with_org=True,
        )
        self.doc = _ingest(self.shared, self.owner, 'policy.txt',
                           'expense claims need manager approval within thirty days')
        # The owner's own KB, not shared: the member must not see it.
        self.private = KnowledgeBase.objects.create(
            user=self.owner, name='Private notes', backend='fulltext',
        )
        self.private_doc = _ingest(self.private, self.owner, 'diary.txt',
                                   'salary negotiation strategy private')
        self.member_default = KnowledgeBase.objects.create(
            user=self.member, name='Default', backend='fulltext', is_default=True,
        )


class ChatReadsTeamKnowledgeTests(SharingFixture):
    def test_member_searches_a_shared_kb_from_an_org_chat(self):
        out = json.loads(async_to_sync(keyword_search)(
            {'query': 'expense', 'kb_id': self.shared.id},
            _chat_ctx(self.member, self.org_a),
        ))
        self.assertEqual(out['status'], 'success')
        self.assertEqual(out['results'][0]['document_id'], self.doc.id)

    def test_member_sees_the_shared_kb_in_the_listing_marked_as_team(self):
        out = json.loads(async_to_sync(list_knowledge_bases)(
            {}, _chat_ctx(self.member, self.org_a)))
        by_name = {kb['name']: kb for kb in out['knowledge_bases']}
        self.assertIn('Handbook', by_name)
        self.assertTrue(by_name['Handbook']['shared_by_team'])
        self.assertNotIn('Private notes', by_name)

    def test_member_reads_a_document_in_the_shared_kb(self):
        result = async_to_sync(read_document)(
            {'document_id': self.doc.id}, _chat_ctx(self.member, self.org_a))
        self.assertIn('manager approval', result)

    def test_member_lists_the_documents_of_the_shared_kb(self):
        out = json.loads(async_to_sync(list_documents)(
            {'kb_id': self.shared.id}, _chat_ctx(self.member, self.org_a)))
        self.assertEqual([d['id'] for d in out['documents']], [self.doc.id])

    def test_the_same_member_in_a_personal_chat_cannot_read_it(self):
        out = json.loads(async_to_sync(keyword_search)(
            {'query': 'expense', 'kb_id': self.shared.id},
            _chat_ctx(self.member),
        ))
        self.assertIn('error', out)

    def test_the_same_member_in_a_personal_chat_cannot_read_the_document(self):
        result = json.loads(async_to_sync(read_document)(
            {'document_id': self.doc.id}, _chat_ctx(self.member)))
        self.assertIn('error', result)

    def test_a_personal_chat_default_kb_is_never_a_team_kb(self):
        out = json.loads(async_to_sync(keyword_search)(
            {'query': 'expense'}, _chat_ctx(self.member, self.org_a)))
        # No kb_id: the member's own default is searched, not the team's KB.
        self.assertNotIn('expense', json.dumps(out))

    def test_a_private_kb_stays_unreadable_while_another_kb_is_shared(self):
        out = json.loads(async_to_sync(keyword_search)(
            {'query': 'salary', 'kb_id': self.private.id},
            _chat_ctx(self.member, self.org_a),
        ))
        self.assertIn('error', out)


class MembershipIsReadLiveTests(SharingFixture):
    def test_a_removed_member_loses_the_kb_on_the_next_call(self):
        ctx = _chat_ctx(self.member, self.org_a)
        before = json.loads(async_to_sync(keyword_search)(
            {'query': 'expense', 'kb_id': self.shared.id}, ctx))
        self.assertEqual(before['status'], 'success')

        Membership.objects.filter(org=self.org_a, user=self.member).delete()

        after = json.loads(async_to_sync(keyword_search)(
            {'query': 'expense', 'kb_id': self.shared.id}, ctx))
        self.assertIn('error', after)
        self.assertIn('error', json.loads(async_to_sync(read_document)(
            {'document_id': self.doc.id}, ctx)))

    def test_when_the_owner_leaves_the_org_the_share_stops_for_everyone(self):
        Membership.objects.filter(org=self.org_a, user=self.owner).delete()
        out = json.loads(async_to_sync(keyword_search)(
            {'query': 'expense', 'kb_id': self.shared.id},
            _chat_ctx(self.member, self.org_a)))
        self.assertIn('error', out)

    def test_kb_access_asks_membership_each_call(self):
        self.assertIsNotNone(kb_access.get_readable_kb(
            self.member.id, self.org_a.id, self.shared.id))
        Membership.objects.filter(org=self.org_a, user=self.member).delete()
        self.assertIsNone(kb_access.get_readable_kb(
            self.member.id, self.org_a.id, self.shared.id))


class OtherOrgAndUnknownIdsTests(SharingFixture):
    def test_a_member_of_another_org_cannot_read_by_id(self):
        ctx = _chat_ctx(self.dan, self.org_b)
        foreign = json.loads(async_to_sync(keyword_search)(
            {'query': 'expense', 'kb_id': self.shared.id}, ctx))
        unknown = json.loads(async_to_sync(keyword_search)(
            {'query': 'expense', 'kb_id': 999_999}, ctx))
        self.assertIn('error', foreign)
        self.assertTrue(_same_error_shape(
            foreign['error'], unknown['error'], self.shared.id, 999_999))

    def test_a_non_member_gets_the_same_answer_as_an_unknown_id_for_a_document(self):
        ctx = _chat_ctx(self.outsider, self.org_a)
        foreign = json.loads(async_to_sync(read_document)(
            {'document_id': self.doc.id}, ctx))
        unknown = json.loads(async_to_sync(read_document)(
            {'document_id': 999_999}, ctx))
        self.assertTrue(_same_error_shape(
            foreign['error'], unknown['error'], self.doc.id, 999_999))

    def test_a_document_in_a_private_kb_answers_like_an_unknown_one(self):
        ctx = _chat_ctx(self.member, self.org_a)
        private = json.loads(async_to_sync(read_document)(
            {'document_id': self.private_doc.id}, ctx))
        unknown = json.loads(async_to_sync(read_document)(
            {'document_id': 999_999}, ctx))
        self.assertTrue(_same_error_shape(
            private['error'], unknown['error'], self.private_doc.id, 999_999))
        self.assertNotIn('salary', json.dumps(private))


class AgentRunsStayWithTheOwnerTests(SharingFixture):
    """A run started from an org chat carries the org (for solutions), but its
    knowledge-base reads are the owner's own and nothing more."""

    def _run_ctx(self, user, org):
        return _chat_ctx(user, org, execution_id='exec-1', kb_scope=None)

    def test_an_agent_run_from_an_org_chat_cannot_read_a_team_kb(self):
        out = json.loads(async_to_sync(keyword_search)(
            {'query': 'expense', 'kb_id': self.shared.id},
            self._run_ctx(self.member, self.org_a)))
        self.assertIn('error', out)

    def test_an_agent_run_does_not_list_team_kbs(self):
        out = json.loads(async_to_sync(list_knowledge_bases)(
            {}, self._run_ctx(self.member, self.org_a)))
        self.assertNotIn('Handbook', [kb['name'] for kb in out['knowledge_bases']])

    def test_chat_org_id_is_none_for_any_run(self):
        self.assertIsNone(chat_org_id(self._run_ctx(self.member, self.org_a)))
        self.assertEqual(chat_org_id(_chat_ctx(self.member, self.org_a)), self.org_a.id)
        self.assertIsNone(chat_org_id(_chat_ctx(self.member)))


class HiddenEvalCorpusTests(SharingFixture):
    def setUp(self):
        super().setUp()
        self.hidden = KnowledgeBase.objects.create(
            user=self.owner, name=f'{HIDDEN_KB_PREFIX}s1/v1', backend='fulltext',
        )
        _ingest(self.hidden, self.owner, 'world.txt', 'planted fact zebra')

    def test_a_hidden_kb_is_not_readable_through_the_door_even_if_flagged(self):
        # Set the flags directly: the API refuses this, but the door must hold
        # even if a row ever carries them.
        KnowledgeBase.objects.filter(id=self.hidden.id).update(
            org=self.org_a, shared_with_org=True)
        self.assertIsNone(kb_access.get_readable_kb(
            self.member.id, self.org_a.id, self.hidden.id))
        self.assertIsNone(kb_access.get_readable_kb(
            self.owner.id, None, self.hidden.id))
        self.assertFalse(kb_access.readable_kbs(
            self.member.id, self.org_a.id).filter(id=self.hidden.id).exists())

    def test_a_hidden_kb_is_refused_to_a_chat_by_id(self):
        out = json.loads(async_to_sync(keyword_search)(
            {'query': 'zebra', 'kb_id': self.hidden.id}, _chat_ctx(self.owner)))
        self.assertIn('error', out)

    def test_an_eval_run_still_reaches_its_own_hidden_corpus(self):
        out = json.loads(async_to_sync(keyword_search)(
            {'query': 'zebra', 'kb_id': self.hidden.id},
            _chat_ctx(self.owner, kb_scope=[self.hidden.id], execution_id='eval-1')))
        self.assertEqual(out['status'], 'success')

    def test_a_hidden_kb_cannot_be_shared_through_the_api(self):
        resp = _client_as(self.owner).patch(
            f'/api/inference/knowledge-bases/{self.hidden.id}/',
            {'org': self.org_a.id, 'shared_with_org': True}, format='json')
        self.assertEqual(resp.status_code, 404)
        self.hidden.refresh_from_db()
        self.assertFalse(self.hidden.shared_with_org)


class ChokePointTests(SimpleTestCase):
    """Chat tools reach knowledge bases only through `inference/kb_access.py`.

    The same shape as `solutions/tests/test_isolation.py::ChokePointTests`. A new
    tool that writes `KnowledgeBase.objects.filter(user=...)` would quietly keep
    team KBs out of chat and is the first thing a refactor would reintroduce.
    """

    FORBIDDEN = re.compile(r'KnowledgeBase\.objects|knowledge_base__user|kb\.user\b')

    def test_chat_tools_never_query_knowledge_bases_directly(self):
        root = pathlib.Path(__file__).resolve().parents[2] / 'chat' / 'tools'
        offenders = []
        for path in root.rglob('*.py'):
            text = path.read_text(encoding='utf-8', errors='ignore')
            if self.FORBIDDEN.search(text):
                offenders.append(path.relative_to(root).as_posix())
        self.assertEqual(
            offenders, [],
            'Read knowledge bases through inference/kb_access.py '
            '(readable_kbs / get_readable_kb / owned_in_scope)')


class WritesStayWithTheOwnerTests(SharingFixture):
    def test_a_member_cannot_upload_into_the_shared_kb(self):
        client = _client_as(self.member)
        before = KnowledgeBase.objects.get(id=self.shared.id).doc_count
        upload = SimpleUploadedFile('new.txt', b'added by bob', content_type='text/plain')
        with mock.patch('inference.views.indexing.index_document'):
            resp = client.post('/api/inference/documents/',
                               {'file': upload, 'kb_id': self.shared.id}, format='multipart')
        self.assertEqual(resp.status_code, 201)
        landed = Document.objects.get(id=resp.data['id'])
        # Refused quietly into the member's own default: never the team KB.
        self.assertEqual(landed.knowledge_base_id, self.member_default.id)
        self.assertEqual(KnowledgeBase.objects.get(id=self.shared.id).doc_count, before)

    def test_a_member_cannot_delete_a_document_of_the_shared_kb(self):
        client = _client_as(self.member)
        resp = client.delete(f'/api/inference/documents/{self.doc.id}/')
        self.assertEqual(resp.status_code, 404)
        self.doc.refresh_from_db()
        self.assertIsNone(self.doc.deleted_at)

    def test_a_member_cannot_rename_a_document_of_the_shared_kb(self):
        client = _client_as(self.member)
        resp = client.patch(f'/api/inference/documents/{self.doc.id}/',
                            {'name': 'mine now'}, format='json')
        self.assertEqual(resp.status_code, 404)

    def test_a_member_cannot_change_the_kb_sharing(self):
        client = _client_as(self.member)
        resp = client.patch(f'/api/inference/knowledge-bases/{self.shared.id}/',
                            {'shared_with_org': False}, format='json')
        self.assertEqual(resp.status_code, 403)
        self.shared.refresh_from_db()
        self.assertTrue(self.shared.shared_with_org)


class ShareEndpointTests(SharingFixture):
    def _patch(self, user, kb, body):
        return _client_as(user).patch(
            f'/api/inference/knowledge-bases/{kb.id}/', body, format='json')

    def test_owner_shares_a_private_kb_with_an_org_they_belong_to(self):
        resp = self._patch(self.owner, self.private,
                           {'org': self.org_a.id, 'shared_with_org': True})
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data['shared_with_org'])
        self.assertEqual(resp.data['org'], self.org_a.id)
        # Now the member can read it, from an org chat.
        out = json.loads(async_to_sync(keyword_search)(
            {'query': 'salary', 'kb_id': self.private.id},
            _chat_ctx(self.member, self.org_a)))
        self.assertEqual(out['status'], 'success')

    def test_owner_cannot_share_with_an_org_they_are_not_in(self):
        resp = self._patch(self.owner, self.private,
                           {'org': self.org_b.id, 'shared_with_org': True})
        self.assertEqual(resp.status_code, 404)
        self.private.refresh_from_db()
        self.assertIsNone(self.private.org_id)

    def test_sharing_without_an_org_is_refused(self):
        resp = self._patch(self.owner, self.private, {'shared_with_org': True})
        self.assertEqual(resp.status_code, 400)

    def test_changing_the_org_stops_the_share_until_the_owner_turns_it_on(self):
        resp = self._patch(self.owner, self.shared, {'org': None})
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.data['shared_with_org'])
        self.assertIsNone(resp.data['org'])

    def test_a_non_owner_member_cannot_share_or_unshare_by_patching(self):
        resp = self._patch(self.member, self.shared, {'shared_with_org': False})
        self.assertEqual(resp.status_code, 403)

    def test_unknown_and_foreign_ids_give_the_same_404(self):
        unknown = self._patch(self.owner, _Stub(999_999), {'shared_with_org': False})
        foreign = self._patch(self.outsider, self.private, {'shared_with_org': False})
        self.assertEqual(unknown.status_code, 404)
        self.assertEqual(foreign.status_code, 404)
        self.assertEqual(unknown.data, foreign.data)

    def test_a_curator_can_only_switch_the_sharing_off(self):
        curator = User.objects.create_user('cora', 'cora@example.test', 'pw-cora-1')
        Membership.objects.create(org=self.org_a, user=curator, role='curator')

        turn_on = self._patch(curator, self.private, {'shared_with_org': True})
        self.assertEqual(turn_on.status_code, 404)  # not readable: not shared yet

        self.private.org = self.org_a
        self.private.shared_with_org = True
        self.private.save()
        change_org = self._patch(curator, self.private,
                                 {'org': self.org_b.id, 'shared_with_org': False})
        self.assertEqual(change_org.status_code, 403)

        off = self._patch(curator, self.private, {'shared_with_org': False})
        self.assertEqual(off.status_code, 200)
        self.private.refresh_from_db()
        self.assertFalse(self.private.shared_with_org)
        self.assertEqual(self.private.org_id, self.org_a.id)


class _Stub:
    """Just enough of a KnowledgeBase to address an id that does not exist."""

    def __init__(self, pk):
        self.id = pk


class OrgListTests(SharingFixture):
    def test_the_org_listing_adds_the_teams_shared_kbs(self):
        resp = _client_as(self.member).get(f'/api/inference/knowledge-bases/?org={self.org_a.id}')
        self.assertEqual(resp.status_code, 200)
        names = {kb['name']: kb for kb in resp.data['knowledge_bases']}
        self.assertIn('Handbook', names)
        self.assertFalse(names['Handbook']['is_mine'])
        self.assertEqual(names['Handbook']['owner_name'], 'alice')
        self.assertNotIn('Private notes', names)  # not shared, not the member's

    def test_the_plain_listing_is_only_the_callers_own(self):
        resp = _client_as(self.member).get('/api/inference/knowledge-bases/')
        self.assertEqual([kb['name'] for kb in resp.data['knowledge_bases']], ['Default'])

    def test_an_org_the_caller_is_not_in_is_a_404(self):
        resp = _client_as(self.member).get(f'/api/inference/knowledge-bases/?org={self.org_b.id}')
        self.assertEqual(resp.status_code, 404)

    def test_the_list_is_capped_and_says_so(self):
        with mock.patch('inference.kb_views.KB_LIST_CAP', 1):
            resp = _client_as(self.owner).get('/api/inference/knowledge-bases/')
        self.assertEqual(resp.data['count'], 1)
        self.assertTrue(resp.data['truncated'])
