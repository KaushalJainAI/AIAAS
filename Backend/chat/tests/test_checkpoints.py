"""
Phase 2 (`docs/CONCURRENCY_LAG_FIX_PLAN.md`): the Postgres saver must resolve
a DSN from whatever the deploy configures.

`_dsn_from_django_db` derives the checkpointer's DSN from Django's own default
database, which is what guarantees the saver cannot land on a different
host/database from the rows that name its threads. The saver itself is tested
at the bottom of this file against a real Postgres, when one is configured.
"""
from __future__ import annotations

from django.test import SimpleTestCase
from django.test.utils import override_settings

from chat.turn.checkpoints import _dsn_from_django_db


class DsnFromDjangoDbTests(SimpleTestCase):
    def test_sqlite_yields_no_dsn(self):
        """Dev SQLite: nothing to derive, so the explicit-DSN error stands."""
        self.assertEqual(_dsn_from_django_db(), '')

    @override_settings(DATABASES={
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': 'aiaas',
            'USER': 'postgres',
            'PASSWORD': 'p@ss:word/db',
            'HOST': 'db',
            'PORT': '5432',
        }
    })
    def test_postgres_db_yields_quoted_dsn(self):
        self.assertEqual(
            _dsn_from_django_db(),
            'postgresql://postgres:p%40ss%3Aword%2Fdb@db:5432/aiaas',
        )

    @override_settings(DATABASES={
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': 'aiaas',
            'USER': '',
            'PASSWORD': '',
            'HOST': '',
            'PORT': '',
        }
    })
    def test_missing_host_and_auth_fall_back(self):
        self.assertEqual(
            _dsn_from_django_db(), 'postgresql://localhost:5432/aiaas',
        )

    @override_settings(DATABASES={'default': {'ENGINE': 'x', 'NAME': ''}})
    def test_no_name_yields_no_dsn(self):
        self.assertEqual(_dsn_from_django_db(), '')


# ── The saver itself, against a real Postgres ────────────────────────────────
#
# Switched on in production on 2026-10-01, the library saver failed every turn:
# nothing opened its pool (`PoolClosed`), nothing created its tables, and its
# process-wide lock would have queued every run behind every other anyway.
# None of that is visible without a server, so these run against one:
#
#   docker run -d --name cp-test -e POSTGRES_PASSWORD=pw -p 55432:5432 postgres:16-alpine
#   AGENT_CHECKPOINT_TEST_DSN=postgresql://postgres:pw@localhost:55432/postgres \
#       pytest chat/tests/test_checkpoints.py
#
# Each test gets its own throwaway database, so "fresh install" is real.

import asyncio  # noqa: E402
import os  # noqa: E402
import time  # noqa: E402
import unittest  # noqa: E402
import uuid  # noqa: E402

TEST_DSN = os.environ.get('AGENT_CHECKPOINT_TEST_DSN', '')


@unittest.skipUnless(TEST_DSN, 'set AGENT_CHECKPOINT_TEST_DSN to a Postgres server')
class PooledPostgresSaverTests(SimpleTestCase):
    def setUp(self):
        import psycopg

        self.db_name = f'cp_test_{uuid.uuid4().hex[:12]}'
        with psycopg.connect(TEST_DSN, autocommit=True) as conn:
            conn.execute(f'CREATE DATABASE {self.db_name}')
        base, _, _ = TEST_DSN.rpartition('/')
        self.dsn = f'{base}/{self.db_name}'

    def tearDown(self):
        import psycopg

        with psycopg.connect(TEST_DSN, autocommit=True) as conn:
            conn.execute(f'DROP DATABASE IF EXISTS {self.db_name} WITH (FORCE)')

    def _run(self, coro_fn):
        """Build the saver inside the loop, as the graph does, and close it."""
        async def main():
            from chat.turn import checkpoints

            with override_settings(AGENT_CHECKPOINT_DSN=self.dsn):
                saver = checkpoints._postgres()
            try:
                return await coro_fn(saver)
            finally:
                await saver.conn.close()
        return asyncio.run(main())

    @staticmethod
    def _cfg(thread_id):
        return {'configurable': {'thread_id': thread_id, 'checkpoint_ns': ''}}

    @staticmethod
    async def _put(saver, thread_id):
        from langgraph.checkpoint.base import empty_checkpoint

        cp = empty_checkpoint()
        await saver.aput(PooledPostgresSaverTests._cfg(thread_id), cp,
                         {'source': 'input', 'step': -1, 'parents': {}}, {})
        return cp

    def test_first_use_works_with_no_setup_call(self):
        """The production failure: first `aput` on a fresh database."""
        async def body(saver):
            cp = await self._put(saver, 't1')
            got = await saver.aget_tuple(self._cfg('t1'))
            return got.checkpoint['id'] == cp['id']

        self.assertTrue(self._run(body))

    def test_concurrent_first_uses_migrate_once(self):
        """Ten turns arriving together on a fresh install all succeed, and the
        migrations are recorded exactly once each."""
        async def body(saver):
            await asyncio.gather(*(self._put(saver, f't{i}') for i in range(10)))
            async with saver._pool_cursor() as cur:
                rows = await (await cur.execute(
                    'SELECT count(*) AS n, count(DISTINCT v) AS d FROM checkpoint_migrations'
                )).fetchone()
            return rows, len(saver.MIGRATIONS)

        rows, expected = self._run(body)
        self.assertEqual(rows['n'], expected)
        self.assertEqual(rows['d'], expected)

    def test_queries_run_in_parallel_up_to_the_pool(self):
        """No process-wide lock: four slow queries overlap on a pool of four.

        With the library's lock they would take 4 x 0.3 s one after another.
        """
        async def body(saver):
            await saver.setup()

            async def slow():
                async with saver._cursor() as cur:
                    await cur.execute('SELECT pg_sleep(0.3)')

            started = time.monotonic()
            await asyncio.gather(*(slow() for _ in range(4)))
            return time.monotonic() - started

        self.assertLess(self._run(body), 0.9)

    def test_delete_thread_and_list(self):
        async def body(saver):
            await self._put(saver, 'keep')
            await self._put(saver, 'drop')
            await saver.adelete_thread('drop')
            kept = [c async for c in saver.alist(self._cfg('keep'))]
            dropped = [c async for c in saver.alist(self._cfg('drop'))]
            return len(kept), len(dropped)

        self.assertEqual(self._run(body), (1, 0))
