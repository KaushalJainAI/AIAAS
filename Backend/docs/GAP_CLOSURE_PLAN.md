# Gap Closure

**Status:** built (2026-09-24). All four phases landed. The Code tab (§3.3) was deferred on purpose and is still not built.

A codebase-wide sweep found wiring that was right, a test suite that failed only in full runs, lint that had slipped, and built capabilities with no screen. This plan closed them in four phases.

## What it delivered

- **Email is digest-only by default.** `NOTIFICATIONS_EMAIL_ENABLED` defaults to `False` (`workflow_backend/settings/base.py`). Chat approvals and eval reviews pass `send_email=False`. `notifications/tests/test_email_policy.py` scans every `create_notification(` call and fails if one can email outside the digest and user reminders.
- **Packs say whether they can run.** `agents/views/capabilities.py` has one predicate (`engine_live`, `unavailable_grants`). Gallery listings carry `available` and `unavailable_reason`. Installs of an engine-blocked template answer 409. Explore shows "Not available on this server" and disables install.
- **Polluter fixed.** Registering `/search` as a slash command changed the intent path for any test that imported it. Fixed by pinning `intent="search"` in `chat/commands/web.py`.
- **Lint back to zero** (the sweep found 6 errors) and **tsc clean**, both checked at implementation.
- **Memory tab**: Settings → Memory (`components/settings/MemoryTab.tsx`, `api/memory.ts`, `lib/memory.ts`). Lists facts by category, per-fact delete, clear all.
- **Missions page**: built as `pages/Missions.tsx` at `/missions`. Later folded into Activity. `/missions` now redirects to `/runs` (see `ACTIVITY_PAGE_PLAN.md`).
- **Reminder cancel**: a 404 on cancel closes the dialog, refreshes the list and says the reminder already fired (`ScheduledReminders.tsx`).
- **Docs**: CLAUDE.md's four drift claims were corrected (`/dashboards` exists, `reviewAgent` retired, `shell` no longer unserved, email default).

## Decisions worth remembering

- **A pack that cannot run is shown as such, not installed.** A Code pack on a default server cannot install and says why. One predicate serves both the listing and the install route, so they cannot disagree.
- **Partial pack installs skip the blocked members.** Only a pack where every setup-free member is blocked answers 409.
- **Fix the polluter, not the victims.** Six of the ten order-dependent failures could not be reproduced on any in-order prefix. Two clean full-suite runs were the test, not a theory about each one.

## Open

- §3.3 Code tab: no HTTP route creates a `CodeProject`. Blocked on a real workspace engine (`COMPUTE_ISOLATION_PLAN.md`). The install badge is the stopgap.
- Out of scope, still true: a real workspace, browser or e-sign engine (other plans own them), and paid benchmark runs.
