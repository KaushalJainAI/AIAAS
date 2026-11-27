# `office/`: building and reading document files

Not a Django app: no models, views or URLs. It is a plain Python library. It
turns a *spec* (slides, sheets, blocks or a chart) into a real file, and reads
files back. The user sees the results as the decks, workbooks and documents
the assistant makes.

It imports nothing from the rest of the backend except
`workflow_backend.thresholds`. The import contract `office-standalone` in
[`.importlinter`](../.importlinter) enforces that.

## Who uses it

- **The assistant's tools**: `chat/tools/office.py` and `chat/tools/charts.py`
  check the model's arguments, then call this library.
- **The Docs, Sheets and Slides apps**: `inference/office_edit.py`, `drafts.py`,
  `importers.py` and `export.py` save, autosave, import and export through it.
- **The benchmark**: `eval/office_files.py` reads real files back to grade them.

## Files

| File | What it does |
|---|---|
| `spec.py` | Shared checks, and `SpecError` (a message written for the model) |
| `themes.py` | The three visual themes and the chart colours |
| `charts.py` | The chart spec: kinds, limits, and `build_spec` |
| `deck.py` | Slides spec to `.pptx`: ten layouts, native editable charts |
| `document.py` | Blocks spec to `.docx` |
| `workbook.py` | Sheets spec to `.xlsx`, with real formulas |
| `pdf.py` | Blocks spec to `.pdf` |
| `diagram.py` | Boxes and arrows, laid out left to right |
| `edit.py` | Changes an existing workbook in place: rows, cells, formats, insert and delete (references are shifted) |
| `sheets.py` | `.xlsx` to and from the Sheets grid snapshot (Univer), keeping charts and anything not edited |
| `formulas.py` | The formula evaluator. It interprets formulas; it never runs them as Python |

## Rules

- The model writes a spec, never code. This library makes every visual decision.
- Limits refuse, never shrink. Too much text comes back as "split it", not as a smaller font.
- Formulas stay formulas. A total is `=SUM(...)`, not a typed number.

## Tests

`chat/tests/test_office.py`, `inference/tests/test_sheets.py`,
`inference/tests/test_formulas.py`, `eval/tests/test_office_graders.py`.
