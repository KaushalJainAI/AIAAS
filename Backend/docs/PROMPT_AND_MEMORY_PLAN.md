# Prompt and memory — record

## Status

**Built 2026-09-28.** Decisions: database history is the one source for
earlier turns; the memory block is 2,000 characters; repeating agents keep
a `notes.md` (no new table). Phase 0 confirmed the chat double-send (turn 3
received earlier questions twice plus turn 1's tool result) and that the
iteration counter spanned the session. One deviation: `notes.md` goes to
any agent with an enabled trigger, not only schedules.

## What it delivered

- **One source of truth for earlier turns.** `run_turn(fresh_transcript=True)`
  clears the checkpoint's messages at the start of a new chat turn (never on
  a resume, so approvals still resume). The model now sees the windowed
  database history exactly once; long answers reach it as
  `context_summary`.
- **The model is told the truth about what it can see.** The prompt states the
  window from the `HISTORY_WINDOW` constant; when
  `to_wire_history` drops messages, the context update says how many and
  points at `search_conversation_history`.
- **Chat curates, for free.** Chat passes `CurationPolicy` with `compaction`
  and `indexing` on, `recursiveContext` off (no paid fold on a watched path).
- **User memory keeps "who you are" first.** Caps per category; eviction is
  least recently saved; an exact repeat touches the fact instead of adding a
  copy; rendering cuts on whole lines; agents read but never write.
- **Both system prompts fixed** (charts, modes, questions, dates, untrusted
  sources doubling as data, never instructions).
- **History window clarified everywhere**: `HISTORY_WINDOW = 20` counts
  ChatMessage rows (about 10 exchanges), and
  `chat/tests/test_chat_transcript.py` proves what reaches the provider.

## Decisions worth remembering

- **The database is the source of truth for earlier turns**, because it is
  what the user sees, edits and deletes — and it is where summaries, the
  window, attachments and history search already work.
- **A fresh turn starts from a fresh transcript.** The clear happens on a
  new turn, never on a resume.
- **The checkpoint holds only the current turn.** Never send both copies.
- **Nothing the user said should have to be said again; nothing should be
  paid for twice; the model must be told the truth about what it can
  see** — the three tests every prompt change was checked against.

## Open

- None outstanding.
