"""
The knowledge-base write tools, and the reads that changed with the folder rule.

What the model experiences is what these pin: an unknown knowledge base and one
outside the run's scope get the same answer; a write over the size cap is refused
rather than cut; a KB write asks for approval in `ask`, `review` and `auto`, and
runs unasked only in `full`; chat is never offered either tool.

The search backends are replaced with fakes where the test is about routing and
merging (`_search_one`), because a real vector index needs an embedding service.
"""
from __future__ import annotations

import json
from types import SimpleNamespace
from unittest import mock

from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase, TransactionTestCase

from agents.agent.runtime import AgentToolbox, approval_policy_for, build_file_scope, sensitive_tools_for
from agents.grants import GRANT_TOOLS
from chat.tools import permissions
from chat.tools.knowledge import (
    add_to_knowledge_base,
    create_knowledge_base,
    keyword_search,
    knowledge_base_search,
    list_knowledge_bases,
    read_document,
)
from chat.tools.registry import get as registry_get
from chat.tools.registry import names_with_effect
from chat.turn import reviewer
from inference import filesystem as fs
from inference import vfs
from inference.models import Document, KnowledgeBase
from inference.vfs import FileScope
from llm.testing import scripted_model, text

KB_TOOLS = ('create_knowledge_base', 'add_to_knowledge_base')


def _scope(user, root=None, *, write=True, write_prefix=()):
    """A file scope over `root` (None: the whole tree), writable as asked."""
    return FileScope(
        user=user, root=root, mode='full' if root is None else 'scoped',
        label=('/' + root.name) if root else '/',
        write_prefix=write_prefix if write else None,
        write_label=('/' + root.name) if root else '/',
    )


class _Base(TransactionTestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='kbwriter', email='w@example.test', password='x')
        self.research = fs.create_folder(self.user, 'Research', None)
        self.other = fs.create_folder(self.user, 'Other', None)

    def ctx(self, scope=None, kb_scope=None, **extra):
        return {
            'user_id': self.user.id, 'session_id': 's', 'turn_id': 't',
            'file_scope': scope, 'kb_scope': kb_scope, **extra,
        }


class CreateKnowledgeBaseTests(_Base):
    def test_creates_the_folder_and_binds_a_knowledge_base_to_it(self):
        out = json.loads(async_to_sync(create_knowledge_base)(
            {'name': 'Q3 research', 'folder_path': 'Research/Q3'},
            self.ctx(_scope(self.user)),
        ))
        self.assertEqual(out['status'], 'created')
        kb = KnowledgeBase.objects.get(id=out['kb_id'])
        self.assertEqual(kb.folder.name, 'Q3')
        self.assertEqual(kb.folder.user_id, self.user.id)
        self.assertEqual(kb.backend, 'hybrid')
        self.assertEqual(out['folder_path'], '/Research/Q3')

    def test_the_same_name_in_the_same_folder_is_reused(self):
        scope = _scope(self.user)
        first = json.loads(async_to_sync(create_knowledge_base)(
            {'name': 'Notes', 'folder_path': 'Research'}, self.ctx(scope)))
        again = json.loads(async_to_sync(create_knowledge_base)(
            {'name': 'Notes', 'folder_path': 'Research'}, self.ctx(scope)))
        self.assertEqual(first['kb_id'], again['kb_id'])
        self.assertEqual(again['status'], 'exists')
        self.assertEqual(KnowledgeBase.objects.filter(user=self.user, name='Notes').count(), 1)

    def test_the_same_name_in_another_folder_is_refused(self):
        scope = _scope(self.user)
        async_to_sync(create_knowledge_base)(
            {'name': 'Notes', 'folder_path': 'Research'}, self.ctx(scope))
        out = json.loads(async_to_sync(create_knowledge_base)(
            {'name': 'Notes', 'folder_path': 'Other'}, self.ctx(scope)))
        self.assertIn('another folder', out['error'])

    def test_no_file_access_is_refused(self):
        out = json.loads(async_to_sync(create_knowledge_base)(
            {'name': 'X', 'folder_path': 'Research'}, self.ctx(None)))
        self.assertIn('no file access', out['error'])
        self.assertFalse(KnowledgeBase.objects.filter(name='X').exists())

    def test_a_read_only_scope_is_refused_and_creates_nothing(self):
        out = json.loads(async_to_sync(create_knowledge_base)(
            {'name': 'X', 'folder_path': 'Research'},
            self.ctx(_scope(self.user, write=False)),
        ))
        self.assertIn('read-only', out['error'])
        self.assertFalse(KnowledgeBase.objects.filter(name='X').exists())

    def test_a_folder_outside_the_writable_prefix_is_refused(self):
        scope = _scope(self.user, None, write=True, write_prefix=('Chat',))
        out = json.loads(async_to_sync(create_knowledge_base)(
            {'name': 'X', 'folder_path': 'Research'}, self.ctx(scope)))
        self.assertIn('can only create folders inside', out['error'])

    def test_an_unknown_backend_is_refused(self):
        out = json.loads(async_to_sync(create_knowledge_base)(
            {'name': 'X', 'folder_path': 'Research', 'backend': 'magic'},
            self.ctx(_scope(self.user))))
        self.assertIn('not a knowledge base type', out['error'])


class AddToKnowledgeBaseTests(_Base):
    def setUp(self):
        super().setUp()
        self.kb = KnowledgeBase.objects.create(
            user=self.user, name='Research KB', backend='fulltext', folder=self.research)
        self.scope = _scope(self.user)
        patcher = mock.patch('inference.indexing.index_document')
        self.queue = patcher.start()
        self.addCleanup(patcher.stop)

    def _add(self, kb_id, title, text, ctx=None):
        return json.loads(async_to_sync(add_to_knowledge_base)(
            {'kb_id': kb_id, 'title': title, 'text': text},
            ctx or self.ctx(self.scope, kb_scope=None)))

    def test_writes_a_markdown_document_into_the_folder_and_queues_indexing(self):
        out = self._add(self.kb.id, 'Refund policy', '# Refunds\n\nWithin 30 days.')
        self.assertEqual(out['status'], 'indexing')
        doc = Document.objects.get(id=out['document_id'])
        self.assertEqual(doc.name, 'Refund policy.md')
        self.assertEqual(doc.folder_id, self.research.id)
        self.assertEqual(doc.knowledge_base_id, self.kb.id)
        self.assertEqual(doc.status, 'pending')
        self.queue.assert_called_once_with(doc.id, self.kb.id)

    def test_a_title_that_already_ends_in_md_is_not_doubled(self):
        out = self._add(self.kb.id, 'Notes.md', 'text')
        self.assertEqual(Document.objects.get(id=out['document_id']).name, 'Notes.md')

    def test_the_same_title_again_replaces_the_document_and_keeps_one(self):
        first = self._add(self.kb.id, 'Plan', 'version one')
        second = self._add(self.kb.id, 'Plan', 'version two')
        self.assertEqual(first['document_id'], second['document_id'])
        self.assertFalse(second['created'])
        self.assertEqual(Document.objects.filter(name='Plan.md').count(), 1)
        self.assertEqual(Document.objects.get(id=first['document_id']).content_text, 'version two')

    def test_text_over_the_write_cap_is_refused_not_cut(self):
        big = 'x' * (vfs.AGENT_FILE_WRITE_CHARS + 1)
        out = self._add(self.kb.id, 'Big', big)
        self.assertIn('limit for one write', out['error'])
        self.assertFalse(Document.objects.filter(name='Big.md').exists())
        self.queue.assert_not_called()

    def test_an_out_of_scope_kb_and_an_unknown_one_get_the_same_answer(self):
        # Owned by the same user, bound to a folder the run cannot reach.
        outside = KnowledgeBase.objects.create(
            user=self.user, name='Other KB', backend='fulltext', folder=self.other)
        scope = _scope(self.user, self.research)
        ctx = self.ctx(scope, kb_scope=(self.kb.id,))
        out_of_scope = self._add(outside.id, 'Plan', 'x', ctx)
        unknown = self._add(987654, 'Plan', 'x', ctx)
        self.assertEqual(
            out_of_scope['error'].replace(str(outside.id), 'N'),
            unknown['error'].replace('987654', 'N'))
        self.assertIn('may write to', out_of_scope['error'])
        self.queue.assert_not_called()

    def test_a_folder_the_run_can_read_but_not_write_is_refused(self):
        scope = _scope(self.user, self.research, write=False)
        out = self._add(self.kb.id, 'Plan', 'x', self.ctx(scope, kb_scope=(self.kb.id,)))
        self.assertIn('read but not write', out['error'])
        self.assertFalse(Document.objects.filter(name='Plan.md').exists())

    def test_a_knowledge_base_with_no_folder_is_refused(self):
        loose = KnowledgeBase.objects.create(user=self.user, name='Loose', backend='fulltext')
        out = self._add(loose.id, 'Plan', 'x')
        self.assertIn('not bound to a folder', out['error'])

    def test_a_document_of_that_name_in_another_kb_is_not_moved(self):
        other_kb = KnowledgeBase.objects.create(
            user=self.user, name='Elsewhere', backend='fulltext', folder=self.research)
        Document.objects.create(
            user=self.user, name='Plan.md', file='', file_type='md', file_size=1,
            content_text='theirs', folder=self.research, knowledge_base=other_kb)
        out = self._add(self.kb.id, 'Plan', 'mine')
        self.assertIn('another knowledge base', out['error'])
        self.assertEqual(Document.objects.get(name='Plan.md').knowledge_base_id, other_kb.id)


class ReadDocumentFollowsTheFolderRuleTests(_Base):
    def test_a_document_in_a_kb_bound_inside_the_files_is_readable(self):
        kb = KnowledgeBase.objects.create(
            user=self.user, name='Inside', backend='raw', folder=self.research)
        doc = Document.objects.create(
            user=self.user, name='a.md', file='', file_type='md', file_size=2,
            content_text='hi', folder=self.research, knowledge_base=kb)
        scope = _scope(self.user, self.research, write=False)
        out = async_to_sync(read_document)(
            {'document_id': doc.id}, self.ctx(scope, kb_scope=(999999,)))
        self.assertIn('hi', out)

    def test_a_document_in_a_kb_outside_the_files_and_the_selection_is_not(self):
        kb = KnowledgeBase.objects.create(
            user=self.user, name='Outside', backend='raw', folder=self.other)
        doc = Document.objects.create(
            user=self.user, name='b.md', file='', file_type='md', file_size=2,
            content_text='hi', folder=self.other, knowledge_base=kb)
        scope = _scope(self.user, self.research, write=False)
        out = json.loads(async_to_sync(read_document)(
            {'document_id': doc.id}, self.ctx(scope, kb_scope=(999999,))))
        self.assertIn('may read', out['error'])


class GroupedSearchTests(_Base):
    def setUp(self):
        super().setUp()
        self.parent = KnowledgeBase.objects.create(
            user=self.user, name='Research index', backend='fulltext', folder=self.research)
        self.q3 = fs.create_folder(self.user, 'Q3', self.research)
        self.child = KnowledgeBase.objects.create(
            user=self.user, name='Q3 index', backend='fulltext', folder=self.q3)
        self.sibling = KnowledgeBase.objects.create(
            user=self.user, name='Other index', backend='fulltext', folder=self.other)

    def _fake(self, hits):
        def fake(kb, query, top_k, mode, snippet_chars):
            return hits.get(kb.id)
        return mock.AsyncMock(side_effect=fake)

    def test_include_children_merges_and_ranks_the_hits_across_the_tree(self):
        fake = self._fake({
            self.parent.id: [{'retrieval': 'semantic', 'document_id': 1, 'score': 0.5, 'content': 'p'}],
            self.child.id: [{'retrieval': 'semantic', 'document_id': 2, 'score': 0.9, 'content': 'c'}],
        })
        scope = _scope(self.user, self.research, write=False)
        with mock.patch('chat.tools.knowledge._search_one', fake):
            out = json.loads(async_to_sync(knowledge_base_search)(
                {'query': 'q', 'kb_id': self.parent.id, 'include_children': True},
                self.ctx(scope, kb_scope=(self.parent.id,))))
        self.assertEqual([r['kb_id'] for r in out['results']], [self.child.id, self.parent.id])
        self.assertEqual({k['name'] for k in out['searched']}, {'Research index', 'Q3 index'})
        self.assertEqual(fake.call_count, 2)

    def test_without_the_flag_nothing_new_runs(self):
        fake = self._fake({})
        scope = _scope(self.user, self.research, write=False)
        with mock.patch('chat.tools.knowledge._search_one', fake):
            out = json.loads(async_to_sync(knowledge_base_search)(
                {'query': 'q', 'kb_id': self.parent.id},
                self.ctx(scope, kb_scope=(self.parent.id,))))
        self.assertEqual(fake.call_count, 0)
        self.assertNotIn('searched', out)

    def test_a_child_the_run_may_not_use_is_not_searched(self):
        # A selection that names only the parent, and no file scope: the child is
        # bound beneath it but is neither selected nor inside the files.
        fake = self._fake({})
        with mock.patch('chat.tools.knowledge._search_one', fake):
            out = json.loads(async_to_sync(knowledge_base_search)(
                {'query': 'q', 'kb_id': self.parent.id, 'include_children': True},
                self.ctx(None, kb_scope=(self.parent.id,))))
        self.assertEqual(fake.call_count, 0)
        self.assertNotIn('searched', out)

    def test_a_kb_bound_inside_the_files_is_usable_by_id_without_being_selected(self):
        # The selection names only the parent; the child is bound inside the
        # files this run reads, so the scope rule admits it by id.
        scope = _scope(self.user, self.research, write=False)
        ctx = self.ctx(scope, kb_scope=(self.parent.id,))
        inside = async_to_sync(knowledge_base_search)(
            {'query': 'q', 'kb_id': self.child.id}, ctx)
        self.assertNotIn('may search', inside)
        # The sibling is bound outside the files and is not selected: refused,
        # with the same words an unknown id gets.
        outside = async_to_sync(knowledge_base_search)(
            {'query': 'q', 'kb_id': self.sibling.id}, ctx)
        self.assertIn('is not one this agent may search', outside)

    def test_keyword_search_passes_the_keyword_mode_to_each_kb(self):
        fake = self._fake({self.parent.id: [{'retrieval': 'keyword', 'document_id': 1, 'score': 1.0, 'content': 'p'}]})
        with mock.patch('chat.tools.knowledge._search_one', fake):
            out = json.loads(async_to_sync(keyword_search)(
                {'query': 'INV-42', 'kb_id': self.parent.id, 'include_children': True},
                self.ctx(None, kb_scope=None)))
        modes = {call.args[3] for call in fake.call_args_list}
        self.assertEqual(modes, {'keyword'})
        self.assertEqual(out['results'][0]['kb_id'], self.parent.id)

    def test_a_kb_that_cannot_answer_the_mode_is_named_as_skipped(self):
        fake = self._fake({self.parent.id: [{'retrieval': 'keyword', 'document_id': 1, 'score': 1.0, 'content': 'p'}]})
        with mock.patch('chat.tools.knowledge._search_one', fake):
            out = json.loads(async_to_sync(keyword_search)(
                {'query': 'x', 'kb_id': self.parent.id, 'include_children': True},
                self.ctx(None, kb_scope=None)))
        self.assertEqual(out['skipped'], ['Q3 index'])


class ListShowsTheTreeTests(_Base):
    def test_the_list_gives_each_kb_its_folder_and_its_children(self):
        q3 = fs.create_folder(self.user, 'Q3', self.research)
        parent = KnowledgeBase.objects.create(
            user=self.user, name='Research index', backend='hybrid', folder=self.research)
        child = KnowledgeBase.objects.create(
            user=self.user, name='Q3 index', backend='hybrid', folder=q3)
        KnowledgeBase.objects.create(
            user=self.user, name='Other index', backend='hybrid', folder=self.other)
        scope = _scope(self.user, self.research, write=False)
        out = json.loads(async_to_sync(list_knowledge_bases)(
            {}, self.ctx(scope, kb_scope=(parent.id,))))
        rows = {row['id']: row for row in out['knowledge_bases']}
        self.assertEqual(set(rows), {parent.id, child.id})  # the child is reached by the files
        self.assertEqual(rows[parent.id]['folder_path'], '/Research')
        self.assertEqual(rows[child.id]['folder_path'], '/Research/Q3')
        self.assertEqual([c['id'] for c in rows[parent.id]['child_kbs']], [child.id])
        self.assertEqual(rows[child.id]['child_kbs'], [])


class ApprovalTests(TestCase):
    """Writes ask in `ask`, `review` and `auto`, and run unasked only in `full`."""

    def _toolbox(self, **grants):
        from agents.config import TOOL_KEYS

        full = {k: bool(grants.get(k, False)) for k in TOOL_KEYS}
        # A writable stand-in: the toolbox only asks whether the scope is writable.
        return AgentToolbox(grants=full, user_id=1,
                            file_scope=SimpleNamespace(writable=True), read_only=False)

    def test_the_grant_names_exactly_the_two_tools(self):
        self.assertEqual(GRANT_TOOLS['kbWrite'], KB_TOOLS)
        from agents.config import TOOL_KEYS

        self.assertIn('kbWrite', TOOL_KEYS)

    def test_both_tools_are_sensitive_and_irreversible(self):
        for name in KB_TOOLS:
            tool = registry_get(name)
            self.assertIsNotNone(tool, name)
            self.assertTrue(tool.sensitive, name)
            self.assertEqual(tool.effect, 'irreversible', name)
            self.assertIn(name, names_with_effect('irreversible'))

    def test_ask_auto_and_review_gate_them(self):
        box = self._toolbox(kbWrite=True)
        for level in ('ask', 'review', 'auto'):
            gated = sensitive_tools_for(level, box)
            for name in KB_TOOLS:
                self.assertIn(name, gated, f'{level} must ask before {name}')

    def test_full_gates_nothing_and_its_policy_never_asks(self):
        box = self._toolbox(kbWrite=True)
        self.assertEqual(sensitive_tools_for('full', box), frozenset())
        self.assertIs(approval_policy_for('full'), permissions.never)

    def test_auto_asks_without_consulting_the_judge_even_if_it_would_allow(self):
        # The real judge, with a script that would allow: the rule must
        # decide first, so the model is never asked.
        with scripted_model(text('ALLOW looks fine')) as model:
            verdict = async_to_sync(reviewer.review)(
                tool_name='add_to_knowledge_base',
                args={'kb_id': 3, 'title': 'Plan', 'text': 'x'},
                described='Add a document to a knowledge base',
            )
        self.assertFalse(verdict['allow'])
        self.assertEqual(verdict['reviewed_by'], 'rules')
        self.assertEqual(model.requests, [])

    def test_the_auto_policy_asks_for_a_kb_write(self):
        policy = reviewer.auto_policy(user_text='save the findings to the research KB')
        with scripted_model(text('ALLOW ok')) as model:
            asked = async_to_sync(policy)(
                'create_knowledge_base', {'name': 'R', 'folder_path': 'Research'},
                {'user_id': 1, 'session_id': 's'})
        self.assertTrue(asked)
        self.assertEqual(model.requests, [])

    def test_full_auto_runs_a_kb_write_unasked(self):
        policy = reviewer.full_policy(reviewer.auto_policy(user_text='save it'))
        asked = async_to_sync(policy)(
            'add_to_knowledge_base', {'kb_id': 3, 'title': 'P', 'text': 'x'},
            {'user_id': 1, 'session_id': 's'})
        self.assertFalse(asked)

    def test_the_approval_card_reads_as_the_action(self):
        from chat.tools.describe import describe_call

        sentence = describe_call('add_to_knowledge_base', {'kb_id': 1})['sentence']
        self.assertIn('Add a document to a knowledge base', sentence)

    def test_chat_is_never_offered_either_tool(self):
        from chat.tools import chat_orchestrator_allowed

        for name in KB_TOOLS:
            self.assertFalse(chat_orchestrator_allowed(name), name)


class KbWriteNeedsAWritableScopeTests(SimpleTestCase):
    """The KB writes are offered only to a run that has a writable file scope.

    They save into a folder of the scope (`kb_folders.write_parts`), so a run
    with no scope, or one that can only read, would be offered tools that can
    only refuse. They are withheld the way the office tools are withheld.
    """

    def _names(self, file_scope, **grants):
        from agents.config import TOOL_KEYS

        full = {k: bool(grants.get(k, False)) for k in TOOL_KEYS}
        box = AgentToolbox(grants=full, user_id=1, file_scope=file_scope)
        return box.allowed_names

    def test_a_writable_scope_offers_both_kb_writes(self):
        names = self._names(SimpleNamespace(writable=True), kbWrite=True)
        self.assertTrue(set(KB_TOOLS) <= names)

    def test_no_file_scope_withholds_both_kb_writes(self):
        names = self._names(None, kbWrite=True)
        self.assertFalse(set(KB_TOOLS) & names)

    def test_a_read_only_scope_withholds_both_kb_writes(self):
        names = self._names(SimpleNamespace(writable=False), kbWrite=True)
        self.assertFalse(set(KB_TOOLS) & names)

    def test_without_the_grant_the_kb_writes_are_never_offered(self):
        names = self._names(SimpleNamespace(writable=True))
        self.assertFalse(set(KB_TOOLS) & names)


class KbWriteGrantReachesFilesTests(TransactionTestCase):
    """A run with only `kbWrite` still gets a file scope, so its writes have a home."""

    def test_the_kb_write_grant_alone_builds_a_writable_scope(self):
        from agents.models import SubAgent

        user = get_user_model().objects.create_user(
            username='kbonly', email='kb@example.test', password='x')
        agent = SubAgent(
            user=user, name='Curator', prompt='Keep the KB current.',
            tool_grants={'kbWrite': True},
            # `full` needs no home folder, so the test writes nothing else.
            sandbox={'fileAccess': 'full'},
        )
        scope = async_to_sync(build_file_scope)(agent, user)
        self.assertIsNotNone(scope)
        self.assertTrue(scope.writable)
