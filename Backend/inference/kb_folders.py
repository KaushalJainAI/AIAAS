"""
Knowledge bases bound to folders: the folder tree is the hierarchy.

A knowledge base is bound to at most one folder (`KnowledgeBase.folder`). There
is no `parent` column on a knowledge base: a KB bound to `/Research` has, as its
children, the KBs bound to any folder beneath `/Research` — found by the id
prefix on `Folder.path`, one indexed query, the same trick that makes a folder
subtree cheap everywhere else in `inference/filesystem.py`.

**The scope rule (reads).** A run may use a knowledge base when either

1. it is in the agent's configured selection (`kb_scope`), or
2. it is bound to a live folder inside the run's file scope — the subtree its
   `fileAccess` lets it read.

A caller with no selection (`kb_scope` None: chat, or an agent that was never
given one) may use any knowledge base its owner holds, exactly as before. Every
query here is owner-only (`user_id`): a team knowledge base shared through
`inference/kb_access.py` is never reached through the file-scope rule, because
an agent run reads only its owner's knowledge bases.

**The write rule.** Writing a document into a knowledge base needs the rule
above *and* the bound folder to be writable in the file scope. The write itself
is `inference/vfs.py::write_file`, so quotas, size caps and versioning apply and
nothing here can write around them. The document is then bound to the knowledge
base and queued for indexing. Writes are approval-gated; reads never are (see
`agents/grants.py::GRANT_TOOLS['kbWrite']`).

Unknown and out-of-scope knowledge bases answer the same way to the model: the
tools in `chat/tools/knowledge.py` treat both as "not one this agent may use".
"""
from __future__ import annotations

from typing import Any

from django.db.models import Q, QuerySet

from . import filesystem as fs
from . import vfs
from .models import HIDDEN_KB_PREFIX, Document, KnowledgeBase


def owned_kb(user_id: int, kb_id: int) -> KnowledgeBase | None:
    """The owner's own knowledge base with this id, its folder loaded, or None.

    Owner-only, and deliberately not a reader's door: a team knowledge base is
    never an agent's to write, so the reads in `kb_access` do not apply here.
    Kept in this module so that the chat tools never query `KnowledgeBase`
    directly (`inference/tests/test_kb_sharing.py::ChokePointTests`).
    """
    return (KnowledgeBase.objects.select_related('folder')
            .filter(user_id=user_id, id=kb_id).first())


def create_bound_kb(user_id: int, scope: Any, folder_path: str, *, name: str,
                    description: str, backend: str) -> tuple[KnowledgeBase, bool, str]:
    """Create a knowledge base bound to a folder, or reuse one already there.

    The folder is created or reused inside the writable subtree first
    (`vfs.folder_for_write`), so a refusal creates no knowledge base. A name the
    owner already uses for a knowledge base in another folder is refused: the
    name is the handle a person and the model both use. Returns the knowledge
    base, whether it was created, and the folder as the model should see it.
    Raises `vfs.VfsError`.
    """
    folder, _walked = vfs.folder_for_write(scope, folder_path)
    existing = KnowledgeBase.objects.filter(user_id=user_id, name=name).first()
    if existing is not None:
        if existing.folder_id == folder.id:
            return existing, False, display_path(scope, folder)
        raise vfs.VfsError(
            f"You already have a knowledge base named '{name}', bound to another "
            f"folder. Choose another name."
        )
    kb = KnowledgeBase.objects.create(
        user_id=user_id, name=name, description=description,
        backend=backend, folder=folder,
    )
    return kb, True, display_path(scope, folder)


def add_document(user_id: int, scope: Any, kb: KnowledgeBase, name: str, text: str) -> dict:
    """Write one markdown document into `kb`'s folder, bind it, and queue indexing.

    The write is `vfs.write_file`, so quotas, the per-write cap (refused, never
    truncated) and versioning all apply. A document of the same name that
    already belongs to a *different* knowledge base is refused rather than moved
    between indexes. Raises `vfs.VfsError`; returns the write's result.
    """
    from .indexing import index_document

    parts = write_parts(kb, scope)
    clash = (Document.objects.filter(user_id=user_id, folder_id=kb.folder_id, name=name)
             .exclude(knowledge_base_id__in=[None, kb.id]).exists())
    if clash:
        raise vfs.VfsError(
            f"'{name}' already exists in this folder and belongs to another "
            f"knowledge base. Use a different title."
        )
    result = vfs.write_file(scope, "/".join([*parts, name]), text)
    doc = Document.objects.get(id=result["document_id"])
    doc.knowledge_base = kb
    doc.status = "pending"
    doc.save(update_fields=["knowledge_base", "status"])
    index_document(doc.id, kb.id)
    return result


def in_file_scope_q(file_scope: Any) -> Q:
    """A `Q` over KnowledgeBase rows bound to a live folder inside `file_scope`.

    With no scope it matches nothing, so `Q(...) | in_file_scope_q(None)` is
    just the first half. `root is None` means the whole tree is readable.
    """
    if file_scope is None:
        return Q(pk__in=[])
    bound = Q(folder__isnull=False, folder__deleted_at__isnull=True)
    if file_scope.root is None:
        return bound
    return bound & Q(folder__path__startswith=file_scope.root.path)


def in_file_scope(kb: KnowledgeBase, file_scope: Any) -> bool:
    """Whether one knowledge base is bound inside the run's readable file scope."""
    if file_scope is None or kb.folder_id is None:
        return False
    if kb.folder.deleted_at is not None:
        return False
    return vfs.folder_parts_in_scope(file_scope, kb.folder) is not None


def reachable(kb: KnowledgeBase, kb_scope: tuple[int, ...] | None, file_scope: Any) -> bool:
    """The scope rule for reads: unrestricted, selected, or bound inside the files."""
    if kb_scope is None:
        return True
    return kb.id in kb_scope or in_file_scope(kb, file_scope)


def folder_bound_below(user_id: int, kb: KnowledgeBase) -> QuerySet:
    """The owner's knowledge bases bound to a folder *beneath* `kb`'s folder.

    Strictly beneath: `kb` itself is excluded, and so is anything bound to a
    trashed folder or a hidden eval corpus. Empty when `kb` is not bound.
    """
    if kb.folder_id is None:
        return KnowledgeBase.objects.none()
    return (
        KnowledgeBase.objects.filter(
            user_id=user_id,
            folder__path__startswith=kb.folder.path,
            folder__deleted_at__isnull=True,
        )
        .exclude(folder_id=kb.folder_id)
        .exclude(name__startswith=HIDDEN_KB_PREFIX)
        .select_related('folder')
    )


def write_parts(kb: KnowledgeBase, file_scope: Any) -> list[str]:
    """The scope-relative folder names a document of `kb` would be written into.

    Raises `vfs.VfsError` with a message the model can act on when the knowledge
    base has no folder, or its folder is not writable in this run's file scope.
    """
    if kb.folder_id is None:
        raise vfs.VfsError(
            f"'{kb.name}' is not bound to a folder, so there is nowhere to write "
            f"its documents. Bind it to a folder first."
        )
    if kb.folder.deleted_at is not None:
        raise vfs.VfsError(
            f"'{kb.name}' is bound to a folder in the recycle bin. Restore the folder "
            f"or bind the knowledge base to another one before adding to it."
        )
    parts = vfs.folder_parts_in_scope(file_scope, kb.folder)
    if parts is None:
        raise vfs.VfsError(
            f"'{kb.name}' is bound to a folder outside your file access, so this "
            f"agent cannot write to it."
        )
    if not file_scope.writable or not file_scope.may_write_at(parts):
        raise vfs.VfsError(
            f"'{kb.name}' is bound to a folder this agent can read but not write. "
            f"Report what you would have added instead of retrying."
        )
    return parts


def display_path(file_scope: Any, folder) -> str | None:
    """A bound folder as the model should see it: scope-relative when inside."""
    if folder is None:
        return None
    parts = vfs.folder_parts_in_scope(file_scope, folder) if file_scope is not None else None
    if parts is not None:
        return vfs.render(file_scope, parts)
    return fs.name_path(folder)
