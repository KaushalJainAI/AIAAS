"""
The one place a document is handed off to be extracted and embedded.

Every producer of a `Document` used to start its own thread for
`tasks.process_document` — the upload view, the chat upload, a restore from
the trash, a generated text file. A thread per file means the number of jobs
running at once is set by how many files someone selected: the file picker is
`multiple`, so two hundred files were two hundred extractions and two hundred
embedding batches inside one memory-capped container.

`submit` puts the job on a queue drained by `INDEXING_CONCURRENCY` worker
threads. Nothing about the job changes; only how many run together.

In-process on purpose, like the threads it replaces: this deployment has no
Celery broker, and a queued job that dies with the process leaves its document
`pending`, exactly as a dead thread did.
"""
from __future__ import annotations

import logging
import queue
import threading

logger = logging.getLogger(__name__)

_jobs: queue.Queue = queue.Queue()
_workers: list[threading.Thread] = []
_lock = threading.Lock()


def _concurrency() -> int:
    from workflow_backend.thresholds import INDEXING_CONCURRENCY

    return max(1, int(INDEXING_CONCURRENCY))


def _drain() -> None:
    from django.db import connections

    while True:
        fn, args = _jobs.get()
        try:
            fn(*args)
        except Exception:  # noqa: BLE001 — one bad document must not stop the queue
            logger.exception('[Indexing] Job failed: %s%r', getattr(fn, '__name__', fn), args)
        finally:
            # A worker lives for the life of the process; a connection it kept
            # would be one the pool never gets back.
            connections.close_all()
            _jobs.task_done()


def _ensure_workers() -> None:
    with _lock:
        _workers[:] = [w for w in _workers if w.is_alive()]
        while len(_workers) < _concurrency():
            worker = threading.Thread(
                target=_drain, daemon=True, name=f'indexing-{len(_workers)}')
            worker.start()
            _workers.append(worker)


def submit(fn, *args) -> None:
    """Run `fn(*args)` on the indexing workers, after the jobs ahead of it."""
    _jobs.put((fn, args))
    _ensure_workers()


def index_document(document_id, kb_id=None) -> None:
    """Queue one document for `tasks.process_document`."""
    from .tasks import process_document

    submit(process_document, document_id, kb_id)


def pending() -> int:
    """Jobs waiting or running. For tests and the health view."""
    return _jobs.unfinished_tasks


def wait(timeout: float = 30.0) -> bool:
    """Block until the queue is empty; False if `timeout` passed first."""
    import time

    deadline = time.monotonic() + timeout
    while _jobs.unfinished_tasks:
        if time.monotonic() > deadline:
            return False
        time.sleep(0.02)
    return True
