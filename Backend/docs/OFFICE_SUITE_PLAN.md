# Office suite — record

## Status

**All six phases (A–F) built and committed (2026-09-26).** For how the apps
work now, see `inference/README.md` and the "apps are applications now"
entry in `CLAUDE.md`. This file is the plan as it was written; the
"paused"/"uncommitted" notes in it describe the state before the work
resumed and are history.

## What it delivered

- **A frame that is an application**, not a page in an admin panel: one bar,
  full-bleed document, only one file open at a time, a File menu (rename,
  copy, download, export, print, move, delete), and framing shared between
  the apps.
- **Docs** — TipTap (the old stack of text boxes is gone; real toolbar,
  images, charts), **Sheets** — Univer (formulas, formatting, multi-cell
  selection and fill), **Slides** — editor on the slide itself, **Code** —
  CodeMirror (colours while typing, find/replace), **Notepad** and
  **Whiteboard** with undo.
- **Autosave everywhere**, matching the old Notepad/To Do behaviour, and a
  visible save status.
- **Version history** — `inference/versions.py` + `DocumentVersion`
  (snapshot on every save, coalesced, `FILE_VERSIONS_KEPT`), restore, and
  tools (`file_versions`, `restore_file_version`, `export_file`).
- **Export** — `inference/export.py`: `FORMATS`, workbook↔CSV, deck → PDF,
  Word → PDF, via `POST /api/inference/documents/{id}/export/` and
  `export_file`.
- **Previews for every file type** — one component family for the Files
  side pane, the preview modal and the chat drawer; PDF, legacy Office,
  TIFF/HEIC, audio, video, OpenDocument, RTF, zip and email all preview or
  are clearly labelled.
- **The one rule: the real file is the truth.** Apps and agents edit the
  same bytes; nothing is converted into a shadow format that could drift.

## Decisions worth remembering

- **No external office server** (user decision 2026-09-25). ONLYOFFICE and
  Collabora need 2–4 GB of RAM (production is far smaller), and ONLYOFFICE
  is AGPL while both repos are public. We use MIT/Apache-2.0 editor
  libraries inside our own apps, and agents edit the same real files the
  apps edit.
- **The real file is the truth.** Any spec or preview is derived from the
  stored bytes on save; previews draw from `metadata.spec` only as a
  convenience.
- **openpyxl drops charts it did not create** — charts in a workbook must be
  kept or re-rendered from the spec, not round-tripped through openpyxl.
- **Import fidelity is lossy.** Converting an uploaded `.docx`/`.pptx` loses
  what our spec cannot express; the original upload is kept as a version.
- **Univer stays a lazy chunk** that loads only in Sheets.

## Open

- **Sheets: a formula typed in the editor shows its result only after a
  reload** (the server computes it correctly). Found 2026-11-16; cause not
  yet investigated.
