# Slow lists and heavy payloads: measure first, then page by keys

## What happened

Lists slowed down as their tables grew, and first screens were heavy. Three causes
were common:

- **Offset pagination on growing history tables.** `LIMIT 50 OFFSET 50000` makes the
  database walk past 50,000 rows before it returns the page.
- **Detail fields in list responses.** A list of documents carried the full
  extracted text. A list of runs carried every step.
- **Unbounded or repeated fetches.** Lists with no cap, and effects that refetched
  data on every render.

The first step was not to blame the database. Measure request time, SQL count,
query duration and payload size, then decide.

## The fix

**Keyset pagination.** Each page starts after the last row of the previous page:

```sql
WHERE (created_at < :last_created_at)
   OR (created_at = :last_created_at AND id < :last_id)
ORDER BY created_at DESC, id DESC
LIMIT 51
```

- The `id` tie-breaker matters. Many rows can share a timestamp, and without it a
  page boundary can duplicate or skip rows.
- The index must match the order: per user, `(user, -created_at, -id)`.
- The cursor is opaque to the client.
- The document and log lists use cursors (`Backend/inference/views.py`,
  `Backend/logs/queries.py`).

**Compact lists, full detail.** List endpoints return summaries. Detail endpoints
return the whole object, so nothing is lost.

**Shared cache in production.** Process-local caches duplicate every warm-up across
workers. Production uses Redis. Do not cache user secrets, permission-sensitive data
or large mutable JSON.

**Server state versus effects.** Lists and details belong in React Query. Sockets,
timers and DOM events belong in effects.

## The lesson

- **Measure before you optimise.** The slow part is often not where you guessed.
- **Keyset pagination scales with the page, not the table.** It needs a stable,
  unique sort key, so add `id` as the tie-breaker.
- **A list response is a contract about size.** Keep detail fields out of it.
- **Caches need a shared store to mean anything across workers,** and need an
  invalidation story for anything that changes.

## Code

- `Backend/inference/views.py`, `Backend/inference/folder_views.py`: cursor pagination
- `Backend/logs/queries.py`: run history queries
- `Backend/workflow_backend/thresholds.py`: list and stream caps
