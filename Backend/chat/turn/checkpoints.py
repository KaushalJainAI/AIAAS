"""
Where a run's state lives, and whether it survives the process.

`MemorySaver` keeps every super-step in a dict. That is fine for a chat turn,
which is over in seconds, and wrong for the thing this platform is trying to
be: an agent run may go forty iterations across two hours, and with an
in-process saver a deploy, a crash or an `ASGI` restart loses all of it with no
way back. The run is a detached task (`background.spawn`), so nothing even
notices — the `ExecutionLog` row simply stays `running` for ever, and the user
watches a spinner attached to nothing.

**One door, selected by setting**, the same shape `sandbox/engine.py` uses and
for the same reason: two ways to store state is two behaviours to reason about
in an incident.

    memory   — in-process, no durability. The default in tests, where a
               file-backed saver would mean writing a database per test.
    sqlite   — a file beside `db.sqlite3`. The dev default: real durability
               with nothing to run.
    postgres — for a deployment where the app has more than one process or a
               container that gets replaced.

Deliberately **not** the Django connection. The checkpointer writes on every
super-step of every run, from detached tasks that outlive their request, and
sharing Django's pool would put that traffic behind the same connections
serving HTTP — where `CONN_MAX_AGE`, PgBouncer's transaction pooling and
Django's own `close_old_connections` all apply to a writer that has none of a
request's lifecycle. Its own pool is the boring choice.

There is no automatic fallback between backends. A configured `postgres` saver
that cannot connect raises at startup rather than quietly degrading to
`memory`, because "durable" that silently is not is worse than never having
claimed it: the resume sweep would find rows to resume and no state to resume
them from.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

from django.conf import settings

logger = logging.getLogger(__name__)

#: What was actually built, for the health endpoint and for tests that need to
#: skip when the backend is not durable.
active_backend: str = 'memory'


def _configured() -> str:
    """The backend this deployment asked for, normalised."""
    raw = getattr(settings, 'AGENT_CHECKPOINTER', '') or ''
    choice = str(raw).strip().lower()
    if choice in ('memory', 'sqlite', 'postgres'):
        return choice
    if choice:
        logger.warning('[Checkpoints] Unknown AGENT_CHECKPOINTER %r; using memory', raw)
    return 'memory'


def build():
    """The checkpointer this process will use. Called once, at graph build.

    Returns a saver whose `aput`/`aget_tuple` the graph drives. Every backend
    here is opened *without* a context manager on purpose: the saver has to
    outlive the function that made it and live as long as the process, which is
    exactly the lifetime of the compiled graph it is handed to.
    """
    global active_backend

    choice = _configured()
    if choice == 'memory':
        active_backend = 'memory'
        return _memory()

    if choice == 'sqlite':
        try:
            saver = _sqlite()
        except Exception:
            # Dev-only backend, and the failure is almost always a missing
            # optional package. Degrading here is safe *because* the resume
            # sweep asks `is_durable()` rather than assuming: it will report
            # that it cannot resume instead of finding rows with no state.
            logger.exception(
                '[Checkpoints] SQLite checkpointer unavailable; '
                'runs will not survive a restart'
            )
            active_backend = 'memory'
            return _memory()
        active_backend = 'sqlite'
        return saver

    # Postgres is the production choice, so a failure here is *not* swallowed.
    saver = _postgres()
    active_backend = 'postgres'
    return saver


def _memory():
    from langgraph.checkpoint.memory import MemorySaver

    return MemorySaver()


def _sqlite():
    """A file-backed saver beside the dev database.

    Its own file rather than `db.sqlite3`: checkpoint traffic is write-heavy
    and would take SQLite's single write lock on the application database on
    every super-step of every run, which is how a background agent starts
    blocking page loads.
    """
    from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
    import aiosqlite

    path = Path(
        getattr(settings, 'AGENT_CHECKPOINT_PATH', '')
        or Path(settings.BASE_DIR) / 'checkpoints.sqlite3'
    )
    path.parent.mkdir(parents=True, exist_ok=True)

    conn = aiosqlite.connect(str(path), check_same_thread=False)
    saver = AsyncSqliteSaver(conn)
    logger.info('[Checkpoints] SQLite checkpointer at %s', path)
    return saver


#: How long the first use waits for the pool's first connection before failing.
POOL_OPEN_TIMEOUT = 30.0


def _pooled_saver_class():
    """`AsyncPostgresSaver` made usable with a pool it has to open itself.

    Built lazily so importing this module never imports the postgres extra.
    The library saver has two gaps here, and both were found by switching it on
    in production (2026-10-01), where every turn failed at once:

    - **Nothing opens the pool.** It is built with `open=False` because opening
      needs a running loop and the graph is compiled from sync code, and the
      saver never opens it itself, so the first query raised `PoolClosed`.
      Here the first query opens it, inside the loop that will use it.
    - **Nothing creates the tables.** `setup()` "MUST be called directly by the
      user", and only the recovery sweep did, which returns early when there is
      nothing to recover. Here the first query runs the migrations, once, under
      a lock, so concurrent first turns cannot race them.

    And one that made the switch pointless: `_cursor` holds a **process-wide
    `asyncio.Lock`** around every query. That lock exists for a single shared
    connection, which one coroutine at a time may use. A pool hands each borrow
    its own connection, so here the lock is dropped and runs checkpoint in
    parallel, up to the pool size — the whole reason for leaving SQLite, whose
    one lock queued every run behind every other.

    `_cursor` is private API. `langgraph-checkpoint-postgres` is pinned exactly
    in requirements, and `chat/tests/test_checkpoints.py` drives this against a
    real Postgres when one is configured, so an upgrade that changes it fails a
    test rather than production.
    """
    import asyncio
    from contextlib import asynccontextmanager

    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
    from psycopg.rows import dict_row

    class PooledPostgresSaver(AsyncPostgresSaver):
        def __init__(self, pool, **kwargs):
            super().__init__(pool, **kwargs)
            self._ready = False
            self._ready_lock = asyncio.Lock()

        async def setup(self) -> None:
            await self._ensure_ready()

        async def _ensure_ready(self) -> None:
            if self._ready:
                return
            async with self._ready_lock:
                if self._ready:
                    return
                await self.conn.open(wait=True, timeout=POOL_OPEN_TIMEOUT)
                await self._migrate()
                self._ready = True
                logger.info('[Checkpoints] Postgres checkpointer ready')

        async def _migrate(self) -> None:
            # The library's own `setup()` body, over the unlocked cursor.
            async with self._pool_cursor() as cur:
                await cur.execute(self.MIGRATIONS[0])
                results = await cur.execute(
                    'SELECT v FROM checkpoint_migrations ORDER BY v DESC LIMIT 1'
                )
                row = await results.fetchone()
                version = -1 if row is None else row['v']
                for v, migration in zip(
                    range(version + 1, len(self.MIGRATIONS)),
                    self.MIGRATIONS[version + 1:],
                ):
                    await cur.execute(migration)
                    await cur.execute(
                        'INSERT INTO checkpoint_migrations (v) VALUES (%s)', (v,)
                    )

        @asynccontextmanager
        async def _cursor(self, *, pipeline: bool = False):
            await self._ensure_ready()
            async with self._pool_cursor(pipeline=pipeline) as cur:
                yield cur

        @asynccontextmanager
        async def _pool_cursor(self, *, pipeline: bool = False):
            async with self.conn.connection() as conn:
                if pipeline and self.supports_pipeline:
                    async with conn.pipeline(), conn.cursor(
                        binary=True, row_factory=dict_row
                    ) as cur:
                        yield cur
                elif pipeline:
                    async with conn.transaction(), conn.cursor(
                        binary=True, row_factory=dict_row
                    ) as cur:
                        yield cur
                else:
                    async with conn.cursor(binary=True, row_factory=dict_row) as cur:
                        yield cur

    return PooledPostgresSaver


def _postgres():
    from psycopg_pool import AsyncConnectionPool

    dsn = (
        getattr(settings, 'AGENT_CHECKPOINT_DSN', '')
        or getattr(settings, 'DATABASE_URL', '')
        or _dsn_from_django_db()
    )
    if not dsn:
        raise RuntimeError(
            'AGENT_CHECKPOINTER=postgres needs AGENT_CHECKPOINT_DSN (or '
            'DATABASE_URL). Refusing to start rather than silently losing runs.'
        )

    # Small on purpose (G2 pool math): the app pool holds up to
    # `DB_POOL_MAX_SIZE` (16 in prod) and the server allows `max_connections`
    # (40), with room needed for psql and migrations — so the saver gets 4.
    # Overridable per deploy, but raise it and the sum must still fit.
    max_size = int(os.environ.get('AGENT_CHECKPOINT_POOL_MAX', '4'))
    # `open=False`: opening a pool needs a running loop, and this is called
    # while the graph is compiled. `PooledPostgresSaver` opens it on first use.
    # `check` tests a connection before handing it out, so a Postgres restart
    # (a deploy recreates `db`) costs one reconnect, not a failed turn.
    pool = AsyncConnectionPool(conninfo=dsn, min_size=1, max_size=max_size,
                               open=False,
                               check=AsyncConnectionPool.check_connection,
                               kwargs={'autocommit': True, 'prepare_threshold': 0})
    saver = _pooled_saver_class()(pool)
    logger.info('[Checkpoints] Postgres checkpointer configured (pool max=%d)', max_size)
    return saver


def _dsn_from_django_db() -> str:
    """A libpq DSN for Django's own default database, when it is Postgres.

    The checkpointer must live on the app's database — deriving it here means
    the saver cannot drift onto a different host/port/database from the rows
    (`ExecutionLog.thread_id`) that name its threads, whatever combination of
    `DATABASE_URL` / `DB_*` vars the deploy uses.
    """
    try:
        from urllib.parse import quote

        db = settings.DATABASES.get('default', {})
    except Exception:  # noqa: BLE001 — settings not ready means "no DSN"
        return ''
    if db.get('ENGINE') != 'django.db.backends.postgresql':
        return ''
    if not db.get('NAME'):
        return ''
    user = quote(str(db.get('USER') or ''), safe='')
    password = quote(str(db.get('PASSWORD') or ''), safe='')
    host = db.get('HOST') or 'localhost'
    port = db.get('PORT') or '5432'
    auth = f'{user}:{password}@' if user else ''
    return f'postgresql://{auth}{host}:{port}/{db["NAME"]}'


def is_durable() -> bool:
    """Whether a run's state would survive this process going away.

    Asked rather than assumed by anything that promises persistence — the
    resume sweep above all, which must say "I cannot resume these" rather than
    look for state that was never written.

    This is a question about *configuration*, answered from what was asked
    for rather than from `active_backend`: the sweep and the management
    command check durability *before* anything builds the graph, and in
    their process `active_backend` is still its initial `'memory'` — so
    reading it here reported a sqlite deployment as non-durable and had
    the sweep close runs it could have resumed.
    """
    return _configured() != 'memory'


async def setup(saver) -> None:
    """Create the backend's tables, if it has any. Idempotent.

    Both file-backed savers need a one-time schema. `AsyncSqliteSaver` calls
    this itself before its first write — and, importantly, it is also what
    starts the `aiosqlite` connection, which `build()` cannot do because
    connecting is a coroutine and the graph is compiled from sync code. So the
    ordering is: construct unconnected here, connect on first real use.

    Called explicitly by the recovery sweep and the management command, both of
    which *read* state before anything has written any — without it they would
    query a database with no tables and conclude, wrongly, that no run has
    state worth resuming.
    """
    setup_fn = getattr(saver, 'setup', None)
    if setup_fn is None:
        return
    try:
        result = setup_fn()
        if hasattr(result, '__await__'):
            await result
    except Exception:  # noqa: BLE001
        logger.warning('[Checkpoints] Backend setup failed', exc_info=True)
