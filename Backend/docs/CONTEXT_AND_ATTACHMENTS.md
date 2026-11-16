# Context and attachments

Two halves of one question: what the model sees each turn, and how an
attached file travels into that view. Nothing is ever deleted from the
database to make room — shrinking the desk does not erase the library.

## Part 1: Context

### What the model sees each turn, top to bottom

1. **System baseline.** Who it is, the core rules, your saved facts. Same
   every turn; stable on purpose so providers can cache it.
2. **Prior conversation.** The last `HISTORY_WINDOW` (= 20) `ChatMessage`
   rows with role `user` or `assistant` — about ten exchanges, not twenty
   turns. System rows inside that span ride along. Older turns are not
   replayed. Once a conversation has session notes, the window is the current
   task's messages plus a short tail, not a flat 20 (see
   `CONTEXT_LIFECYCLE.md`).
3. **Attachment text.** Extracted text from recent uploads, folded into the
   messages that referenced them. Images go separately (Part 2).
4. **Sources already reviewed.** Citations from earlier research turns. The
   last 3 keep snippets; older ones become bare links.
5. **Context update.** What changed this turn: the clock, the mode nudge
   (research, image, video), files withheld from this model, the slash-command
   block, open todos. Rides as a trailing `system` message, never inside the
   baseline — keeps the top of the request byte-identical so caching works.
6. **Your current message.**
7. **Tool results this turn.** Each tool call and its answer, in pairs.

### Stable vs changing

The baseline holds only what never changes mid-session. Everything that moves
— time, intent, blocked files, the command — rides at the end. If the clock
sat in the system prompt, the prefix would differ every turn and no cache
could hit. Your saved facts are the one exception; they change rarely.

### Memory on, memory off

**On** (default): the last 20 messages plus the extras above. To reach
further back, the model calls `search_conversation_history`.

**Off**: the model sees only your current message. Earlier turns are hidden,
not deleted. Messages are still saved; with memory off the turn gets a
throwaway id. This gates recall, not retention.

### Facts about you

Flat text, not a form. An exact repeat touches the fact instead of adding a
copy. Caps are per category; eviction is least recently saved; rendering cuts
on whole lines. Agents read these facts but cannot write them.
Tools: `remember_about_user`, `forget_about_user`, `/memory`.

### Plans, commands, sources

- **Todos.** The run's plan (`update_todos`). Open items ride back every
  turn. Intent only, never results.
- **Command block.** A slash command becomes one trailing context block for
  this turn (see `SLASH_COMMANDS.md`).
- **Charts and files.** Ride as structured data the UI renders, not prose.

### How big the desk is

| Limit | Value | What it means |
|---|---|---|
| History window | 20 messages | `user` + `assistant` rows replayed verbatim. |
| Hard context | 100k tokens | Nothing assembled past this is sent. |
| Last-resort clamp | 96k tokens | Applied to the final payload; moves in whole segments so no `tool_call_id` points at nothing. |
| One message | 24k tokens | A single message may not eat the budget. |
| History search | 12 matches, 12k chars | The escape hatch is capped harder than the window it protects. |
| Tool result backstop | 64k chars | Per-tool ceilings sit below this. Over it, full text spills to `ToolOutput` and the model gets a preview naming the id. |

### When it does not fit

Chat uses `CHAT_POLICY` (`chat/turn/curation.py`): compaction and indexing
on, the fold (a paid model call) off. Compaction replaces old tool results
with a 400-char record keeping name, args and a pointer; indexing keeps the
cut text reachable via `recall_context` / `read_tool_output`. Agent runs
additionally fold: the oldest steps become one running note (~250 words),
absorbed each pass.

Both fire only at a watermark: nothing happens until `CONTEXT_HIGH_WATER_RATIO`
(70%) of the input budget, then enough is cut to reach
`CONTEXT_LOW_WATER_RATIO` (45%) in one jump. The last 3 segments are never
touched.

What a run may pull in is bounded: knowledge-base scope, file scope,
delegation caps (refused, not trimmed), one shared briefing as context, and
read-through to the parent's archive for one hop. Full design:
`CONTEXT_LIFECYCLE.md`.

### KV cache hits

Providers reuse work when the request prefix is byte-identical. From our
side: stable head, moving tail; fixed ordering; plans and commands never up
top; tools declared once, natively; curation in one jump; hot-path reads
primed once per turn; and every model call logs `[Latency] … cached=Y(Z%)`
so hits are measured. First turn of a session is always ~0% (a write);
later turns should climb. If cached reads stay 0 while the prefix is
stable, that is the provider or route (e.g. the free router swapping
models), not a prefix bug.

## Part 2: Attachments

### How to attach a file

Upload to a chat session. The app:

1. Saves the bytes to disk (`chat_attachments/…`).
2. Classifies by extension: `image`, `pdf`, `pptx`, `docx`, `xlsx`, `text`,
   `other`.
3. Pulls the text out. Caps stored text at 500k chars; flags
   `is_large_file` past 120k.
4. Writes a system marker message carrying `metadata.attachment_id` — how
   history finds the file later.
5. For `pdf`, `pptx`, and `text` with real text, registers a `Document` row
   and indexes it in the background for RAG search.
6. Returns a preview (first ~120k chars).

Attach once, reference all session. Supported for reading: `.png .jpg .jpeg
.gif .webp .bmp` (as images), `.pdf`, `.pptx/.ppt`, `.docx/.doc`,
`.xlsx/.xlsm/.xls`, `.txt .md .csv .json .xml .html .yml .yaml`. Anything
else is `other`. Max upload 50 MB; Office zips are checked against a 200 MB
uncompressed ceiling before opening.

### What the model actually receives

- **Vision model:** gets the files directly.
- **Text-extracted types** (`pdf`, `pptx`, `docx`, `xlsx`, `text`): ride in
  as text tokens.
- **Text-only model + image:** the file stays off the wire. The model gets
  an id and is told to call `ask_vision` instead of guessing.
- **No reader:** you get the plain reason plus whether switching models
  helps; the model gets the id (if any) and an instruction to say so.

Only the uploads referenced by the last 5 messages contribute. Older uploads stay saved and
searchable but stop auto-riding. Large files go the RAG route instead.

### First full, then preview

Not yet answered after: the first time the model needs a file, the full
extracted text is pasted under the message (`FULL RESOURCE CONTENT`).
Already answered after: later turns get a short preview plus an instruction
to call `read_attachment_text` to quote precisely.

Three on-demand tools complete the loop: `read_attachment_text` (page a
file), `get_chat_message_full_text` (page a long stored answer),
`search_conversation_history` (grep older turns).

### RAG indexing: the second life of an upload

`pdf`, `pptx`, and `text` uploads with text also create an
`inference.Document` and queue indexing (`inference/indexing.py`): chunk
(~500 chars), embed, index into the session knowledge base. The `Document`
owns the bytes; the attachment points at the same file, so an upload is
stored once and counts once against the storage quota. Two paths to the
same file: in-context (fast, exact, costs tokens) and retrieval (cheap,
survives the window). Deleting a message with an attachment removes all
three (file, index entry, `Document`); deleting a session purges every
attachment's rows too.

### Images, scans, and `other` files

- **Images a text model cannot see** go through the witness (`ask_vision`,
  max 6 questions per image per turn). Disagreement between two readers is
  surfaced, not hidden.
- **Scanned PDFs** with no text layer behave like images: ask via the
  witness or switch to a vision model.
- **`other`** (zip, audio, binary, unknown): text empty on purpose; the
  bytes are kept so `run_python_on_files` can open them. Unknown types
  default to `other` so zip noise never reaches the index.
- **Legacy `.doc`** filed as `docx` returns empty rather than garbage.

### If the model says it cannot see your file

1. Is it inside the last 5 messages? Older uploads stop auto-attaching.
2. Is it large (>120k chars)? It rides via preview + RAG; ask the model to
   quote via `read_attachment_text`.
3. Is it an image on a text-only model? Switch model, or tell it to use
   `ask_vision`.
4. Is it `other` or a scan? The text may genuinely be empty — the UI
   preview length tells you.

## For developers: where it lives

- `chat/turn/prompts.py` — `build_system_message` (stable) +
  `build_context_update` (volatile tail).
- `chat/turn/history.py` — `load_history`, attachment/source enrichment,
  `recent_attachments`, `partition_attachments`.
- `chat/turn/agent.py` — `prepare_attachments`, `supports_vision`.
- `chat/sources/attachments.py` — `classify_file`, extractors,
  `store_document`, `release_attachment`, `purge_session`.
- `chat/views.py` — `upload_file` (validate size/zip, quota, classify,
  extract, marker, queue indexing), delete paths.
- `chat/models.py` — `ChatSession`, `ChatMessage`, `ChatAttachment`,
  `ToolOutput`.
- `chat/turn/curation.py`, `llm/budget.py`, `chat/tools/tool_output.py` —
  the long-run path. Full design in `CONTEXT_LIFECYCLE.md`.
- `workflow_backend/thresholds.py` — every number on this page
  (`HISTORY_WINDOW`, `MAX_CONTEXT_TOKENS`, `CONTEXT_HIGH_WATER_RATIO`,
  watermark ratios, `DOCUMENT_EXTRACT_CAP`, …).
- `chat/vision/` — the witness (`ask_vision`). See `VISION_AGENT.md`.
- Tests: `chat/tests/test_context.py`, `test_curation*.py`,
  `test_attachment_types.py`, `inference/tests/test_file_types.py`,
  `test_vision.py`.
