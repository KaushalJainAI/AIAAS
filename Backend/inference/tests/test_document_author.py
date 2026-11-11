"""Who wrote a file: `Document.metadata['author']` (UI redesign B8).

The file tools stamp the author through the scope they were handed, so the
property to defend is that an agent's or the chat's writes are labelled, a
person's edits never erase an existing label, and nothing un-attributed gets
one. Each test pins one of those, and the serializer test pins what the API
exposes.
"""
from __future__ import annotations

from types import SimpleNamespace

from django.contrib.auth import get_user_model
from django.test import TestCase

from inference import vfs
from inference.models import Document
from inference.office_edit import save_text
from inference.serializers import DocumentListSerializer, DocumentSerializer
from workflow_backend.thresholds import AGENT_HOME_ROOT

User = get_user_model()

SVG = b'<svg xmlns="http://www.w3.org/2000/svg"/>'

#: A read-all, write-own scope writes only under its own home, and resolves a
#: relative path from the tree root, so every write path here is absolute.
ANALYST_HOME = f'/{AGENT_HOME_ROOT}/Analyst'
REPORTER_HOME = f'/{AGENT_HOME_ROOT}/Reporter'
PLAIN_HOME = f'/{AGENT_HOME_ROOT}/Plain'
CHAT_FOLDER = f'/{vfs.CHAT_HOME_ROOT}'


class AuthorTestCase(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('owner', 'owner@example.com', 'pw')
        self.analyst = SimpleNamespace(id=7, name='Analyst')
        self.reporter = SimpleNamespace(id=9, name='Reporter')

    def agent_scope(self, agent=None, execution_id='exec-1'):
        agent = agent or self.analyst
        return vfs.build_scope(
            self.user, vfs.READ_ALL_WRITE_OWN, agent_name=agent.name,
            author=vfs.agent_author(agent, execution_id),
        )

    def chat_scope(self):
        return vfs.chat_scope(self.user)

    def author_of(self, document_id):
        return Document.objects.get(pk=document_id).metadata.get('author')


class CreateStampsTests(AuthorTestCase):
    def test_agent_create_is_stamped_with_agent_and_run(self):
        result = vfs.write_file(self.agent_scope(), f'{ANALYST_HOME}/findings.md', '# Findings')
        self.assertEqual(self.author_of(result['document_id']), {
            'kind': 'agent', 'name': 'Analyst', 'agent_id': 7, 'execution_id': 'exec-1',
        })

    def test_chat_create_is_stamped_as_the_lead(self):
        result = vfs.write_file(self.chat_scope(), f'{CHAT_FOLDER}/summary.md', 'summary')
        self.assertEqual(self.author_of(result['document_id']), {
            'kind': 'chat', 'name': 'Lead', 'agent_id': None, 'execution_id': None,
        })

    def test_unattributed_scope_writes_no_author(self):
        scope = vfs.build_scope(self.user, vfs.READ_ALL_WRITE_OWN, agent_name='Plain')
        result = vfs.write_file(scope, f'{PLAIN_HOME}/plain.md', 'no author here')
        self.assertNotIn('author', Document.objects.get(pk=result['document_id']).metadata)

    def test_binary_create_is_stamped(self):
        result = vfs.write_binary(self.agent_scope(), f'{ANALYST_HOME}/diagram.svg', SVG, text='diagram')
        self.assertEqual(self.author_of(result['document_id'])['name'], 'Analyst')

    def test_agent_name_falls_back_when_blank(self):
        nameless = SimpleNamespace(id=3, name='  ')
        self.assertEqual(vfs.agent_author(nameless, 'x')['name'], 'Agent')


class OverwriteStampsTests(AuthorTestCase):
    def test_agent_overwrite_names_the_last_writer(self):
        first = vfs.write_file(self.agent_scope(self.analyst, 'exec-a'), f'{ANALYST_HOME}/shared.md', 'one')
        vfs.write_file(self.agent_scope(self.analyst, 'exec-b'), f'{ANALYST_HOME}/shared.md', 'two')
        self.assertEqual(self.author_of(first['document_id']), {
            'kind': 'agent', 'name': 'Analyst', 'agent_id': 7, 'execution_id': 'exec-b',
        })

    def test_edit_file_stamps_the_editor(self):
        first = vfs.write_file(self.agent_scope(self.analyst, 'exec-a'), f'{ANALYST_HOME}/mine.md', 'alpha beta')
        vfs.edit_file(self.agent_scope(self.analyst, 'exec-b'), f'{ANALYST_HOME}/mine.md', 'beta', 'gamma')
        self.assertEqual(self.author_of(first['document_id']), {
            'kind': 'agent', 'name': 'Analyst', 'agent_id': 7, 'execution_id': 'exec-b',
        })

    def test_person_edit_keeps_the_agent_author(self):
        result = vfs.write_file(self.agent_scope(), f'{ANALYST_HOME}/draft.md', 'agent text')
        doc = Document.objects.get(pk=result['document_id'])
        # What the apps do: no author argument, so the label must survive.
        save_text(doc, 'person text', version_source='app')
        self.assertEqual(self.author_of(result['document_id'])['name'], 'Analyst')

    def test_person_upload_stays_unstamped(self):
        doc = Document.objects.create(
            user=self.user, name='upload.txt', file_type='txt', file_size=1,
            content_text='uploaded', status='stored', metadata={},
        )
        save_text(doc, 'edited by hand', version_source='app')
        self.assertNotIn('author', Document.objects.get(pk=doc.pk).metadata)


class CopyAndRestoreTests(AuthorTestCase):
    def test_copy_is_authored_by_the_copier_not_the_original(self):
        original = vfs.write_file(self.agent_scope(self.analyst), f'{ANALYST_HOME}/orig.md', 'body')
        scope = self.agent_scope(self.reporter, 'exec-r')
        result = vfs.copy(scope, f'{ANALYST_HOME}/orig.md', f'{REPORTER_HOME}/copied.md')
        self.assertEqual(self.author_of(result['document_id'])['name'], 'Reporter')
        self.assertEqual(self.author_of(original['document_id'])['name'], 'Analyst')


class SerializerTests(AuthorTestCase):
    def test_agent_authored_file_exposes_the_author(self):
        result = vfs.write_file(self.agent_scope(), f'{ANALYST_HOME}/exposed.md', 'x')
        doc = Document.objects.get(pk=result['document_id'])
        data = DocumentSerializer(doc).data
        self.assertEqual(data['author'], {
            'kind': 'agent', 'name': 'Analyst', 'agent_id': 7, 'execution_id': 'exec-1',
        })
        self.assertEqual(DocumentListSerializer(doc).data['author']['name'], 'Analyst')

    def test_unstamped_document_has_null_author(self):
        doc = Document.objects.create(user=self.user, name='old.txt', file_type='txt', file_size=1,
                                      content_text='old', status='stored', metadata={})
        self.assertIsNone(DocumentSerializer(doc).data['author'])
        self.assertIsNone(DocumentListSerializer(doc).data['author'])

    def test_malformed_stored_author_reads_as_null(self):
        doc = Document.objects.create(user=self.user, name='bad.txt', file_type='txt', file_size=1,
                                      content_text='x', status='stored',
                                      metadata={'author': {'kind': 'robot', 'secret': 'k'}})
        self.assertIsNone(DocumentSerializer(doc).data['author'])

    def test_extra_keys_are_not_echoed(self):
        doc = Document.objects.create(
            user=self.user, name='extra.txt', file_type='txt', file_size=1, content_text='x',
            status='stored',
            metadata={'author': {'kind': 'chat', 'name': 'Lead', 'agent_id': 'nope',
                                 'execution_id': None, 'leak': 'no'}})
        author = DocumentSerializer(doc).data['author']
        self.assertEqual(set(author), {'kind', 'name', 'agent_id', 'execution_id'})
        self.assertIsNone(author['agent_id'])


class ScopeWiringTests(AuthorTestCase):
    def test_author_does_not_change_scope_equality(self):
        plain = vfs.build_scope(self.user, vfs.SCOPED, agent_name='Same')
        stamped = vfs.build_scope(self.user, vfs.SCOPED, agent_name='Same',
                                  author=vfs.chat_author())
        self.assertEqual(plain, stamped)
        self.assertEqual(hash(plain), hash(stamped))

    def test_a_worker_keeps_its_own_author_when_granted_the_parents_folder(self):
        worker = vfs.build_scope(self.user, vfs.READ_ALL_WRITE_OWN, agent_name='Worker',
                                 author=vfs.agent_author(SimpleNamespace(id=2, name='Worker'), 'w1'))
        shared = vfs.with_shared_workspace(worker, ('Chat',), 'Chat')
        self.assertEqual(shared.author['name'], 'Worker')
