# Performance, Caching, and Query Optimization

## Core Lesson

Do not guess that "the database is slow." Measure the slow path first:
request timing, SQL count, query duration, payload size, frontend waterfalls, and model/RAG startup time.

In this project, slowness can come from several places:

- Large list endpoints returning everything at once
- Offset pagination on growing execution/audit tables
- Serializing heavy JSON/text fields in list views
- Repeated frontend fetches from `useEffect`
- Rebuilding or rechecking local AI models
- Synchronous document indexing or embedding work

## Cursor Pagination Beats Offset

Offset pagination looks simple:

```sql
ORDER BY created_at DESC LIMIT 50 OFFSET 50000
```

The problem is that the database still has to walk past many rows before it can return the next page. It gets slower as the table grows.

Keyset pagination uses the last row from the previous page:

```sql
WHERE (created_at < :last_created_at)
   OR (created_at = :last_created_at AND id < :last_id)
ORDER BY created_at DESC, id DESC
LIMIT 51
```

Why the extra `id` matters:

- Many rows can share the same timestamp
- `created_at + id` gives deterministic ordering
- Page boundaries do not duplicate or skip rows

Good indexes for this pattern:

- `user, -created_at, -id` for execution/audit/document history
- `workflow, -created_at, -id` for workflow-specific execution logs
- `user, -updated_at, -id` for workflow lists

## React Query vs `useEffect`

Use React Query for server state:

- Lists: workflows, documents, logs, templates
- Detail records fetched from APIs
- Metadata that can be cached and invalidated
- Infinite/cursor pagination with `useInfiniteQuery`

React Query gives request deduplication, caching, stale-time control, retries, refetching, and targeted invalidation.

Use `useEffect` for non-server-state effects:

- WebSocket lifecycle
- DOM events
- Timers
- Local storage sync
- Imperative UI integrations

Rule of thumb: if the effect exists mainly to `fetch()` and put data in state, it probably belongs in React Query.

## What To Cache

Cache high-read, low-change data:

- Node schemas and node type registries
- AI provider/model option lists
- MCP tool lists
- Credential type metadata
- Template categories
- User profile/session bootstrap data

Be careful with:

- User secrets
- Permission-sensitive data
- Large mutable workflow JSON
- Documents and RAG content that need explicit invalidation

Local development may use Django's default process-local cache, but production-style multi-worker setups need Redis or another shared cache. Otherwise each process has its own cache and warmups are duplicated.

## Payload Size Matters

List endpoints should not serialize detail-only fields. In this repo:

- Workflow lists should avoid full `nodes`, `edges`, `viewport`, and settings payloads
- Document lists should avoid full extracted `content_text`
- Execution lists should avoid full input/output node logs
- Detail endpoints should remain unchanged and return the full object

This preserves functionality while reducing the first-screen payload.

## RAG and Model Startup

The embedding model should be loaded once per process and from the local cache when available. Avoid online Hugging Face metadata checks on every startup after the model is cached.

For document indexing:

- Do extraction/indexing outside request-response
- Batch embeddings
- Keep FAISS indexes loaded through a process-level manager
- Reindex only when the embedding model or chunking strategy changes

## Interview Answer

"I would not start by blaming the database. I would measure request timing, query count, SQL duration, payload size, and frontend waterfalls. For large append-only history tables I would replace offset pagination with keyset pagination using `created_at + id`, add matching composite indexes, and expose opaque cursors. On the frontend I would use React Query's `useInfiniteQuery` so batches are cached and deduplicated. I would keep full detail endpoints unchanged, but make list endpoints return compact summaries."
