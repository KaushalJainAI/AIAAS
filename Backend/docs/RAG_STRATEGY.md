# RAG: how retrieval works in AIAAS

Retrieval-Augmented Generation here is tool-driven: the model searches a
knowledge base when it decides it needs to, rather than every message
injecting chunks. `knowledge_base_search` (semantic), `keyword_search`
(exact) and `list_documents` / `read_document` (raw) are the surface; the
user-facing contract is "your files are searchable", not "relevant context
appears".

## Retrieval backends

A `KnowledgeBase` is a container; its `backend` field picks the machinery
that ingestion and search mean for it. The backends live in
`inference/backends/` behind one interface (`ingest` / `search` /
`remove_document`), so consumers — chat tools, views, the extraction
engine — never learn which one ran.

| Backend | Ingestion | Search | Choose when |
|---------|-----------|--------|-------------|
| `vector` | chunk + embed → FAISS HNSW | semantic cosine similarity | prose, "what is this about" questions |
| `fulltext` | chunk only, no embeddings; terms go into an inverted index (`IndexedTerm`) | exact + prefix keyword matching, quoted phrases, BM25-flavoured ranking | IDs, invoice numbers, code identifiers, exact names |
| `raw` | extract text, store whole — nothing indexed (`Document.status='stored'`) | none: agent browses with `list_documents`, reads with `read_document` | contracts, short references, anything better read whole than as fragments |
| `hybrid` | both indexes maintained | both searched in parallel, merged by reciprocal-rank fusion | corpora where meaning and exact strings both matter |

Design decisions worth knowing:

- **The keyword index is ours, not Postgres FTS / SQLite FTS5.** Dev runs
  SQLite and prod runs PostgreSQL. A posting table behaves identically on
  both and keeps matching local: case-insensitive whole terms, prefix
  expansion for terms ≥ 3 chars (bounded; postings scan capped at 20k rows),
  expanded matches weighted at half strength so a literal hit always outranks
  a "starts with".
- **Ranking leads with distinct-terms-matched**, then an idf-weighted tf sum.
  Quoted phrases are verified verbatim against chunk text after ranking; an
  all-phrases query falls back to a substring scan over the KB's chunks.
- **Misrouting is advice, not error.** Point semantic search at a raw KB
  and the model is told how to read instead of failing; point keyword search
  at a vector KB and it is told which tool works there.
- **Deletion fans out through every backend** (`tasks.remove_document_from_kb`),
  so no backend can leak state when a document goes away.

## Ingestion

Files arrive via chat upload (`chat/views.py`) or the library/Inference API:

1. Text is extracted; an `inference.Document` is created and queued on the
   bounded indexing queue (`inference/indexing.py`, `INDEXING_CONCURRENCY` at
   a time). `inference.tasks.process_document` runs the target KB's ingest
   backends.
2. Vector/hybrid: chunk (~500 chars) + embed → FAISS HNSW, persisted per KB
   and synced to S3 (`inference/engine.py`). Fulltext: chunks + inverted
   index. Raw: text stored alone.
3. The extraction engine (`inference/extraction.py`) shares this ingestion
   lifecycle: it reads the same `Document` rows and one LLM call per document
   fills a schema.

The `Document` owns the bytes; a chat attachment points at the same file, so
an upload is stored once and counts once against the storage quota. Deleting
the message removes file, index entry and `Document` row; deleting a session
purges every attachment's rows too.

## Knowledge bases

`KnowledgeBase` has no HTTP create or delete. The API lists a user's knowledge
bases (`GET knowledge-bases/`) and changes only their sharing. A user has an
auto-created Default KB; KBs can be shared read-only with an organisation (see
`SAFETY_AND_GUARDRAILS.md`, team knowledge bases). Agents scope their KB
access via `agent_context['knowledgeBases']`, enforced in every KB tool
(see `CONTEXT_LIFECYCLE.md`, acquisition).

## File support

Reading uploads (PDF, PPTX, DOCX, XLSX, text formats, images via a vision
model) is covered in `CONTEXT_AND_ATTACHMENTS.md`. Small text files ride in
the context directly; large files and corpora go through the KB routes
above.
