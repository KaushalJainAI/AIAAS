"""The KB document map is stored as JSON, never unpickled from S3.

The map is synced to S3 and fetched back, and unpickling a file someone else
could write is code execution. A `.pkl` this server wrote before the change
is read once, rewritten as JSON, and deleted.
"""
import pickle
import tempfile
from pathlib import Path

import numpy as np
from django.test import SimpleTestCase, override_settings

from inference.engine import EMBEDDER_VERSION, EMBEDDING_DIM, HNSWKnowledgeBase


def _kb_with_one_chunk(kb_id: int) -> HNSWKnowledgeBase:
    kb = HNSWKnowledgeBase(kb_id)
    kb._index = kb._create_fresh_index()
    embedding = np.ones(EMBEDDING_DIM, dtype='float32')
    kb._index.add(np.array([embedding], dtype='float32'))
    kb._documents = {0: {'doc_id': 7, 'content': 'hello', 'metadata': {'a': 1},
                         'embedding': embedding, 'is_image': False}}
    kb._stored_version = 'v-test'
    return kb


class IndexPersistenceTests(SimpleTestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)
        self._override = override_settings(FAISS_INDEX_DIR=self.dir)
        self._override.enable()

    def tearDown(self):
        self._override.disable()
        self._tmp.cleanup()

    def test_round_trip_is_json(self):
        _kb_with_one_chunk(1)._save_local()

        self.assertTrue((self.dir / 'kb_1_docs.json').exists())
        self.assertFalse((self.dir / 'kb_1_docs.pkl').exists())

        loaded = HNSWKnowledgeBase(1)
        self.assertTrue(loaded._load_local())
        self.assertEqual(list(loaded._documents), [0])
        self.assertEqual(loaded._documents[0]['content'], 'hello')
        self.assertEqual(len(loaded._documents[0]['embedding']), EMBEDDING_DIM)
        self.assertEqual(loaded._stored_version, EMBEDDER_VERSION)

    def test_a_legacy_local_pickle_is_migrated_and_removed(self):
        kb = _kb_with_one_chunk(2)
        kb._save_local()
        (self.dir / 'kb_2_docs.json').unlink()
        with open(self.dir / 'kb_2_docs.pkl', 'wb') as f:
            pickle.dump({'_version': 'v-old', 'documents': kb._documents}, f)

        loaded = HNSWKnowledgeBase(2)
        self.assertTrue(loaded._load_local())

        self.assertEqual(loaded._stored_version, 'v-old')
        self.assertTrue((self.dir / 'kb_2_docs.json').exists())
        self.assertFalse((self.dir / 'kb_2_docs.pkl').exists())

    def test_s3_carries_json_only(self):
        self.assertTrue(HNSWKnowledgeBase(3)._s3_docs_key.endswith('_docs.json'))
