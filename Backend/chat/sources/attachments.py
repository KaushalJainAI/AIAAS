"""
File and RAG lifecycle for chat attachments.

Upload classifies a file, pulls its text out, and registers it in the user
knowledge base; deletion has to undo all three — the file on disk, the vector
index entry, and the `Document` row. Both halves live here so they cannot drift:
anything the upload path creates, the release path knows how to remove.
"""
from __future__ import annotations

import logging
from uuid import UUID

from chat.models import ChatAttachment, ChatMessage, ChatSession

logger = logging.getLogger(__name__)


# ── Classification and text extraction ───────────────────────────────────────

FILE_TYPES = {
    "image": (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"),
    "pdf": (".pdf",),
    "pptx": (".pptx", ".ppt"),
    # Word and Excel were missing until 2026-09-20: both classified as "other"
    # and extracted to an empty string, so attaching a spreadsheet to a message
    # gave the model its name and nothing else.
    "docx": (".docx", ".doc"),
    "xlsx": (".xlsx", ".xlsm", ".xls"),
    "text": (".txt", ".md", ".csv", ".json", ".xml", ".html", ".yml", ".yaml"),
}


def classify_file(filename: str) -> str:
    lowered = filename.lower()
    for kind, suffixes in FILE_TYPES.items():
        if lowered.endswith(suffixes):
            return kind
    return "other"


def extract_pdf_report(data: bytes, max_pages: int = 100) -> tuple[str, bool]:
    """(text, complete) for a PDF. Incomplete past `max_pages` pages, or when unreadable."""
    import io

    try:
        # pypdf, not PyPDF2: the latter is its deprecated predecessor, and the
        # knowledge base (`inference/utils.py`) already reads PDFs with pypdf.
        from pypdf import PdfReader
    except ImportError:
        return "[PDF extraction needs pypdf: pip install pypdf]", False

    try:
        reader = PdfReader(io.BytesIO(data))
        pages = reader.pages
        text = "\n\n".join(
            chunk for page in pages[:max_pages] if (chunk := page.extract_text())
        )
        return text, len(pages) <= max_pages
    except Exception:
        logger.exception("[Upload] PDF extraction failed")
        return "", False


def extract_pptx_report(data: bytes) -> tuple[str, bool]:
    """Slides, tables, group shapes and notes of a deck (`inference.utils`)."""
    import io

    from inference.utils import extract_pptx_report as _from_file

    try:
        return _from_file(io.BytesIO(data))
    except Exception:
        logger.exception("[Upload] PPTX extraction failed")
        return "", False


def extract_docx_report(data: bytes) -> tuple[str, bool]:
    """Body, headers, footers and notes of a Word attachment (`inference.utils`)."""
    import io

    from inference.utils import extract_docx_report as _from_file

    try:
        return _from_file(io.BytesIO(data))
    except Exception:
        logger.exception("[Upload] DOCX extraction failed")
        return "", False


def extract_xlsx_report(data: bytes) -> tuple[str, bool]:
    """Sheets, headers and cells of a spreadsheet (`inference.utils`), up to its row cap."""
    import io

    from inference.utils import extract_xlsx_report as _from_file

    try:
        return _from_file(io.BytesIO(data))
    except Exception:
        logger.exception("[Upload] XLSX extraction failed")
        return "", False


#: The types the model is sent as a raw `file` block when its provider allows
#: it, so the text the injection scan reads must be all of the file. An image
#: or a video has no text and is never in this set.
RAW_SCANNED_TYPES = frozenset({"pdf", "pptx", "docx", "xlsx", "text"})


def extract_text_checked(data: bytes, file_type: str) -> tuple[str, bool]:
    """(text, complete): an upload's text, and whether it is all of what the file holds.

    `complete` is False when a reader gave up, stopped at a cap (pages, rows),
    or returned nothing for a document that had bytes in it. A document with
    no text layer lands here too, which is the point: the model reads that
    file whole, and the scan cannot see it.
    """
    match file_type:
        case "pdf":
            text, complete = extract_pdf_report(data)
        case "pptx":
            text, complete = extract_pptx_report(data)
        case "docx":
            text, complete = extract_docx_report(data)
        case "xlsx":
            text, complete = extract_xlsx_report(data)
        case "text":
            return data.decode("utf-8", errors="ignore"), True
        case _:
            # A format with no reader yet. The bytes are kept, so
            # `run_python_on_files` can open it; nothing is invented here.
            return "", True
    if data and not text.strip():
        complete = False
    return text, complete


def extract_text(data: bytes, file_type: str) -> str:
    return extract_text_checked(data, file_type)[0]


def scan_is_incomplete(file_type: str, text: str, *, complete: bool) -> bool:
    """True when a raw document's stored text is not all the model will read.

    The model reads a raw document whole. The injection scan reads `text`,
    which is cut to `DOCUMENT_EXTRACT_CAP` when stored, so anything the reader
    left out or the cap cut is text no check has seen. Such an upload marks
    its attachment, and the turn is tainted (docs/SAFETY_AND_GUARDRAILS.md).
    """
    from workflow_backend.thresholds import DOCUMENT_EXTRACT_CAP

    if file_type not in RAW_SCANNED_TYPES:
        return False
    return not complete or len(text) > DOCUMENT_EXTRACT_CAP


# ── Indexing ─────────────────────────────────────────────────────────────────

def store_document(user, upload, text: str):
    """Store the upload as a `Document` row in `/Chat/`; return the row.

    Every chat upload gets the row; text-bearing types are chunked + embedded
    by process_document, while images and formats with no reader land as
    `stored` (kept, listed, re-readable) rather than living only on the chat.

    The row lives in `/Chat/` — the same folder `vfs.chat_scope` writes into —
    so the file the model was told about and the file its `read_file` /
    `find_files` tools can address are one and the same row. A system message
    carrying only extracted text leaves the file tools blind: the agent can
    quote the upload but cannot open, edit or run code on it.

    **The document owns the bytes.** The attachment is created afterwards
    pointing at this row's file (`ChatAttachment.file = document.file`, the
    shape `persist_generated_media` already used), so an upload is written to
    disk once. It used to be saved twice — once per row — and every chat
    attachment cost double its size. Indexing is the caller's to start, once
    the attachment exists (`inference.indexing.index_document`).
    """
    from inference import filesystem as fs
    from inference.models import Document
    from inference.utils import normalize_file_type
    from workflow_backend.thresholds import CHAT_HOME_ROOT, DOCUMENT_EXTRACT_CAP

    # `ChatAttachment.file_type` speaks its own five-value vocabulary
    # ('image'/'pdf'/'pptx'/'text'/'other'), which is not Document's — 'pptx',
    # 'text' and 'other' are not FILE_TYPE_CHOICES at all. Normalising from the
    # filename keeps every producer of a Document row agreeing with every
    # consumer of `Document.file_type` (text extraction, vision extraction).
    try:
        chat_folder = fs.ensure_folder(user, CHAT_HOME_ROOT, None)
    except Exception:
        logger.exception("[Upload] Could not ensure /Chat/ folder; filing at root")
        chat_folder = None
    return Document.objects.create(
        # Capped like every other writer of this column: the attachment's own
        # copy was cut at the cap while this one took the whole extraction.
        user=user, name=upload.name, content_text=text[:DOCUMENT_EXTRACT_CAP],
        file=upload,
        file_type=normalize_file_type(upload.name, getattr(upload, 'content_type', '')),
        file_size=upload.size, status="pending",
        folder=chat_folder,
    )


def _drop_blob(field_file) -> None:
    """Remove an attachment's stored file, unless a document still owns it.

    An upload shares its document's bytes, so this runs *after* the document
    rows are deleted: a document that survived (it was trashed, or its delete
    failed) keeps the file it still points at.
    """
    if not field_file:
        return
    try:
        from inference.models import Document

        if Document.all_objects.filter(file=field_file.name).exists():
            return
        field_file.storage.delete(field_file.name)
    except Exception as exc:  # noqa: BLE001 — an orphaned blob never fails a delete
        logger.warning("[Delete] Could not remove file from disk: %s", exc)


# ── Release ──────────────────────────────────────────────────────────────────

def release_attachment(session: ChatSession, message: ChatMessage) -> None:
    """Delete the attachment a message owns, plus its file and RAG records."""
    raw_id = (message.metadata or {}).get("attachment_id")
    if not raw_id:
        return

    try:
        attachment_id = UUID(raw_id)
    except (ValueError, TypeError):
        return

    attachment = ChatAttachment.objects.filter(id=attachment_id, session=session).first()
    if attachment is None:
        return

    if attachment.inference_document_id:
        purge_rag_document(str(session.id), attachment.inference_document_id)

    # After the document: an upload shares its bytes with that row, whose
    # delete already removed them; this covers an attachment with its own copy.
    _drop_blob(attachment.file)
    attachment.delete()


def purge_rag_document(session_id: str, document_id) -> None:
    """Remove a document from the session vector index and the database."""
    try:
        from asgiref.sync import async_to_sync

        from inference.engine import get_session_knowledge_base
        from inference.models import Document

        try:
            async_to_sync(get_session_knowledge_base(session_id).delete_document)(document_id)
        except Exception:
            # The SQL row must still go even if the index is unavailable —
            # leaving it behind would resurrect the document on reindex.
            logger.warning("[Delete] Vector index removal failed", exc_info=True)

        Document.objects.filter(id=document_id).delete()
    except Exception:
        logger.exception("[Delete] RAG cleanup failed for document %s", document_id)


def purge_session(session: ChatSession) -> None:
    """
    Drop everything a session's attachments left outside the session's own rows.

    Cascading the delete would take the `ChatAttachment` rows and stop there,
    leaving the `Document` rows and the vector index behind — orphaned entries
    that keep answering retrieval queries for a conversation that no longer
    exists.
    """
    session_id = str(session.id)

    document_ids = list(
        ChatAttachment.objects
        .filter(session=session, inference_document__isnull=False)
        .values_list("inference_document_id", flat=True)
    )
    if document_ids:
        try:
            from inference.models import Document

            Document.objects.filter(id__in=document_ids).delete()
        except Exception:
            logger.exception("[Session] RAG cleanup failed for %s", session_id)

    # The cascade removes the attachment rows and never their files. The
    # documents' files went with their rows above
    # (`inference/signals.py::drop_document_blob`); this takes what is left.
    for attachment in ChatAttachment.objects.filter(session=session).exclude(file=''):
        _drop_blob(attachment.file)

    try:
        from inference.engine import clear_session_kb

        clear_session_kb(session_id)
    except Exception:
        logger.exception("[Session] Vector index cleanup failed for %s", session_id)
