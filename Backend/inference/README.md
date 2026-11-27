# `inference/`: your files, folders and knowledge bases

The user sees this as the Documents page: a file tree with a recycle bin, the
knowledge bases they search, the Docs, Sheets and Slides editors, shared pages,
dashboards and extraction. Despite the name, it is mostly about **your stuff**.

"Folders organise, knowledge bases index." A document has a folder *and* may
be in a knowledge base, independently. Moving a file never re-indexes it.

Design: [`docs/RAG_STRATEGY.md`](../docs/RAG_STRATEGY.md) (search). The office
library the editors save through is [`office/`](../office/README.md).

## Read in this order

1. `models.py`: `Folder`, `Document`, `KnowledgeBase`.
2. `filesystem.py`: the only way a folder id from a request becomes a `Folder`.
3. `vfs.py`: the path view the AI uses.
4. `engine.py`, `backends/`: how knowledge-base search works.

## Data (`models.py`)

| Model | What it is |
|---|---|
| `Folder` | A folder. `folder=NULL` on a document means the root (there is no root row) |
| `Document` | A file: bytes, extracted text, folder, KB, `deleted_at` if in the bin. `metadata.spec` is an office file's editable structure; `metadata.draft` a parked autosave |
| `DocumentVersion` | What a file held before an overwrite. Files over the size cap keep no copy |
| `KnowledgeBase` | A searchable set of documents. `backend` says how it is searched |
| `DocumentChunk`, `IndexedTerm` | Pieces of documents for vector search, and words for keyword search |
| `ExtractionSchema`, `ExtractedRow` | "Pull these fields out of these files", and the rows that came out |
| `PublishedPage` | A shared snapshot at `/p/<slug>` |
| `Dashboard` | Tiles on the Dashboards page |
| `RecentFile`, `AppSession` | Recently opened files, and the tabs open in each document app |

Trashed rows are hidden by the default manager (`LiveManager`), so ordinary queries never see the bin.

## Files

| File | What it does |
|---|---|
| `filesystem.py` | Folder lookups and moves. Unknown and not-yours ids both give 404 |
| `vfs.py` | The AI's file system: list, read, write, edit, find, move, delete, inside a scope |
| `search.py` | Search for the file browser: exact matches first, then close matches by name |
| `engine.py` | The HNSW vector index behind semantic search |
| `backends/` | The four ways a KB is searched: `vector`, `fulltext`, `hybrid`, `raw` (read only) |
| `kb_access.py` | The one door for reading a KB on someone else's behalf. Team membership is checked on every call |
| `kb_views.py`, `views.py`, `folder_views.py`, `serializers.py`, `urls.py` | Documents, folders, KBs and search over HTTP |
| `recycle.py` | Trash, restore, and the sweep that deletes for good |
| `quota.py` | Storage per tier and a file count. `check()` refuses a write that does not fit |
| `indexing.py`, `tasks.py`, `utils.py` | Upload → text → chunks → embeddings, through a queue with a fixed number of workers |
| `reindex.py`, `migration_tasks.py` | Re-indexing after the embedding model changes |
| `signals.py` | Keeps KB document counts right; deleting a row deletes its stored file |
| `versions.py`, `drafts.py`, `office_edit.py` | Version history, parked autosaves, and create or edit from the in-browser apps |
| `export.py`, `importers.py`, `text_blocks.py` | Exporting to other formats; uploaded Word and PowerPoint files turned into editable specs |
| `previews.py`, `recents.py`, `recent_views.py` | Image conversion and zip listings; recently opened files and saved tabs |
| `pages.py`, `page_views.py` | Publishing and serving shared pages |
| `dashboards.py`, `dashboard_views.py` | Dashboard spec validator (shared with the `save_dashboard` tool) and its API |
| `extraction.py`, `extraction_views.py`, `extraction_urls.py` | The extraction engine, served at `/api/extraction/` |
| `kb_folders.py` | Knowledge bases bound to folders. The folder tree is the hierarchy |
| `admin.py`, `apps.py` | Django admin and app config |
| `management/commands/` | `purge_recycle_bin`, `reindex_all`, `retype_documents`, `run_extraction` |

## Rules

- The API takes ids, never paths. Paths are for display.
- `vfs.py` never imports `os`. The AI's file tree is database rows, so a bug reaches another row, never a server file.
- Deleting goes to the recycle bin. Files in the bin still count against quota until emptied.
- A team can search a shared KB only from chat, and only while both sides are members. The rules are in `kb_access.py`.

## Tests

`inference/tests/`: `test_filesystem.py`, `test_vfs.py`, `test_vfs_hardening.py`,
`test_recycle.py`, `test_versions.py`, `test_quota.py`, `test_kb_sharing.py`,
`test_search.py`, `test_import.py`, `test_previews.py`.
