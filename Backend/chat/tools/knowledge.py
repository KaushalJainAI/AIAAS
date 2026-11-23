"""
Tools that reach the user's knowledge bases.

Retrieval is a choice the model makes, not a mechanism hidden from it. Each
KB declares a backend — semantic, keyword, raw, hybrid — and these tools let
the agent match strategy to question: `knowledge_base_search` for meaning,
`keyword_search` for exact strings and identifiers, and
`list_documents` → `read_document` for raw KBs where the answer is in the
whole document, not a fragment. Descriptions cross-reference so the model can
route itself; misroutes degrade to advice rather than errors.
"""
from __future__ import annotations

import json
import logging

from typing import Dict, List

from .registry import tool

from tools_config.overlay import alimit

from tools_config.settings_schema import (
    _DOC_LIST_CAP,
    _KB_SNIPPET_CHARS,
    _KB_TOP_K,
    _READ_WINDOW_CHARS,
)

logger = logging.getLogger(__name__)

#: How much of one document read_document hands back per call. Matches the
#: read_tool_output window on purpose: paging exists so the model can pick
#: what it needs, not reassemble whole documents in context. Now a per-tool
#: knob (`read_document.windowChars`); the constant stays as the floor under
#: a failed overlay read.
READ_WINDOW_CHARS = 12_000


def _size_human(size: int) -> str:
    b = size
    for unit in ('B', 'KB', 'MB', 'GB'):
        if b < 1024:
            return f'{b:.1f} {unit}'
        b /= 1024
    return f'{b:.1f} TB'


def _kb_backend_label(backend: str) -> str:
    return {
        'vector': 'semantic',
        'fulltext': 'keyword',
        'raw': 'raw',
        'hybrid': 'hybrid (semantic + keyword)',
    }.get(backend, backend or 'semantic')


@tool({
        "type": "function",
        "function": {
            "name": "list_knowledge_bases",
            "description": "List all knowledge bases (KBs) available to the user. Call this first to discover which KBs exist and their IDs before deciding which one to search. Each KB reports its retrieval backend: 'semantic' KBs suit natural-language questions via knowledge_base_search, 'keyword' KBs suit exact terms/IDs/code via keyword_search, 'raw' KBs have no search index at all — browse them with list_documents and read documents with read_document. Hybrid KBs support both searches. Each KB also reports the folder it is bound to (folder_path) and the KBs bound beneath that folder (child_kbs); pass include_children=true to a search to search those too.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
                "additionalProperties": False
            }
        }
    }, parallel=True, effect="read")
async def list_knowledge_bases(args: Dict, context: Dict) -> str:
    from asgiref.sync import sync_to_async
    from inference.kb_access import readable_kbs
    user_id = context.get("user_id")
    if not user_id:
        return json.dumps({"error": "No user context."})
    from django.db.models import Q

    from inference import kb_folders

    try:
        scope = kb_scope(context)
        file_scope = context.get("file_scope")

        def _list():
            # The one door: the user's own KBs, plus the org's shared ones in a
            # chat that belongs to an org. Hidden eval corpora are excluded by
            # the door itself, so an agent cannot discover what is being tested.
            rows = readable_kbs(user_id, chat_org_id(context))
            if scope:
                # Listing every KB the *user* owns would hand a scoped agent the
                # names and ids of corpora it may not search, which it will then
                # try, and report the refusals to whoever reads the run. The
                # second half of the scope rule adds KBs bound inside the files
                # this run reads (`inference/kb_folders.py`).
                rows = rows.filter(Q(id__in=scope) | kb_folders.in_file_scope_q(file_scope))
            objs = list(rows.select_related('folder'))
            out = []
            for kb in objs:
                # A bound folder that was trashed is not a place any more.
                folder = kb.folder if kb.folder_id and kb.folder.deleted_at is None else None
                children = []
                if folder is not None:
                    children = [
                        {'id': other.id, 'name': other.name}
                        for other in objs
                        if other.folder_id and other.id != kb.id
                        and other.folder.deleted_at is None
                        and other.folder.path.startswith(folder.path)
                    ]
                out.append({
                    'id': kb.id,
                    'name': kb.name,
                    'description': kb.description,
                    'doc_count': kb.doc_count,
                    'vector_count': kb.vector_count,
                    'index_size_bytes': kb.index_size_bytes,
                    'is_default': kb.is_default,
                    'embedding_model': kb.embedding_model,
                    # Owner id is read to tell "yours" from "shared with your
                    # team"; it is never shown. The model learns only that the
                    # KB is team-shared.
                    'shared_by_team': kb.user_id != user_id,
                    'retrieval': _kb_backend_label(kb.backend),
                    'size_human': _size_human(kb.index_size_bytes),
                    'folder_path': kb_folders.display_path(file_scope, folder),
                    'child_kbs': children,
                })
            return out

        kbs = await sync_to_async(_list)()
        return json.dumps({"knowledge_bases": kbs, "count": len(kbs)})
    except Exception as e:
        return json.dumps({"error": f"Failed to list KBs: {e}"})


def kb_scope(context: Dict) -> tuple[int, ...] | None:
    """The knowledge bases this caller may reach, or None for "any it owns".

    None is unrestricted and an empty tuple is impossible by construction: the
    agent runtime sends None when its selection is empty, because an agent built
    before the selection was enforced must not have its corpus silently emptied.
    Chat sends nothing at all, which reads the same way.
    """
    scope = context.get("kb_scope")
    if not scope:
        return None
    return tuple(int(kb_id) for kb_id in scope)


def chat_org_id(context: Dict) -> int | None:
    """The organisation whose shared KBs this caller may read, or None.

    Only a chat turn reads team KBs. An agent run carries its chat's `org_id`
    too (so its solutions can reach the team), but its knowledge-base reads stay
    with its owner: an agent is configured once and runs unattended, and a team
    KB shared with the owner must not appear in it without anyone choosing that.
    Runs are told apart by `execution_id`, which is set for every agent run and
    empty in chat (`chat/turn/agent.py::TurnContext.execution_id`).
    """
    if context.get("execution_id"):
        return None
    return context.get("org_id") or None


async def _resolve_kb(user_id: int, kb_id, context: Dict | None = None):
    """(kb_model, error_json) — exactly one is non-None. Scoped to owner, and to
    the caller's configured knowledge bases when it has any.

    Ownership was the only filter here, so an agent configured for one KB could
    search every other KB its owner had; the builder's selector narrowed the
    prompt and nothing else. Out-of-scope answers the same way as not-found: a
    distinct "exists but is not yours to search" would tell an agent what else
    the user keeps.

    The default-KB branch is where the old behaviour was quietly wrong rather
    than merely wide. Omitting `kb_id` fell through to the user's *default* KB,
    which need not be any of the ones this agent was given — and an answer from
    the wrong corpus looks exactly like an answer from the right one.

    K6: in a chat that belongs to an organisation, a team member may name a KB
    the team shared (`readable_kbs`). Unknown, foreign-unshared, hidden and
    non-member all return the same error below.
    """
    from asgiref.sync import sync_to_async
    from inference.kb_access import get_readable_kb, owned_in_scope, readable_kbs

    context = context or {}
    scope = kb_scope(context)

    if not kb_id:
        if scope and len(scope) == 1:
            kb_id = scope[0]
        elif scope:
            return None, json.dumps({
                "error": (
                    f"This agent can search {len(scope)} knowledge bases "
                    f"({', '.join(str(i) for i in scope)}). Pass kb_id to say "
                    f"which one — there is no default among them."
                )
            })
        else:
            # The default is the caller's own, never a team KB: "default" means
            # what the person set up, and a team KB is not theirs to default to.
            kb_model = await sync_to_async(
                lambda: readable_kbs(user_id, None).filter(is_default=True).first()
            )()
            if kb_model is None:
                return None, json.dumps(
                    {"error": "No knowledge base found for this user yet."}
                )
            return kb_model, None

    file_scope = context.get("file_scope")
    if scope and int(kb_id) not in scope:
        # The second half of the scope rule (`inference/kb_folders.py`): a KB
        # bound to a folder inside the files this run reads. Unknown and
        # out-of-scope answer the same below, so an id cannot be probed.
        def _bound_in_files():
            from inference import kb_folders

            kb = kb_folders.owned_kb(user_id, int(kb_id))
            if kb is not None and kb_folders.in_file_scope(kb, file_scope):
                return kb
            return None

        kb_model = await sync_to_async(_bound_in_files)()
        if kb_model is None:
            return None, json.dumps({
                "error": (
                    f"KB {kb_id} is not one this agent may search. Available: "
                    f"{', '.join(str(i) for i in scope)}."
                )
            })
        return kb_model, None

    if scope:
        # An agent with a selection: its owner's KB, inside the selection. Not
        # the reader's door, so a team KB can never reach an agent through here.
        kb_model = await sync_to_async(
            lambda: owned_in_scope(user_id, scope).filter(id=int(kb_id)).first()
        )()
    else:
        kb_model = await sync_to_async(get_readable_kb)(
            user_id, chat_org_id(context), kb_id)
    if kb_model is None:
        return None, json.dumps({"error": f"KB {kb_id} not found among your knowledge bases."})
    return kb_model, None


@tool({
        "type": "function",
        "function": {
            "name": "knowledge_base_search",
            "description": "Search a specific knowledge base (or the user's default KB) using SEMANTIC similarity — best for questions about meaning, topics, or concepts in uploaded documents ('what does the report say about margins?'). For exact strings, IDs, names, or code identifiers use keyword_search instead. Raw-backend KBs cannot be searched semantically — use list_documents + read_document there. Call list_knowledge_bases first if unsure which KB to search.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Natural-language query to search for in the knowledge base."
                    },
                    "kb_id": {
                        "type": "integer",
                        "description": "ID of the specific KB to search (from list_knowledge_bases). Omit to search the user's default KB."
                    },
                    "top_k": {
                        "type": "integer",
                        "description": "Number of top results to return (default 5, max 20)."
                    },
                    "include_children": {
                        "type": "boolean",
                        "description": "Also search the knowledge bases bound to folders beneath this one (the child_kbs list_knowledge_bases shows). Results are merged and ranked together, and each says which KB it came from. Default false."
                    }
                },
                "required": [
                    "query"
                ],
                "additionalProperties": False
            }
        }
    }, parallel=True, effect="read")
async def knowledge_base_search(args: Dict, context: Dict) -> str:
    query = args.get("query", "")
    if not query:
        return "Error: Missing search query"
    try:
        top_k = int(args.get("top_k", await alimit(context, "knowledge_base_search", "topK")))
    except (TypeError, ValueError):
        top_k = _KB_TOP_K
    top_k = max(1, min(top_k, 20))
    user_id = context.get("user_id")
    if not user_id:
        return json.dumps({"error": "No user context for knowledge base search."})

    try:
        kb_model, error = await _resolve_kb(user_id, args.get("kb_id"), context)
        if error:
            return error

        if args.get("include_children"):
            children = await _children_of(kb_model, context)
            if children:
                return await _grouped_search(
                    [kb_model, *children], query, top_k, context, "semantic")

        # A keyword-only KB has no vectors to search. Route rather than fail.
        if kb_model.backend == 'fulltext':
            result = await _keyword_search_impl(
                kb_model, query, top_k,
                await alimit(context, "knowledge_base_search", "snippetChars"))
            payload = json.loads(result)
            payload["note"] = (
                f"KB '{kb_model.name}' is keyword-indexed; results are exact/prefix "
                f"matches, not semantic ones."
            )
            return json.dumps(payload)

        if kb_model.backend == 'raw':
            return json.dumps({
                "status": "no_search_index",
                "message": (
                    f"KB '{kb_model.name}' stores documents raw with no search index. "
                    f"Call list_documents for kb_id={kb_model.id}, then read_document "
                    f"on what looks relevant."
                ),
            })

        from inference.backends.vector import VectorBackend
        backend = VectorBackend(kb_model)
        results = await backend.search(query, top_k=top_k)
        if not results:
            return json.dumps({"status": "no_results", "message": "No relevant documents found. Try a different query or check that documents are indexed."})

        items = [
            {
                "document_id": r.document_id,
                "score": round(r.score, 4),
                "content": r.content[:await alimit(context, "knowledge_base_search", "snippetChars")],
                "metadata": r.metadata,
                "is_image": r.is_image,
            }
            for r in results
        ]
        return json.dumps({"status": "success", "results": items, "count": len(items)})
    except Exception as e:
        return f"Error: Knowledge base search failed: {str(e)}"


@tool({
        "type": "function",
        "function": {
            "name": "keyword_search",
            "description": "Search a knowledge base by EXACT keywords, like grep: case-insensitive whole-word matches plus prefix expansion, ranked by term frequency. Use for IDs, invoice numbers, function/class names, error codes, exact spellings — things semantic search blurs. Supports \"quoted phrases\" for verbatim multi-word matches. Only works on keyword- or hybrid-backend KBs (see list_knowledge_bases); for meaning-based questions use knowledge_base_search.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Keywords to find. Multiple words rank chunks matching more of them higher. Wrap words in double quotes for an exact phrase."
                    },
                    "kb_id": {
                        "type": "integer",
                        "description": "ID of the KB to search (from list_knowledge_bases). Omit to search the user's default KB."
                    },
                    "top_k": {
                        "type": "integer",
                        "description": "Number of top results to return (default 5, max 20)."
                    },
                    "include_children": {
                        "type": "boolean",
                        "description": "Also search the knowledge bases bound to folders beneath this one (the child_kbs list_knowledge_bases shows). Results are merged and ranked together, and each says which KB it came from. Default false."
                    }
                },
                "required": [
                    "query"
                ],
                "additionalProperties": False
            }
        }
    }, parallel=True, effect="read")
async def keyword_search(args: Dict, context: Dict) -> str:
    query = args.get("query", "")
    if not query.strip():
        return "Error: Missing search query"
    try:
        top_k = int(args.get("top_k", await alimit(context, "keyword_search", "topK")))
    except (TypeError, ValueError):
        top_k = _KB_TOP_K
    top_k = max(1, min(top_k, 20))
    user_id = context.get("user_id")
    if not user_id:
        return json.dumps({"error": "No user context for keyword search."})
    try:
        kb_model, error = await _resolve_kb(user_id, args.get("kb_id"), context)
        if error:
            return error

        if args.get("include_children"):
            children = await _children_of(kb_model, context)
            if children:
                return await _grouped_search(
                    [kb_model, *children], query, top_k, context, "keyword")

        if kb_model.backend == 'vector':
            return json.dumps({
                "status": "not_keyword_indexed",
                "message": (
                    f"KB '{kb_model.name}' is semantic-only — it has no keyword index. "
                    f"Use knowledge_base_search for it, or ask its content by meaning."
                ),
            })
        if kb_model.backend == 'raw':
            return json.dumps({
                "status": "no_search_index",
                "message": (
                    f"KB '{kb_model.name}' stores documents raw. Call list_documents "
                    f"for kb_id={kb_model.id}, then read_document."
                ),
            })

        return await _keyword_search_impl(
            kb_model, query, top_k,
            await alimit(context, "keyword_search", "snippetChars"))
    except Exception as e:
        return f"Error: Keyword search failed: {str(e)}"


async def _keyword_search_impl(kb_model, query: str, top_k: int,
                               snippet_chars: int = _KB_SNIPPET_CHARS) -> str:
    from inference.backends.fulltext import FullTextBackend
    backend = FullTextBackend(kb_model)
    results = await backend.search(query, top_k=top_k)
    if not results:
        return json.dumps({
            "status": "no_results",
            "message": "No keyword matches. Try fewer or shorter terms — prefix expansion only applies to terms of 3+ characters.",
        })
    items = [
        {
            "document_id": r.document_id,
            "document_name": r.metadata.get("name"),
            "match": r.metadata.get("match"),
            "score": round(r.score, 4),
            "content": r.content[:snippet_chars],
        }
        for r in results
    ]
    return json.dumps({"status": "success", "results": items, "count": len(items)})


@tool({
        "type": "function",
        "function": {
            "name": "list_documents",
            "description": "List the documents inside one knowledge base: id, name, type, size, status. The entry point for raw KBs (which have no search index) — call this, then read_document on promising titles. Also useful anywhere you need a document's id before reading or citing it.",
            "parameters": {
                "type": "object",
                "properties": {
                    "kb_id": {
                        "type": "integer",
                        "description": "ID of the KB whose documents to list (from list_knowledge_bases). Omit to list the user's default KB."
                    }
                },
                "required": [],
                "additionalProperties": False
            }
        }
    }, parallel=True, effect="read")
async def list_documents(args: Dict, context: Dict) -> str:
    from asgiref.sync import sync_to_async
    from inference.models import Document
    user_id = context.get("user_id")
    if not user_id:
        return json.dumps({"error": "No user context."})
    try:
        kb_model, error = await _resolve_kb(user_id, args.get("kb_id"), context)
        if error:
            return error

        cap = await alimit(context, "list_documents", "maxDocs")

        def _docs():
            # -id breaks ties: uploads inside one clock tick (coarse on some
            # platforms) must not come back in an arbitrary order.
            docs = Document.objects.filter(knowledge_base=kb_model).order_by('-created_at', '-id')
            rows = list(docs.values('id', 'name', 'file_type', 'file_size', 'status')[:cap])
            return rows, docs.count() > cap

        rows, truncated = await sync_to_async(_docs)()
        return json.dumps({
            "status": "success",
            "kb_id": kb_model.id,
            "documents": [
                {
                    "id": r["id"],
                    "name": r["name"],
                    "file_type": r["file_type"],
                    "size_bytes": r["file_size"],
                    "status": r["status"],
                }
                for r in rows
            ],
            "count": len(rows),
            **({"truncated": True, "note": f"Showing the {cap} most recent documents only."} if truncated else {}),
        })
    except Exception as e:
        return f"Error listing documents: {str(e)}"


@tool({
        "type": "function",
        "function": {
            "name": "read_document",
            "description": "Read a document's full extracted text, one window at a time (~12,000 characters per call). The only way into raw KBs' contents, and the right follow-up after any search hit that looks promising but cut off mid-sentence. Pass the offset from the previous call's footer to keep reading.",
            "parameters": {
                "type": "object",
                "properties": {
                    "document_id": {
                        "type": "integer",
                        "description": "ID of the document to read (from list_documents or a search result)."
                    },
                    "offset": {
                        "type": "integer",
                        "description": "Character offset to start reading from. Omit or 0 to start at the beginning; use the offset named in the previous window's footer to continue."
                    }
                },
                "required": [
                    "document_id"
                ],
                "additionalProperties": False
            }
        }
    }, parallel=True, effect="read")
async def read_document(args: Dict, context: Dict) -> str:
    from asgiref.sync import sync_to_async
    from inference.models import Document
    user_id = context.get("user_id")
    if not user_id:
        return json.dumps({"error": "No user context."})
    document_id = args.get("document_id")
    if not document_id:
        return "Error: Missing document_id"

    try:
        from inference.kb_access import get_readable_kb

        scope = kb_scope(context)
        file_scope = context.get("file_scope")
        org_id = chat_org_id(context)

        def _lookup():
            from inference.models import HIDDEN_KB_PREFIX

            doc = Document.objects.filter(id=document_id).select_related(
                'knowledge_base').first()
            if doc is None:
                return None, False
            mine = doc.user_id == user_id
            # "Shared" here is the platform's public library (`sharing_mode`),
            # which predates knowledge-base sharing and keeps its own rule.
            shared = doc.sharing_mode in ('shared_read', 'shared_write')

            # A document addressed by id here, not through its KB, so the scope
            # the other four tools enforce would be one `read_document` call away
            # from irrelevant — an agent given one knowledge base could walk the
            # user's whole library by id. A document in no KB at all is out of
            # scope for an agent too: files it may touch directly are the
            # `fileOps` axis, with its own scope.
            if scope is not None:
                # The scope rule applies to the document's knowledge base too:
                # selected, or bound inside the files this run reads.
                from inference import kb_folders

                in_kb = doc.knowledge_base_id in scope or (
                    doc.knowledge_base is not None
                    and kb_folders.in_file_scope(doc.knowledge_base, file_scope))
                return doc, (mine or shared) and in_kb

            # K6: a chat reads a document through its knowledge base. Own KBs
            # and the org's shared ones pass the door; a document in no KB keeps
            # the rule it always had (owner or public library).
            if doc.knowledge_base_id is None:
                return doc, mine or shared
            if get_readable_kb(user_id, org_id, doc.knowledge_base_id) is not None:
                return doc, True
            # The public library stays readable as before, except inside an eval
            # corpus, which never passes this door.
            return doc, shared and not doc.knowledge_base.name.startswith(
                HIDDEN_KB_PREFIX)

        doc, allowed = await sync_to_async(_lookup)()
        if doc is None or not allowed:
            # One answer for unknown, foreign, unshared, hidden and out-of-KB
            # documents. The one exception is the owner's own document outside
            # an agent's scope: the owner already knows it exists, and "this
            # agent may not read it" is the useful thing to tell them.
            if doc is not None and scope is not None and doc.user_id == user_id:
                return json.dumps({
                    "error": (
                        f"Document {document_id} is not in a knowledge base this "
                        f"agent may read."
                    )
                })
            return json.dumps({
                "error": f"Document {document_id} not found among your readable documents."
            })

        text = doc.content_text or ''
        if not text:
            return json.dumps({
                "error": (
                    f"Document '{doc.name}' has no extracted text (it may be an image "
                    f"or video, or extraction failed)."
                ),
            })

        offset = max(0, int(args.get("offset") or 0))
        if offset >= len(text):
            return (
                f"Offset {offset:,} is past the end of '{doc.name}' "
                f"({len(text):,} characters). Nothing to read."
            )

        window = text[offset:offset + await alimit(context, "read_document", "windowChars")]
        end = offset + len(window)
        remaining = len(text) - end
        footer = (
            f"\n\n[Document '{doc.name}', characters {offset:,}-{end:,} of {len(text):,}. "
            + (
                f"{remaining:,} remain — call read_document again with offset={end}.]"
                if remaining else "End of document.]"
            )
        )
        return window + footer
    except Exception as e:
        return f"Error reading document: {str(e)}"


# ---------------------------------------------------------------------------
# Knowledge bases bound to folders: grouped search, and the two write tools.
#
# Writes are agent-only and approval-gated (`kbWrite` in agents/grants.py). Both
# tools are `irreversible` and `sensitive`, so the autonomy ladder asks in `ask`,
# `review` and `auto` (and `static_check` keeps `auto` from downgrading it), and
# only `full` runs them unasked. Chat never holds them: its toolbox is read-only.
# ---------------------------------------------------------------------------

class _NotReachable(Exception):
    """A knowledge base that is unknown to this owner, or outside the scope rule."""


def _no_file_access() -> str:
    return json.dumps({
        "error": "This agent has no file access. Turn on 'Read and write files' "
                 "and set a file access level in its settings."
    })


async def _children_of(kb_model, context: Dict) -> list:
    """Knowledge bases bound beneath `kb_model`'s folder that the run may reach.

    Owner-only, and filtered by the scope rule, so a child the run may not use
    is never searched and never named.
    """
    from asgiref.sync import sync_to_async
    from inference import kb_folders

    user_id = context.get("user_id")
    reach = kb_scope(context)
    file_scope = context.get("file_scope")

    def _lookup():
        return [
            child for child in kb_folders.folder_bound_below(user_id, kb_model)
            if kb_folders.reachable(child, reach, file_scope)
        ]

    return await sync_to_async(_lookup)()


async def _search_one(kb_model, query: str, top_k: int, mode: str,
                      snippet_chars: int) -> list[dict] | None:
    """One knowledge base's hits in `mode`, or None when it cannot answer that mode.

    The routing is the one `knowledge_base_search` and `keyword_search` already
    apply on their own: a raw KB has no index in either mode, a semantic-only KB
    has no keyword index, and a keyword-backed KB answers keyword searches.
    """
    if kb_model.backend == 'raw':
        return None
    if mode == 'keyword':
        if kb_model.backend == 'vector':
            return None
        from inference.backends.fulltext import FullTextBackend

        results = await FullTextBackend(kb_model).search(query, top_k=top_k)
        return [{
            "retrieval": "keyword",
            "document_id": r.document_id,
            "document_name": r.metadata.get("name"),
            "match": r.metadata.get("match"),
            "score": round(r.score, 4),
            "content": r.content[:snippet_chars],
        } for r in results]
    if kb_model.backend == 'fulltext':
        from inference.backends.fulltext import FullTextBackend

        results = await FullTextBackend(kb_model).search(query, top_k=top_k)
        return [{
            "retrieval": "keyword",
            "document_id": r.document_id,
            "score": round(r.score, 4),
            "content": r.content[:snippet_chars],
        } for r in results]
    from inference.backends.vector import VectorBackend

    results = await VectorBackend(kb_model).search(query, top_k=top_k)
    return [{
        "retrieval": "semantic",
        "document_id": r.document_id,
        "score": round(r.score, 4),
        "content": r.content[:snippet_chars],
        "metadata": r.metadata,
        "is_image": r.is_image,
    } for r in results]


async def _grouped_search(kbs: list, query: str, top_k: int, context: Dict,
                          mode: str) -> str:
    """Search several knowledge bases and rank their hits together.

    Scores are the backends' own (cosine for semantic, term-frequency rank for
    keyword), so they are compared as the single-KB tools already present them.
    A knowledge base that cannot answer this mode is named in `skipped`, not
    hidden: the model should know a corpus went unsearched.
    """
    tool_name = "keyword_search" if mode == "keyword" else "knowledge_base_search"
    snippet_chars = await alimit(context, tool_name, "snippetChars")
    items: list[dict] = []
    searched: list[dict] = []
    skipped: list[str] = []
    for kb in kbs:
        try:
            found = await _search_one(kb, query, top_k, mode, snippet_chars)
        except Exception:  # noqa: BLE001 — one corpus failing must not hide the others
            logger.exception("[KnowledgeTools] search of KB %s failed", kb.id)
            found = None
        if found is None:
            skipped.append(kb.name)
            continue
        searched.append({"kb_id": kb.id, "name": kb.name})
        items.extend({**hit, "kb_id": kb.id, "kb_name": kb.name} for hit in found)
    items.sort(key=lambda hit: hit["score"], reverse=True)
    items = items[:top_k]
    payload: dict = {
        "status": "success" if items else "no_results",
        "results": items,
        "count": len(items),
        "searched": searched,
    }
    if not items:
        payload["message"] = (
            "No matches in the knowledge bases searched. Try a different query."
        )
    if skipped:
        payload["skipped"] = skipped
        payload["note"] = (
            f"Not searched in {mode} mode (no index of that kind): {', '.join(skipped)}."
        )
    return json.dumps(payload, default=str)


@tool({
        "type": "function",
        "function": {
            "name": "create_knowledge_base",
            "description": "Create a knowledge base bound to a folder in your files, so that searches can find what is added to it later. The folder is created if it does not exist, inside a folder you can write to. Reuses the knowledge base if one with this name is already bound to that folder. Use it when a body of work needs its own searchable index. The user is asked before it runs, unless they chose full auto.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Name of the knowledge base, e.g. 'Q3 research'. Unique among the user's knowledge bases."
                    },
                    "folder_path": {
                        "type": "string",
                        "description": "Folder to bind it to, relative to your file root (e.g. 'Research/Q3'). Created if missing; must be inside a folder you can write to."
                    },
                    "description": {
                        "type": "string",
                        "description": "What the knowledge base holds and what it is for."
                    },
                    "backend": {
                        "type": "string",
                        "enum": ["hybrid", "vector", "fulltext", "raw"],
                        "description": "How it is searched. 'hybrid' (the default) supports semantic and keyword search; 'vector' is semantic only; 'fulltext' is keyword only; 'raw' has no index and is read whole-document."
                    }
                },
                "required": ["name", "folder_path"],
                "additionalProperties": False
            }
        }
    }, requires="files", sensitive=True, effect="irreversible",
    action_label="Create knowledge base")
async def create_knowledge_base(args: Dict, context: Dict) -> str:
    from asgiref.sync import sync_to_async
    from inference import kb_folders, vfs
    from inference.models import HIDDEN_KB_PREFIX, KnowledgeBase

    user_id = context.get("user_id")
    scope = context.get("file_scope")
    if not user_id:
        return json.dumps({"error": "No user context."})
    if scope is None:
        return _no_file_access()

    name = str(args.get("name") or "").strip()
    folder_path = str(args.get("folder_path") or "").strip()
    description = str(args.get("description") or "").strip()
    backend = str(args.get("backend") or KnowledgeBase.BACKEND_HYBRID).strip().lower()
    if not name:
        return json.dumps({"error": "A knowledge base needs a name."})
    if name.startswith(HIDDEN_KB_PREFIX):
        return json.dumps({"error": f"Names starting with '{HIDDEN_KB_PREFIX}' are reserved."})
    if backend not in {choice for choice, _ in KnowledgeBase.BACKEND_CHOICES}:
        return json.dumps({"error": f"'{backend}' is not a knowledge base type. Use hybrid, vector, fulltext or raw."})
    if not folder_path:
        return json.dumps({"error": "Give folder_path: the folder to bind the knowledge base to, relative to your file root."})

    try:
        kb, created, path = await sync_to_async(kb_folders.create_bound_kb)(
            user_id, scope, folder_path,
            name=name, description=description, backend=backend,
        )
    except vfs.VfsError as e:
        return json.dumps({"error": str(e)})
    except Exception:  # noqa: BLE001
        logger.exception("[KnowledgeTools] create_knowledge_base failed")
        return json.dumps({"error": "Creating the knowledge base failed unexpectedly."})
    return json.dumps({
        "status": "created" if created else "exists",
        "kb_id": kb.id,
        "name": kb.name,
        "backend": kb.backend,
        "folder_path": path,
        "message": (
            "Knowledge base created and bound to its folder. Add documents with "
            "add_to_knowledge_base." if created else
            "A knowledge base with this name is already bound to that folder; reusing it."
        ),
    }, default=str)


@tool({
        "type": "function",
        "function": {
            "name": "add_to_knowledge_base",
            "description": "Add a document to a knowledge base. The text is saved as a markdown file in the knowledge base's folder, then indexed so that searches find it. Use it to record findings that later work should be able to search. Text over the per-write limit is refused, not cut short. The user is asked before it runs, unless they chose full auto.",
            "parameters": {
                "type": "object",
                "properties": {
                    "kb_id": {
                        "type": "integer",
                        "description": "ID of the knowledge base to add to (from list_knowledge_bases). It must be bound to a folder you can write to."
                    },
                    "title": {
                        "type": "string",
                        "description": "Title of the document; it becomes the file name, e.g. 'Refund policy' is saved as 'Refund policy.md'. A document with the same title is replaced, and its earlier version is kept."
                    },
                    "text": {
                        "type": "string",
                        "description": "The document's full text, in markdown."
                    }
                },
                "required": ["kb_id", "title", "text"],
                "additionalProperties": False
            }
        }
    }, requires="files", sensitive=True, effect="irreversible",
    action_label="Add to knowledge base")
async def add_to_knowledge_base(args: Dict, context: Dict) -> str:
    from asgiref.sync import sync_to_async
    from inference import kb_folders, vfs

    user_id = context.get("user_id")
    scope = context.get("file_scope")
    if not user_id:
        return json.dumps({"error": "No user context."})
    if scope is None:
        return _no_file_access()

    try:
        kb_id = int(args.get("kb_id"))
    except (TypeError, ValueError):
        return json.dumps({"error": "Pass kb_id: the id of a knowledge base (from list_knowledge_bases)."})
    title = str(args.get("title") or "").strip()
    text = args.get("text")
    if not title:
        return json.dumps({"error": "Give the document a title."})
    if not isinstance(text, str) or not text.strip():
        return json.dumps({"error": "Give the text to add."})

    name = vfs.safe_name(title)
    if not name.lower().endswith(".md"):
        name = f"{name}.md"
    reach = kb_scope(context)

    def _write():
        kb = kb_folders.owned_kb(user_id, kb_id)
        # Unknown and out-of-scope are one refusal, below.
        if kb is None or not kb_folders.reachable(kb, reach, scope):
            raise _NotReachable()
        # Through `kb_folders.add_document`: the folder must be writable, a
        # same-named document of another knowledge base is refused, and the
        # write is the `write_file` door (quotas, size cap, versioning).
        return kb, kb_folders.add_document(user_id, scope, kb, name, text)

    try:
        kb, result = await sync_to_async(_write)()
    except _NotReachable:
        return json.dumps({"error": f"KB {kb_id} is not one this agent may write to."})
    except vfs.VfsError as e:
        return json.dumps({"error": str(e)})
    except Exception:  # noqa: BLE001
        logger.exception("[KnowledgeTools] add_to_knowledge_base failed")
        return json.dumps({"error": "Adding to the knowledge base failed unexpectedly."})
    return json.dumps({
        "status": "indexing",
        "kb_id": kb.id,
        "document_id": result["document_id"],
        "path": result["path"],
        "created": result["created"],
        "version": result.get("version"),
        "chars": result["chars"],
        "message": "Saved to the knowledge base and queued for indexing; it becomes searchable shortly.",
    }, default=str)
