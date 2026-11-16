# VFS hardening — record

## Status

**Built 2026-09-26.** Scope: `inference/vfs.py` and the file tools in
`chat/tools/files.py`. Tests: `inference/tests/test_vfs_hardening.py`.

## What it delivered

- **Duplicate names from concurrent writes.** Every write path
  (`write_file`, `write_binary`, `edit_file`, `move`, `copy`) takes a
  `_name_lock(user, folder, name)`: `transaction.atomic()` plus, on
  Postgres, an advisory transaction lock (`pg_advisory_xact_lock`); on
  SQLite the project already runs `IMMEDIATE`, which serialises the section.
  Look-up → decide → create/update happens inside the lock. Residual:
  `write_binary`'s `name (2).ext` fallback is decided after the bytes are
  written — stated in the plan and left alone.
- **Lost updates between writers.** `expected_version` on writes (a
  stale-write guard): mismatch refused, fresh accepted, absent behaves
  exactly as before.
- **`find_files` is faster and more useful** — an index (Postgres-only,
  created in a savepoint; failure is logged and skipped, never blocks a
  deploy) and better result shape.
- **Move / rename / copy** as first-class verbs (`filesystem.move`,
  rename, copy), scope-checked on both ends.
- **Line-addressed reads** — `read_file` with `start_line` / `end_line`
  (1-based, inclusive), still capped by the character window. Character
  `offset` mode is unchanged and remains the default.
- **Case-insensitive folder resolution** — exact first; a single
  case-insensitive match is reused on write and suggested on read
  ("did you mean /Reports/?"); reads do not silently follow another case;
  file names stay exact.
- **Recursive listing** — `list_dir(depth=1..3)` / `list_files(depth)`,
  with a total entry budget and a `truncated` flag.

## Decisions worth remembering

- **No existing behaviour changes for a caller that passes no new
  argument.** Every new parameter is optional.
- **No schema change to `Document`.** A unique constraint was considered
  and rejected — same-named siblings are created by design (uploads, chat
  attachments, Imagine outputs, the eval KB world, `filesystem.move`).
- **Nothing new may widen a scope.** Every new write verb calls
  `_require_write_at` on *both* ends, before touching a row.
- **A migration must never block a deploy** — the only migration is a
  Postgres-only index inside a savepoint; any failure is logged and
  skipped.

## Open

- None outstanding.
