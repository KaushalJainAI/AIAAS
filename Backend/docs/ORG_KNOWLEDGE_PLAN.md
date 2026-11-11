# Team knowledge — from "a hidden solution store" to "what my team knows"

Status: **built 2026-11-11 (K0–K7), undeployed; not yet checked in a browser.** It builds on
`SOLUTION_MEMORY_PLAN.md` (S0–S4 built 2026-09-28) and does not replace it.
Read that plan's §3 ("The shape") first, then this one.

Who this is for: whoever implements it, including a less capable model.
Every phase lists the files to touch, the exact shapes to add, the tests to
write, and when it counts as done. **Do the phases in order. Do one phase per
branch/PR. Do not start a phase until the previous one's tests pass.**

---

## 0. How to use this document

1. Read §1–§3 once, so you know *why* each change exists.
2. Read §4 (the rules). Breaking one of them is a bug even if every test
   passes.
3. Pick the next unbuilt phase in §6. Do its steps in the order written.
4. After each phase: run its tests, run the whole `solutions` and `core`
   suites, update the docs listed in §8, and mark the phase **built** in the
   status table (§5) with the date.

Commands (from `Backend/`):

```bash
python manage.py makemigrations solutions core inference chat
python manage.py migrate
pytest solutions/tests core/tests/test_orgs.py -q
pytest chat/tests/test_solution_citations.py -q      # added in K1
lint-imports                                          # layer contracts
```

Frontend (from `better-n8n-frontend/`):

```bash
npx tsc -b --force        # plain `tsc --noEmit` checks zero files here
npm run lint              # the baseline is zero problems
npx vitest run
```

Windows note: several files here use CRLF or mixed line endings. Edit them
with an editor tool, never with `sed -i` (it rewrites the whole file as LF).

---

## 1. What the feature is today (verified in the code, 2026-11-11)

| Piece | Where | What it does |
|---|---|---|
| Organisation | `core/models.py::Organization`, `Membership` | A name, `share_by_default`, roles `owner / admin / member` |
| Org operations | `core/orgs.py` | create, update, delete, `add_member` (by email, **no consent**), `set_role`, `remove_member`, `set_active`. Membership is read live on every check |
| Org API | `core/urls.py` → `/api/orgs/...` | list/create, active org, detail, members |
| Solution record | `solutions/models.py::Solution` | problem, symptoms, root cause, resolution, environment, claims (with a freshness kind), phrasings, tags, status `active / needs_check / superseded / retracted`, `shared`, track record |
| Read door | `solutions/access.py::visible` | The only place a reader filters `Solution.objects`. A choke-point test enforces it |
| Writes | `solutions/api.py` | `save`, `review`, `set_shared`, `edit`, `retract`. Scrubs secrets, refuses instruction-shaped text, drops `ephemeral` claims |
| Capture | `solutions/capture.py` | After a thumbs-up (`signals.py`) or "that worked" (regex), a cheap model decides skip / new / same_as / replaces and **saves straight away** |
| Search | `solutions/search.py` | Error signature + keywords + vectors, fused, re-scored by track record, **abstains** below an evidence bar |
| Chat tools | `chat/tools/solutions.py` | `search_solutions`, `get_solution`, `save_solution`, `review_solution`; the org comes from the chat, never from an argument |
| Chat scope | `chat/views.py::_org_fields` | A chat takes the owner's *active* org at creation and keeps it for ever. `share_solutions` is per chat |
| Page | `better-n8n-frontend/src/pages/Solutions.tsx` | Two tabs: Solutions (search, list ≤100, detail with Worked / Didn't work / Doubt / Share / Retract) and Organisation (`components/settings/OrganizationTab.tsx`) |
| Chat UI | `ChatHeader.tsx`, `ChatSettingsDialog.tsx` | A "Sharing with <org> / Private" pill (wide screens only) and a toggle |

---

## 2. Product gaps (the PM view)

Each gap has an id. The phases in §6 say which gaps they close.

### A. Nobody knows it is there, and it starts empty

- **G1 — Starts empty, stays empty.** A solution exists only after someone
  fixes something *in chat* and then gives a thumbs-up or types "that worked".
  A new org has nothing for weeks, and an empty library looks like a broken
  feature. There is no way to bring in what the team already knows (runbooks,
  docs, an old wiki).
- **G2 — No "New solution" button.** `POST /api/solutions/` exists, but the
  page never calls it. A person cannot write a fix down by hand.
- **G3 — Hard to find.** The nav item is "Organisation & Solutions". Creating
  an org is a tab inside the solutions page. Nothing in chat invites you to set
  up a team.
- **G4 — Invisible in chat.** When the assistant uses a colleague's fix, the
  reply may mention it in prose, but there is no chip, no link and no way to
  say "this team fix worked". The user never sees the feature paying off.

### B. Capture is silent, noisy and unreviewed

- **G5 — Silent sharing.** With `share_by_default=True` (the default), an
  automatic capture is shared with the whole org the moment the cheap model
  says "new". The author finds out afterwards from a notification. People do
  not trust what they did not see happen.
- **G6 — No quality gate.** Nobody curates. One wrong or poisoned record
  reaches every member. There is no queue of new entries for a person to
  approve, and no role between "member" and "admin".
- **G7 — Triggers miss real fixes and catch small ones.** People forget the
  thumbs-up. "Fixed it" after a typo fix creates a record nobody needs.
- **G8 — A thumbs-up on an answer that *used* a team fix does not credit that
  fix** unless the cheap model happens to pick `same_as`. The track record
  grows slowly and by luck.

### C. Lifecycle and trust

- **G9 — Editing resets freshness.** `api.edit` sets `valid_as_of=now`, so
  fixing a typo makes a two-year-old claim look freshly checked. That is a
  correctness bug.
- **G10 — No history of edits.** An admin can rewrite a colleague's fix and
  nothing records what changed.
- **G11 — Stale knowledge is labelled but never followed up.** Freshness is
  computed at read time (good), but nobody is asked to re-check. The "check"
  label just accumulates.
- **G12 — `reuse_count` is not reuse.** It goes up whenever a solution is
  *shown* by any search, including someone browsing the page. Any metric
  built on it is wrong.

### D. Value you cannot see

- **G13 — No insight for the team lead.** An owner cannot see how many
  questions were answered from team knowledge, which fixes are used most,
  or which questions found nothing.
- **G14 — Unanswered searches are thrown away.** A search that abstains is
  the most valuable signal the feature has (a knowledge gap). Nothing records
  it.
- **G15 — The list stops at 100**, with no tag, author or status filters
  beyond two checkboxes.

### E. Org mechanics

- **G16 — People are added without consent** (`core/orgs.py::add_member`,
  review item U6). It also tells an admin whether an email has an account.
- **G17 — Last-owner race.** `_owner_count` is read outside a lock; two owners
  leaving at once can leave an org with no owner (U6, second half).
- **G18 — Duplicate captures with several workers.** `_IN_FLIGHT` is
  per-process, so two workers can save the same answer twice (U12).
- **G19 — Capture has no per-user cost cap.** Each thumbs-up is one paid
  platform-key call (U10).
- **G20 — Org is fixed per chat, chosen invisibly.** A person in two orgs
  cannot pick the org when starting a chat; it is whatever "active" was. The
  org badge is hidden on phones.

### F. Scope

- **G21 — "Org knowledge" is only solved problems.** Docs, policies and
  runbooks live in knowledge bases, and a knowledge base can only ever be
  read by its owner. A team cannot share its docs with its own assistant.
- **G22 — Unattended runs see only the personal library.** Schedules,
  triggers and missions cannot use team fixes.

---

## 3. Product goals and how we will know

| Goal | Measure (from K5 insights) | Target 30 days after K3 ships, for an active org |
|---|---|---|
| The library is not empty | solutions per org | ≥ 20 within the first week (import + manual) |
| People trust what is shared | % of shared solutions approved by a person (not auto) | 100% in `curated` orgs |
| It answers questions | chat searches that returned ≥1 result and were cited | ≥ 30% of troubleshooting searches |
| Fixes stay true | shared solutions with a `check` claim older than 30 days | trending down week on week |
| Gaps get filled | unanswered queries turned into solutions | ≥ 1 per week |

Non-goals for this plan: SSO, billing per org, sharing **connections or
credentials**, sharing **agents** (needs its own plan), and merging solutions
into knowledge bases as one store (§7 explains why not).

---

## 4. Rules you must not break

These already hold in the code. Every phase must keep them.

1. **One read door.** A reader gets solutions only through
   `solutions/access.py::visible` / `get_visible`. Never write
   `Solution.objects.filter(...)` in a view, tool or job that serves a reader.
   `solutions/tests/test_isolation.py::ChokePointTests` fails if you do. The
   same rule applies to the new knowledge-base door in K6.
2. **Membership is read live.** Never cache "which orgs is this user in" —
   not in a token, not in a process cache. Use `core/orgs.py::is_member` /
   `role_of` each time.
3. **Unknown and foreign ids get the same 404.** Never return 403 for "exists
   but is not yours"; that tells an attacker it exists.
4. **The org comes from where the work happens**, never from a model's tool
   argument. Chat tools read `context['org_id']`.
5. **Nothing leaves the org it was captured in.** A solution's `org` is fixed
   at creation and never edited.
6. **Scrub before storing, refuse instruction-shaped text.** Every write goes
   through `solutions/api.py::validate`. New write paths (import, publish)
   must call `api.save` / `api.edit`, not create rows themselves.
7. **No write in a tainted turn.** Chat tools already refuse when
   `context['tainted_by']` is set. Keep that for any new tool.
8. **Background work uses `workflow_backend.background.spawn()`**, never
   `asyncio.create_task`.
9. **Function views have no automatic pagination.** Every new list endpoint
   sets its own cap and says `truncated: true` when it cut the list.
10. **Tests live in `<app>/tests/test_<topic>.py`** and import absolutely
    (`from solutions.models import Solution`).
11. **Update `Backend/docs/API.md`** in the same change as any route,
    permission or serializer change.

---

## 5. Phase overview

| Phase | Name | Closes gaps | Size | Status |
|---|---|---|---|---|
| K0 | Fix what is wrong today | G9, G10, G12, G16, G17, G18, G19 | M | built 2026-11-11 |
| K1 | Show it working in chat | G4, G8 | M | built 2026-11-11 |
| K2 | Drafts, sharing on purpose, curators | G5, G6, G7 | L | built 2026-11-11 |
| K3 | Fill it on day one | G1, G2, G3 | M | built 2026-11-11 |
| K4 | Keep it true | G11, G15 | M | built 2026-11-11 |
| K5 | Show the value, find the gaps | G13, G14 | M | built 2026-11-11 |
| K6 | Share knowledge bases with the org | G21 | L | built 2026-11-11 |
| K7 | Choose the org; let schedules use it | G20, G22 | M | built 2026-11-11 |

K0–K5 are about solutions and can ship one after another. K6 is the large
scope change and should be its own PR series. K7 is independent of K6.

---

## 6. Phases

### K0 — Fix what is wrong today

Goal: no new features. Make the existing feature correct and safe, so later
phases do not build on bugs.

#### K0.1 Editing must not reset freshness (G9) and must leave a record (G10)

File: `solutions/api.py`.

1. Add `'edited'` to `REVIEW_KINDS` and to `SolutionReview.KIND_CHOICES` in
   `solutions/models.py` as `('edited', 'Edited')`. (`max_length=14` already
   fits.)
2. Change `edit` to:

```python
def edit(user, solution_id, org_id, draft: Draft, *, verified: bool = False) -> Solution:
    solution = get_visible(user.id, org_id, solution_id)
    if solution is None:
        raise SolutionError('No such solution.', 404)
    if not can_manage(user.id, solution):
        raise SolutionError('Only the author or an org admin can edit this.', 403)
    fields = validate(draft)
    changed = sorted(k for k, v in fields.items() if getattr(solution, k) != v)
    if not changed:
        return solution
    with transaction.atomic():
        if verified:
            fields['valid_as_of'] = timezone.now()
        Solution.objects.filter(id=solution.id).update(**fields)
        SolutionReview.objects.create(
            solution=solution, kind='edited', user=user,
            reason=('Changed: ' + ', '.join(changed))[:500],
        )
    solution.refresh_from_db()
    return solution
```

3. In `solutions/views.py::SolutionDetailView.patch`, pass
   `verified=bool(request.data.get('verified'))` to `api.edit`.
4. Frontend `pages/Solutions.tsx` (edit form added in K3; if there is no edit
   form yet, skip this step and do it in K3): a checkbox "I checked this is
   still true" that sends `verified: true`.

Tests — `solutions/tests/test_api.py`, add:

- `test_edit_keeps_valid_as_of_unless_verified`: save, set `valid_as_of` to
  400 days ago with `.update()`, edit the resolution → `valid_as_of`
  unchanged; edit again with `verified=True` → `valid_as_of` is today.
- `test_edit_records_what_changed`: after an edit, a `SolutionReview` with
  `kind='edited'` exists and its reason names `resolution`.
- `test_edit_with_no_change_writes_nothing`.

#### K0.2 `reuse_count` means "used", not "shown" (G12)

File: `solutions/search.py`.

1. Add a keyword argument `record_use: bool = True` to `search(...)`.
2. Wrap the block that does `reuse_count=F('reuse_count') + 1` in
   `if chosen and record_use:`.
3. In `solutions/views.py::SolutionListView.get`, call
   `search(user_id, org_id, query, limit=20, record_use=False)`.
4. Also pass `record_use=False` from `capture.py::capture_answer` (it searches
   for duplicates; that is not a use).

Test — `solutions/tests/test_search.py`:
`test_page_search_does_not_count_as_use` and
`test_capture_dedupe_search_does_not_count_as_use`.

#### K0.3 One capture per answer, across workers (G18)

1. `solutions/models.py::Solution.Meta.constraints`, add:

```python
constraints = [
    models.UniqueConstraint(
        fields=['source_message_id'],
        condition=models.Q(source_message_id__isnull=False),
        name='unique_solution_per_source_message',
    ),
]
```

2. Migration `solutions/migrations/0002_...`. Before adding the constraint,
   the migration must delete duplicates, or it fails on databases that already
   have them. Add a `RunPython` step **before** `AddConstraint` that, for each
   `source_message_id` with more than one row, keeps the lowest id and sets
   `source_message_id=None` on the others (do not delete rows; they may be
   shared and in use). Reverse function: `migrations.RunPython.noop`.
3. In `solutions/api.py::save`, wrap the `Solution.objects.create(...)` in
   `try/except IntegrityError` (from `django.db`) and raise
   `SolutionError('Already saved from this answer.', 409)`.
4. In `capture.py::capture_answer`, catch that error (status 409) and return
   `{'outcome': 'already_captured'}`.

Test — `solutions/tests/test_capture.py`:
`test_second_save_for_the_same_answer_is_refused` (call `api.save` twice with
the same `source_message_id`; the second raises with status 409, and there is
one row).

#### K0.4 Capture has a daily cap per user (G19)

1. `workflow_backend/settings/base.py`: add
   `SOLUTION_CAPTURE_DAILY_CAP = int(os.environ.get('SOLUTION_CAPTURE_DAILY_CAP', '30'))`
   next to the other `SOLUTION_CAPTURE_*` settings (around line 960; they read
   `os.environ` directly).
2. `solutions/capture.py`, new function:

```python
def _take_capture_slot(user_id: int) -> bool:
    """True if this user may run one more capture today (UTC day)."""
    from django.core.cache import cache
    cap = int(getattr(settings, 'SOLUTION_CAPTURE_DAILY_CAP', 30) or 0)
    if cap <= 0:
        return True
    key = f'solutions:capture:{user_id}:{timezone.now().date().isoformat()}'
    try:
        cache.add(key, 0, timeout=60 * 60 * 26)
        return cache.incr(key) <= cap
    except Exception:  # noqa: BLE001 — a cache failure must not open the tap
        return False
```

3. In `capture_answer`, after the `_exposed` check and before `_extract`,
   `if not await sync_to_async(_take_capture_slot)(user.id): return {'outcome': 'capped'}`.
4. Add the env var to the list in the root `CLAUDE.md` "Environment
   Variables" block and to `Backend/.env.local` if it lists the other
   `SOLUTION_CAPTURE_*` vars.

Tests: `test_capture_stops_at_the_daily_cap` (cap=2 with
`override_settings`, third call returns `capped`, the model stub is called
twice). Call `cache.clear()` in `setUp`.

#### K0.5 Invitations instead of silent adding (G16) and an atomic last-owner guard (G17)

Model — `core/models.py`, new:

```python
class OrgInvite(models.Model):
    """An offer to join an org. Nobody is a member until they accept."""
    org = models.ForeignKey(Organization, on_delete=models.CASCADE,
                            related_name='invites')
    email = models.EmailField()
    role = models.CharField(max_length=10, default='member')   # admin | member | curator (K2)
    invited_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                   null=True, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    accepted_at = models.DateTimeField(null=True, blank=True)
    declined_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=['email', 'accepted_at', 'declined_at'])]
```

Migration `core/migrations/0015_orginvite.py`.

`core/orgs.py` changes:

- Replace `add_member` with `invite(actor, org_id, email, role='member') -> dict`:
  - manager check as today; role must be `admin` or `member` (K2 adds
    `curator`);
  - normalise email (`strip().lower()`); refuse an empty one;
  - if a pending invite (not accepted, not declined, not expired) exists for
    this org + email, return it (idempotent);
  - if that email already belongs to a member, raise
    `OrgError('That person is already a member.')` — this reveals nothing new,
    because the admin can already see the member list;
  - otherwise create the invite with `expires_at = now + 14 days`;
  - **always** return `{'invited': email, 'expires_at': ...}` whether or not an
    account exists, so the endpoint no longer reveals registered emails;
  - if an account with that email exists, call
    `notifications.utils.create_notification(user, 'system', 'Invitation to <org name>', ..., data={'action_url': '/team?tab=organisation'})`.
    (In K3 the page moves to `/team`; until then use `/solutions?tab=organisation`.)
- New `pending_invites_for(user) -> list[dict]`: invites where
  `email__iexact=user.email`, not accepted, not declined, not expired. Each
  item: `{id, org_id, org_name, role, invited_by_name, expires_at}`.
- New `respond(user, invite_id, accept: bool)`:
  - look up the invite with `id=invite_id, email__iexact=user.email`,
    pending; if none, raise `OrgError('No such invitation.', 404)`;
  - **email must be verified**: find how this project records it — search
    `core/` for `EmailAddress` (django-allauth) or `email_verified`. If the
    user's email is not verified, raise
    `OrgError('Verify your email address to accept invitations.', 403)`.
    Write down in this doc (§9) which check you used;
  - on accept: in one transaction, `Membership.objects.get_or_create(org, user,
    defaults={'role': invite.role})` and set `accepted_at`;
  - on decline: set `declined_at`.
- Revoke: `revoke_invite(actor, org_id, invite_id)` for managers (sets
  `declined_at`).
- Last-owner guard: in `set_role` and `remove_member`, do the owner check
  **inside** `transaction.atomic()` with
  `list(Membership.objects.select_for_update().filter(org_id=org_id, role='owner'))`
  and count that list. Move the existing writes into the same transaction.

API — `core/views.py` + `core/urls.py`:

| Method | Path | Body | Answer |
|---|---|---|---|
| POST | `/api/orgs/<id>/members/` | `{email, role}` | **now creates an invite**: 201 `{invited, expires_at}` |
| GET | `/api/orgs/<id>/invites/` | — | managers: pending invites of that org |
| DELETE | `/api/orgs/<id>/invites/<invite_id>/` | — | managers: revoke, 204 |
| GET | `/api/orgs/invites/` | — | the caller's own pending invites |
| POST | `/api/orgs/invites/<invite_id>/` | `{accept: true\|false}` | 200 `{org_id, role}` on accept, 204 on decline |

Keep the same `OrgError → Response({'detail': ...}, status=exc.status)`
pattern the existing org views use.

Frontend:

- `src/api/orgs.ts`: add `listInvites(orgId)`, `revokeInvite(orgId, id)`,
  `myInvites()`, `respondInvite(id, accept)`. Change the `addMember` toast text
  to "Invitation sent".
- `components/settings/OrganizationTab.tsx`: a "Pending invitations" list
  under members (managers only) with a Revoke button; at the top of the tab, a
  card per `myInvites()` item: "<inviter> invited you to <org> as <role>" with
  Accept / Decline.

Tests — `core/tests/test_orgs.py` (add a class `InviteTests`):

- inviting does not create a `Membership`;
- the answer is the same for a registered and an unregistered email;
- accept creates the membership with the invited role; a second accept is 404;
- a user whose email does not match gets 404;
- an expired invite cannot be accepted;
- an unverified email gets 403;
- `test_two_owners_cannot_both_leave` — simulate by calling `remove_member`
  for owner A, then for owner B; the second raises. (A real race test is hard
  in SQLite; the lock is what protects Postgres. Keep this test plus a code
  comment.)

Update `Backend/docs/API.md` for every row above.

**K0 is done when** all the tests above pass, the old `test_orgs.py` tests
that assumed `add_member` creates a membership are updated to go through
invite + accept, and `API.md` is current.

---

### K1 — Show it working in chat (G4, G8)

Goal: when the assistant uses team knowledge, the person sees it and can say
whether it worked.

#### K1.1 Record which solutions a turn used

File: `chat/turn/agent.py`. There is a dict `_SIDE_EFFECTS` (tool name →
handler) next to `_on_file`. Handlers receive `(parsed, args, meta, sink)` and
whatever they put in `meta` is saved on the assistant message's `metadata`
(`chat/turn/pipeline.py`, the function that "stores the assistant's reply"
copies `result.metadata`).

1. `chat/turn/events.py`: add `SOLUTIONS_UPDATE = "solutions_update"` next to
   `FILES_UPDATE`.
2. In `agent.py`, add:

```python
async def _on_solutions(parsed: dict, args: dict, meta: dict, sink: EventSink) -> None:
    """Team solutions the model read this turn → a chip under the answer."""
    if parsed.get("error"):
        return
    rows = parsed.get("results")
    if rows is None and parsed.get("id"):        # get_solution returns one record
        rows = [parsed]
    used = meta.setdefault("solutions_used", [])
    seen = {u["id"] for u in used}
    for row in rows or []:
        if not isinstance(row, dict) or row.get("id") in seen:
            continue
        used.append({
            "id": row.get("id"),
            "problem": str(row.get("problem") or "")[:200],
            "solved_by": row.get("solved_by") or "",
            "last_known_true": row.get("last_known_true"),
            "checks_needed": len(row.get("checks_needed") or []),
            "doubtful": bool(row.get("doubtful")),
        })
        seen.add(row.get("id"))
        if len(used) >= 5:
            break
    await sink(Event.SOLUTIONS_UPDATE, {"solutions": used})
```

3. Register it: `"search_solutions": _on_solutions, "get_solution": _on_solutions,`.
4. Check what `get_solution` returns (read `chat/tools/solutions.py`). If it
   wraps the record (for example `{"solution": {...}}`), unwrap it in the
   handler. Do not guess; read the code.

Important: this records what the model **read**, not what it **cited**.
Label it in the UI as "Team solutions checked", not "Answer based on".

#### K1.2 The chip under the answer

Frontend:

- `src/hooks/useChatStream.ts`: handle the `solutions_update` frame the same
  way `files_update` is handled, keeping `solutionsUsed` on the live turn.
- New `src/components/chat/TeamSolutionsChip.tsx` — props only, no hooks
  that call the API (follow the rule in CLAUDE.md for chat pieces: every
  action is a callback). Props:
  `{items: SolutionUsed[]; orgName?: string; onReview(id, kind: 'confirmed' | 'failed'): void}`.
  Collapsed: "Checked 2 team solutions" (people icon). Expanded: one row per
  item — problem, "by <solved_by>, last checked <date>", a "may be out of
  date" tag when `checks_needed > 0`, a "flagged" tag when `doubtful`, a link
  to `/solutions?id=<id>` and two buttons "Worked" / "Didn't work".
- `ChatMessageItem.tsx` (saved messages) and the live-turn view in
  `StandaloneChat.tsx`: render the chip when
  `message.metadata.solutions_used?.length`.
- `StandaloneChat.tsx` owns the `onReview` handler: it calls
  `solutionsService.review(session.org ?? null, id, kind, '')` and toasts
  "Thanks — recorded". Disable both buttons for that row after one click.
- Add `__tests__` cases to `components/chat/__tests__/chatPieces.test.tsx`
  pinning the arguments `onReview` receives.

#### K1.3 A thumbs-up credits the team fixes it used (G8)

File: `solutions/capture.py`. At the top of `capture_answer`, after loading
the exchange and the membership check, before the model call:

```python
used_ids = [u.get('id') for u in (answer.metadata or {}).get('solutions_used') or []
            if isinstance(u, dict) and u.get('id')]
for sid in used_ids[:5]:
    try:
        await sync_to_async(api.review)(user, org_id, sid, 'confirmed',
                                        reason=f'Used in an answer that worked ({trigger}).')
    except api.SolutionError:
        pass  # no longer visible, retracted, etc.
```

`api.review` already counts a `confirmed` once per person per solution, so
this cannot be inflated. Keep the rest of capture running: the answer may
also contain a *new* fix.

Tests — new file `chat/tests/test_solution_citations.py`:

- the side effect stores `solutions_used` from a fake `search_solutions`
  result, deduplicates ids and stops at 5;
- an `error` result stores nothing;
- `solutions/tests/test_capture.py::test_thumbs_up_confirms_the_solutions_the_answer_used`
  (stub the model to return `skip`; the used solution's `confirmations` goes
  from 0 to 1; running capture again leaves it at 1).

**K1 is done when** a chat that calls `search_solutions` shows the chip live
and after a reload, and the two buttons change the track record on the
solution's page.

---

### K2 — Drafts, sharing on purpose, curators (G5, G6, G7)

Goal: nothing reaches the whole org without a person choosing it, and orgs
that want it can have a person approve each shared entry.

#### K2.1 Two new statuses and two org settings

`solutions/models.py::Solution.STATUS_CHOICES`, add:

- `('draft', 'Draft')` — saved by a model (capture or the tool), waiting for
  its author. Always `shared=False`.
- `('pending_review', 'Waiting for review')` — the author asked to share it in
  a `curated` org. `shared=True`, but hidden from everyone except the author
  and curators until approved.

`CAPTURED_BY`: add `('import', 'Imported from a document')` (used in K3).

Add one field: `share_requested = models.BooleanField(default=False)` — on a
draft, records that the chat's sharing switch was on, so the draft card can
preselect "Share with team".

`core/models.py::Organization`, add:

```python
CAPTURE_CHOICES = [('suggest', 'Suggest, the author decides'),
                   ('auto', 'Save automatically')]
REVIEW_CHOICES = [('open', 'Shared at once'),
                  ('curated', 'A curator approves each one')]
capture_mode = models.CharField(max_length=10, choices=CAPTURE_CHOICES, default='suggest')
review_policy = models.CharField(max_length=10, choices=REVIEW_CHOICES, default='open')
```

Migration for existing orgs: they must keep today's behaviour. In
`core/migrations/0016_...`, use **two operations**: `AddField(capture_mode,
default='auto')` (fills existing rows with `auto`), then
`AlterField(capture_mode, default='suggest')` (new orgs get `suggest`).
`review_policy` defaults to `open` for everyone.

`core/models.py::Membership.ROLE_CHOICES`: add `('curator', 'Curator')`.

`core/orgs.py`:

```python
MANAGERS = ('owner', 'admin')
CURATORS = ('owner', 'admin', 'curator')

def is_curator(user_id, org_id) -> bool:
    return role_of(user_id, org_id) in CURATORS
```

`set_role` and `invite` accept `curator`. `update` accepts `capture_mode` and
`review_policy` (validate against the choices; managers only).

#### K2.2 One function decides a new solution's starting state

`solutions/api.py`, new:

```python
def starting_state(org, *, captured_by: str, share: bool) -> tuple[str, bool]:
    """(status, shared) for a new solution.

    | who saved it            | org.capture_mode | share | review_policy | → status        | shared |
    |-------------------------|------------------|-------|---------------|-----------------|--------|
    | personal chat (no org)  | —                | —     | —             | active          | False  |
    | auto / tool / import    | suggest          | any   | any           | draft           | False  |
    | auto / tool             | auto             | False | any           | active          | False  |
    | auto / tool             | auto             | True  | open          | active          | True   |
    | auto / tool             | auto             | True  | curated       | pending_review  | True   |
    | user (a person clicked) | any              | False | any           | active          | False  |
    | user                    | any              | True  | open          | active          | True   |
    | user                    | any              | True  | curated       | pending_review  | True   |
    """
```

Implement exactly that table (`import` always starts as `draft`). In `save`,
replace `shared=bool(share and org_id)` with the result of
`starting_state(...)`, and set `share_requested=bool(share)` when the status is
`draft`. Load the org with `Organization.objects.filter(id=org_id).first()`
inside `save` (after the membership check).

Copy the table into the docstring — it is the spec, and the tests below test
every row.

#### K2.3 The read door learns the new statuses

`solutions/access.py`:

- `SEARCHABLE` stays `('active', 'needs_check')`. Drafts and pending rows are
  **never** searched — not by chat, not by the page search.
- In `visible`, when `include_inactive=True`, hide `pending_review` rows from
  anyone who is not their author or a curator of that org:

```python
rows = Solution.objects.filter(rule)
if not include_inactive:
    return rows.filter(status__in=SEARCHABLE)
if not (org_id and is_curator(user_id, org_id)):
    rows = rows.exclude(Q(status='pending_review') & ~Q(author_id=user_id))
return rows
```

(Drafts are `shared=False`, so the existing rule already limits them to the
author.)

- `can_manage`: replace `is_manager` with `is_curator`, so curators can edit
  and retract shared solutions. Members of `MANAGERS` still manage people;
  curators do not.

#### K2.4 New write operations

`solutions/api.py`:

- `publish(user, solution_id, org_id, *, share: bool) -> Solution` — the author
  turns their draft into a real entry. Only the author (not curators — it is
  still private). Allowed only from `draft`. Uses `starting_state(org,
  captured_by='user', share=share)`. Adds a review row `kind='edited'` with
  reason "Published from a draft". If the result is `pending_review`, notify
  every curator of the org (see K2.6).
- `approve(user, solution_id, org_id) -> Solution` — curator only, from
  `pending_review` → `active`. Review row kind `'cleared'` with reason
  "Approved for the team". Notify the author.
- `send_back(user, solution_id, org_id, reason: str) -> Solution` — curator
  only, from `pending_review` → `active` with `shared=False` (it stays the
  author's private fix). `reason` required. Review row `'doubt'` with the
  reason; notify the author with the reason.
- `discard(user, solution_id, org_id)` — author only, from `draft` →
  `retracted`. (Keep the row: its `source_message_id` stops the same answer
  being captured again.)
- `set_shared(..., True)` in a `curated` org must go to `pending_review`, not
  straight to shared. Reuse `starting_state`.

Every one of these starts with `get_visible(..., include_inactive=True)` and
returns 404 for anything not visible.

#### K2.5 Routes

`solutions/urls.py` + `solutions/views.py` (keep the `_org_param` and
`_refused` helpers):

| Method | Path | Body | Who |
|---|---|---|---|
| POST | `/api/solutions/<id>/publish/` | `{org, share}` | author of a draft |
| POST | `/api/solutions/<id>/discard/` | `{org}` | author of a draft |
| POST | `/api/solutions/<id>/approve/` | `{org}` | curator |
| POST | `/api/solutions/<id>/send-back/` | `{org, reason}` | curator |
| GET | `/api/solutions/?status=draft` | — | your drafts in that scope |
| GET | `/api/solutions/?status=pending_review` | — | curators: the queue; authors: their own |

Extend the `state in (...)` check in `SolutionListView.get` to accept `draft`
and `pending_review`. Default listing (no `status`) must **exclude** `draft`
and `pending_review` so the main list is the real library.

`core` org PATCH accepts `capture_mode`, `review_policy`.

#### K2.6 Notifications (and limits)

Use `notifications.utils.create_notification(user, 'system', title, message,
data={'action_url': ...}, send_email=False)` as `capture._tell` does.

- Capture saved a **draft**: change `_tell` so the message reads
  "We drafted a team solution from your chat: '<problem>'. Review it to share
  or discard." with `action_url` `/solutions?id=<id>`.
- New `pending_review` entry: one notification per curator. To avoid flooding,
  skip the notification if that curator already has an **unread**
  notification whose `data.kind == 'solution_review_queue'` for this org; put
  `kind` and `org_id` into `data`.
- Approved / sent back: notify the author.

#### K2.7 The draft card in chat

Capture runs after the reply has streamed, so it cannot add a frame to that
stream. Instead:

1. In `capture_answer`, when the saved status is `draft`, also write
   `metadata['solution_draft'] = {'id': ..., 'problem': ..., 'share_requested': ...}`
   onto the **answer** `ChatMessage` (read its metadata, add the key, save
   with `update_fields=['metadata']`).
2. Frontend `ChatMessageItem.tsx`: when `metadata.solution_draft` is present
   and the draft has not been acted on, show a small card: "Save this fix for
   your team?" with three buttons — **Share with <org>** (preselected if
   `share_requested`), **Keep private**, **Discard** — calling the K2.5
   routes. After a click, the card shows the outcome ("Shared", "Waiting for
   a curator", "Kept private", "Discarded") and stays that way: store
   `metadata.solution_draft.resolved = '<outcome>'` server-side by having the
   publish/discard views update the message (look it up by the solution's
   `source_message_id`, owned by the same user).
3. The card appears when the message list is next fetched. To make it appear
   without a reload, find how the frontend learns of new notifications (search
   `src/hooks` and `src/lib` for `notifications`); when one arrives whose
   `data.action_url` starts with `/solutions?id=`, invalidate the open chat's
   messages query. If there is no live notification channel, the card on
   reload is acceptable — say so in §9.

#### K2.8 The page

`pages/Solutions.tsx`:

- New tabs (after K3 renames the page, see K3.4): **Library** (default),
  **My drafts** (count badge), **Review queue** (curators only, count badge).
- A draft's detail view: editable fields (same form as K3.1) plus Share /
  Keep private / Discard.
- A queue item's detail view: Approve, and Send back with a required reason.
- `OrganizationTab.tsx`: two settings for managers — "When a fix is found in
  chat: Suggest it to the author (recommended) / Save automatically" and "Who
  can share with the whole team: Anyone, at once / A curator approves each
  one". Role picker gains **Curator** with the helper text "Approves and edits
  team solutions; cannot manage people."

Tests — `solutions/tests/test_workflow.py` (new):

- one test per row of the `starting_state` table;
- a draft is not returned by `search` for its author, and not visible at all
  to another member;
- a `pending_review` row is visible to its author and a curator, invisible to
  another member (list and detail both 404), and not searchable by anyone;
- `approve` by a member → 404-or-403 as the existing code does for
  `can_manage` failures (403 is fine here, because the caller *can* see the
  row); by a curator → `active` and searchable by every member;
- `send_back` without a reason is refused; with one, the row is private
  `active` and the author is notified;
- `publish` by someone other than the author → 404;
- `discard` keeps the row and blocks re-capture of the same answer;
- `set_shared(True)` in a curated org → `pending_review`;
- a curator can edit and retract a shared solution; a curator cannot change
  roles (`core/tests/test_orgs.py`).

Add `test_isolation.py` cases: a curator of org A sees nothing of org B's
queue.

**K2 is done when** a new org's chat produces a draft card instead of a
shared row, a curated org routes every share through the queue, and existing
orgs behave exactly as before (they were migrated to `capture_mode='auto'`,
`review_policy='open'`).

---

### K3 — Fill it on day one (G1, G2, G3)

#### K3.1 Write a solution by hand

The API exists (`POST /api/solutions/`). Build the form.

- New `src/components/solutions/SolutionForm.tsx`: fields problem (required,
  ≤500), symptoms, root cause, resolution (required), tags (comma list),
  environment (key/value rows, ≤12), and a "Share with <org>" checkbox when a
  scope org is selected. Claims are optional: an "Advanced" disclosure lets the
  user add rows of `{text, kind}` with `kind` from a select of the six kinds
  in `solutions/freshness.py` (read that file for the list and the
  plain-language meaning; show the meaning as helper text).
- The same form is the edit form (PATCH) and the draft-review form (K2.8).
  On edit, show the "I checked this is still true" checkbox (K0.1).
- A **New solution** button at the top of the Library tab.
- Show server refusals (`detail`) under the form — they are written for
  people.

#### K3.2 Import solutions from a document

Backend — new module `solutions/importer.py`:

```python
MAX_CHUNKS = 20
CHUNK_CHARS = 12_000
MAX_PER_CHUNK = 10

async def import_document(user_id: int, org_id: int | None, document_id: int) -> dict:
    """Extract solutions from one of the user's documents, saved as drafts."""
```

Steps inside:

1. Load the document **only if the user owns it and it is not trashed**:
   `Document.objects.filter(id=document_id, user_id=user_id).first()`
   (`Document` uses a live manager, so trashed rows are excluded). If none,
   return `{'outcome': 'not_found'}`.
2. Take `content_text`; if empty, return `{'outcome': 'no_text'}` (binary
   files with no extracted text).
3. Refuse a document that reads as instructions to an AI
   (`core.safety.provenance.instruction_shaped` over the first 50k chars) →
   `{'outcome': 'exposed'}`.
4. Split into chunks of `CHUNK_CHARS` on paragraph boundaries (split on
   `\n\n`, pack paragraphs until the next one would overflow); keep at most
   `MAX_CHUNKS`.
5. For each chunk, one cheap-model call (reuse `capture._model_choice()` and
   `llm.access.complete(..., effort='none', temperature=0.0)`), with a prompt
   asking for a JSON list of up to `MAX_PER_CHUNK` solutions, each in the same
   shape as `capture.PROMPT`'s object minus `decision`/`existing_id`. Tell the
   model: only problems with a concrete fix; never secrets or personal
   details; return `[]` if none.
6. For each extracted item: run `search(user_id, org_id, problem,
   limit=1, record_use=False)`; if the top hit's `match` is
   `'error signature'` or `evidence.similarity >= 0.85`, skip it as a
   duplicate. Otherwise `api.save(user, org_id=org_id, share=False,
   draft=..., captured_by='import')` (→ `draft` by K2.2), then
   `await api.aindex(solution.id)`. Catch `SolutionError` per item and count it.
7. Charge the tokens: there is no chat session here. Add them to the user's
   profile usage the way other platform-key jobs do — search for
   `total_tokens_used` in `core/models.py`; if a per-user counter exists, add
   to it; if not, log the total with `[Solutions] import tokens=` and note it
   in §9.
8. Notify the user: "Imported N draft solutions from '<file name>'. Review
   them to share." with `action_url` `/solutions?tab=drafts`.
9. Return `{'outcome': 'done', 'drafts': n, 'duplicates': d, 'refused': r}`.

Limits: at most 5 imports per user per day (same cache-counter pattern as
K0.4, key `solutions:import:...`, setting `SOLUTION_IMPORT_DAILY_CAP=5`).

Route: `POST /api/solutions/import/` with `{org, document_id}` → check the
daily cap (429 with a sentence if over), check membership if `org`, then
`spawn(import_document(...))` and answer **202** `{started: true}`. The view
is sync (APIView); use `workflow_backend.background.run_in_thread` the way
`solutions/signals.py::_start_capture` does when there is no running loop.

Frontend: on the Library tab, an **Import from a document** button opening the
existing file picker component (search `src/components/files` for a picker
used elsewhere, e.g. by the chat attach button) filtered to text-bearing types
(md, txt, docx, pdf). After 202, toast "Importing — you'll get a notification
when the drafts are ready."

Tests — `solutions/tests/test_import.py` (stub the model):

- someone else's document id → `not_found` and no model call;
- a document with two fixes → two `draft` rows with `captured_by='import'`,
  both `shared=False`;
- a duplicate of an existing solution is skipped;
- a chunk whose output contains an instruction-shaped resolution is refused
  by `api.validate` and counted, not saved;
- the daily cap returns 429 on the sixth call.

#### K3.3 An empty state that teaches

When the Library has zero solutions in the selected scope, replace the empty
list with three cards: **Write one** (opens K3.1), **Import from a document**
(K3.2), **Solve something in chat** ("When a fix works, give the answer a
thumbs-up — we'll draft it for you"). When the user has no org, a fourth card
**Create a team** linking to the Organisation tab.

#### K3.4 Rename and re-home the page

- Route: add `/team` rendering the same page; keep `/solutions` working (do
  not delete it — notifications already link there). In `App.tsx`, add the
  new lazy route next to the existing one.
- `src/lib/navigation.ts`: label "Team knowledge", path `/team`.
- Tabs: **Library · My drafts · Review queue · Insights (K5) · Team**
  (`?tab=library|drafts|queue|insights|team`). Map the old
  `?tab=solutions` → `library` and `?tab=organisation` → `team`.
- Update every `action_url` the backend writes for solutions to the new path
  only after the route exists; keep the old ones resolving.

**K3 is done when** a brand-new org can reach 20 solutions in ten minutes
without using chat, and nothing it imports is shared until a person shares it.

---

### K4 — Keep it true (G11, G15)

#### K4.1 A "Needs attention" view

Backend: `GET /api/solutions/?attention=1&org=<id>`. In `SolutionListView.get`:

1. Start from `visible(user_id, org_id, include_inactive=True)` filtered to
   `status in ('active', 'needs_check')`.
2. If the caller is a curator of the org: all shared rows plus their own
   private ones. Otherwise only rows they authored.
3. Load at most 500 rows (`[:500]`), then keep rows where any of:
   `status == 'needs_check'`, `doubtful`, or any claim whose
   `freshness.claim_state(kind, valid_as_of) == 'check'`.
4. Sort: `needs_check` first, then doubtful, then oldest `valid_as_of`.
5. Return with `truncated` if 500 rows were loaded.

Frontend: a filter chip "Needs attention (N)" on the Library tab. Each row
offers **Still true** (`review kind='verified'`), **Edit**, **Retract**.

#### K4.2 A weekly nudge

1. New function `solutions/stale.py::run_stale_sweep() -> dict`: for each org,
   for each author of shared `active`/`needs_check` solutions that need
   attention (same rule as K4.1), send one notification "N of your team
   solutions may be out of date" → `/team?tab=library&attention=1`. Curators
   get one summary per org. Skip anyone who received this notification in the
   last 6 days (put `data.kind = 'solution_stale_digest'` and check for a
   recent one). Personal (no-org) solutions: one notification to the author,
   same rule.
2. Register it as a periodic job. Read `agents/scheduler.py` (`PERIODIC_JOBS`,
   `NOT_IN_PROCESS`) and `CELERY_BEAT_SCHEDULE` in `settings/base.py`; add a
   beat entry `solutions.sweep_stale` (weekly, 7 days in seconds, setting
   `SOLUTION_STALE_SWEEP_SECONDS=604800`) and the matching `PERIODIC_JOBS`
   entry. `agents/tests/test_scheduler.py::PeriodicJobTests` fails if a beat
   entry is in neither table — that is the check that you did both.
3. A `manage.py solutions_stale_sweep` command calling the same function (the
   project gives every sweep a command for local dev without Redis).

Tests — `solutions/tests/test_stale.py`: a stale shared row notifies its
author once; a second run within 6 days sends nothing; a fresh row sends
nothing; a removed member gets nothing about that org.

#### K4.3 Better list filters (G15)

`SolutionListView.get` accepts `tag=<tag>`, `author=me`, and `offset`
(integer, default 0; clamp to ≥0). Use `rows[offset:offset+LIST_LIMIT]` and
return `next_offset` when more exist. Tags are a JSON list; on SQLite
`tags__contains` does not work, so filter in Python over at most 2,000 rows
and say so in a comment — or skip the tag filter on SQLite. Pick one and note
it in §9.

Frontend: tag chips (clicking a tag filters), "Only mine", and a
"Load more" button using `next_offset`.

---

### K5 — Show the value, find the gaps (G13, G14)

#### K5.1 Record searches

`solutions/models.py`, new:

```python
class SolutionSearchLog(models.Model):
    """One search, for the team's insight page. Scrubbed, short, short-lived."""
    org = models.ForeignKey('core.Organization', on_delete=models.CASCADE,
                            null=True, blank=True, related_name='+')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                             null=True, related_name='+')
    source = models.CharField(max_length=8)        # 'chat' | 'page'
    query = models.CharField(max_length=300)       # api.scrub(...)[:300]
    result_count = models.SmallIntegerField(default=0)
    top_solution_id = models.IntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        indexes = [models.Index(fields=['org', '-created_at'])]
```

Write it from `search()` via a new keyword `log_source: str | None = None`
(the chat tool passes `'chat'`, the page view passes `'page'`, capture and
import pass nothing and are not logged). Write with
`SolutionSearchLog.objects.acreate(...)` inside `try/except` — logging must
never fail a search. Personal-scope searches (`org_id=None`) are not logged
(there is no team to show them to).

Retention: delete rows older than 90 days in the K4.2 weekly sweep. Add one
line to `Backend/docs/SAFETY_AND_GUARDRAILS.md` under retention: "Team
knowledge search log: scrubbed queries, curators only, 90 days."

#### K5.2 The insights endpoint

`GET /api/solutions/insights/?org=<id>` — curators only (404 for a
non-member, 403 for a member who is not a curator). Last 30 days:

```json
{
  "searches": 0, "answered": 0, "unanswered": 0,
  "solutions": {"active": 0, "needs_attention": 0, "drafts": 0, "pending_review": 0},
  "contributors": [{"name": "", "count": 0}],
  "top_used": [{"id": 0, "problem": "", "uses": 0}],
  "gaps": [{"query": "", "times": 0, "last_asked": ""}]
}
```

- `answered` = logs with `result_count > 0`.
- `top_used`: count `top_solution_id` over chat logs, top 10, then load
  problems **through `visible(...)`** (rule 1) and drop ids no longer visible.
- `gaps`: chat logs with `result_count = 0`, grouped by
  `query.lower().strip()`, top 10 by count. Never show who asked — only the
  query text and counts.
- `contributors`: authors of shared active solutions created in the window,
  top 10 by count, using `author_name`.

#### K5.3 The Insights tab

Curators only. Four stat tiles (searches, answered %, active solutions, needs
attention), a "Most used" list linking to each solution, and a "Questions
nobody has answered yet" list where each row has **Write the answer** — it
opens the K3.1 form with `problem` prefilled from the query.

Tests — `solutions/tests/test_insights.py`: a member who is not a curator is
refused; gaps never include another org's queries; `top_used` drops a
retracted solution; personal searches are not logged.

---

### K6 — Share knowledge bases with the org (G21)

This is the biggest change: knowledge bases (`inference/models.py::KnowledgeBase`)
are owned by one user, and **many** code paths read them with
`KnowledgeBase.objects.filter(user_id=...)`. Do it as its own PR series.
Read `inference/README.md`, `chat/tools/knowledge.py` and the CLAUDE.md
paragraph "A knowledge base an agent may search is a scope, not a label"
before starting.

Scope of K6: **read** sharing only. A shared KB is still owned and edited by
its owner. Members can search and read it in chat and in agents that run from
an org chat. Uploading into someone else's KB is out of scope.

#### K6.1 Model

`KnowledgeBase`, add:

```python
org = models.ForeignKey('core.Organization', on_delete=models.SET_NULL,
                        null=True, blank=True, related_name='knowledge_bases')
shared_with_org = models.BooleanField(default=False)
```

Migration `inference/migrations/0026_...`. Only the owner can set `org` (to an
org they are a member of) and `shared_with_org`. A curator of that org may
turn `shared_with_org` off (unshare), never on.

#### K6.2 One read door

New `inference/kb_access.py`:

```python
def readable_kbs(user_id, org_id) -> QuerySet:
    """KBs this user may read from a context in org_id (None = personal):
    their own (minus hidden eval KBs), plus the org's shared ones while
    they are a member — membership read live."""

def get_readable_kb(user_id, org_id, kb_id):
    """One KB or None; unknown and foreign ids are indistinguishable."""
```

Exclude hidden eval KBs exactly as `inference/models.py::visible_knowledge_bases`
does (`name__startswith=HIDDEN_KB_PREFIX`) — for the org part too.

Writes (upload, delete, rename, re-index) keep using the owner check. Do not
route writes through this door.

#### K6.3 Route every read through it

1. Find every read: search the backend for `KnowledgeBase.objects` and
   `knowledge_base__user` and `kb.user` outside migrations and tests. Make a
   list in §9 with file:line before changing anything.
2. For each **read** that serves chat or an agent run, replace the user filter
   with `readable_kbs(user_id, org_id)` / `get_readable_kb(...)`. The org comes
   from the turn: `context['org_id']` in tools (already set for solutions —
   reuse it), `TurnContext.org_id` elsewhere.
3. `chat/tools/knowledge.py` lines that currently read
   `KnowledgeBase.objects.filter(user_id=user_id)` (around lines 72, 154 and
   173 as of 2026-11-11) are the first three.
4. `read_document` addresses a **document** id. It must check that the
   document's KB is readable (`get_readable_kb(user_id, org_id, doc.knowledge_base_id)`),
   not that the user owns the document.
5. The retrieval engine (`inference/engine.py`, `inference/backends/`): check
   whether any query filters by user. If an index is keyed by KB id only,
   nothing changes there; if it filters by user, pass the KB's owner id, not
   the reader's. Write down what you found in §9.
6. Agents: `kb_scope_for` and the serializer's `validate_knowledgeBases`
   (`agents/config.py`) must accept a shared KB only when the agent is used
   from that org. Simplest safe rule for K6: **agents keep using only their
   owner's own KBs**; org KBs are for chat. Note it as a follow-up.
7. Add a choke-point test like `solutions/tests/test_isolation.py::ChokePointTests`:
   fail if `KnowledgeBase.objects` appears in `chat/tools/` outside
   `kb_access.py` callers.

#### K6.4 API and UI

- `PATCH /api/inference/knowledge-bases/<id>/` (find the real route in
  `inference/urls.py`) accepts `{org, shared_with_org}` from the owner.
- `GET` KB list gains `?org=<id>` → owner's KBs plus that org's shared KBs,
  each with `is_mine` and `owner_name`.
- Knowledge base page: a "Share with <org>" toggle on KBs you own; a "Team"
  section listing shared KBs (read-only, no upload/delete buttons).
- The Team knowledge page (K3.4) Library tab gains a second list: "Team
  documents" (shared KBs) — so "what my team knows" is one place.

Tests — `inference/tests/test_kb_sharing.py`:

- a member reads a shared KB through `knowledge_base_search` in an org chat;
- the same member, in a **personal** chat, cannot;
- a removed member cannot, on the next call;
- a member of org B cannot read org A's shared KB by id (same answer as an
  unknown id);
- `read_document` on a document in a shared KB works for a member and
  returns the same error as an unknown id for a non-member;
- a member cannot upload into or delete from someone else's shared KB;
- an eval world's hidden KB can never be shared or read through the door.

---

### K7 — Choose the org; let schedules use it (G20, G22)

#### K7.1 Pick the org when starting a chat

- `chat/views.py::_org_fields(user, data)`: if `data` contains `org`
  (an id or `null`), use it **only after** `core.orgs.is_member(user.id,
  org)`; a non-member id is a 400 "You are not in that organisation." `null`
  means a personal chat. Without `org`, keep today's behaviour (active org).
  `org` stays read-only on update — it is chosen once.
- Frontend: the "New chat" control gets a small org menu (only when the user
  is in at least one org): Personal / <org names>, defaulting to the active
  org. The chat header shows the org name on all widths (on phones, an icon
  with the name in its title/aria-label).

Tests — `chat/tests/test_session_org.py`: creating with a member org works;
with a non-member org is 400; with `null` is personal; updating `org` is
ignored.

#### K7.2 Schedules and missions may use one org's knowledge

Today runs started by a schedule, trigger or mission see only the personal
library (CLAUDE.md, "What an organisation solved stays in that
organisation").

- Add an optional `agent_context['orgId']` to `SubAgent` config, validated in
  `agents/config.py::AgentSerializer` (the owner must be a member; `null`
  clears it). Add it to the closed key set there and to the builder.
- In `agents/agent/runtime.py`, where the run's org is decided (search for
  `_remember_org`), when the run has no org from a chat and the agent has
  `orgId`, use it **only if `is_member(owner, orgId)` at run start and on
  every resume** — the existing live re-check applies.
- Unattended runs **read** team knowledge only: in `chat/tools/solutions.py`,
  refuse `save_solution` when the caller is in `UNATTENDED_CALLERS` (from
  `agents/grants.py`) with "Unattended runs can read team solutions but not
  add them." Read the caller from the tool context; check what key holds it.
- Builder UI: a "Team knowledge from" select in the agent's context section.

Tests — `agents/tests/test_run_org.py` (exists — add cases): a scheduled run
with `orgId` searches that org; after the owner leaves the org, the next run
has no org and no error; `save_solution` is refused in a trigger run.

---

## 7. Decisions taken in this plan (and why)

1. **Keep solutions as their own store; do not fold them into knowledge
   bases.** A solution has a lifecycle a document does not: track record,
   freshness per claim, supersession, curation. K3 and K6 still put both under
   one "Team knowledge" page, so users see one place.
2. **Draft by default for new orgs** (`capture_mode='suggest'`). It costs one
   click per fix and buys trust. Existing orgs are migrated to `auto` so
   nobody's behaviour changes without them choosing it.
3. **Invitations, not adding.** Consent matters more than convenience here,
   and the invite answer no longer reveals which emails have accounts.
4. **A `curator` role**, not just admins, because the person who knows the
   content is often not the person who manages membership.
5. **Search logs are scrubbed, org-only, curator-only, 90 days.** Gaps are
   the most useful signal the feature has; who asked is not needed to act on
   it, so it is never shown.
6. **K6 is read-only sharing and chat-only.** Agents using org KBs, and
   members writing into shared KBs, are follow-ups; each widens access and
   deserves its own review.

## 8. Docs to update with each phase

- `Backend/docs/API.md` — every new or changed route (rule 11).
- `Backend/solutions/README.md` — new files (`importer.py`, `stale.py`),
  new statuses and the `starting_state` table.
- `Backend/core/README.md` — invites, the curator role.
- Root `CLAUDE.md` — extend the paragraph "What an organisation solved stays
  in that organisation" with one short paragraph per phase, dated; add new env
  vars (`SOLUTION_CAPTURE_DAILY_CAP`, `SOLUTION_IMPORT_DAILY_CAP`,
  `SOLUTION_STALE_SWEEP_SECONDS`) to the Environment Variables block.
- `Backend/docs/SAFETY_AND_GUARDRAILS.md` — invites (consent), the search log
  retention (K5), KB sharing (K6).
- `Backend/docs/README.md` — move this plan between "in progress" and "built".
- `better-n8n-frontend/BEGINNER_GUIDE.md` — the `/team` page.
- This file — the status table in §5 and the notes in §9.

## 9. Implementation notes (fill in while building)

Write here anything a phase asked you to decide or check, with the date:

- K0.5 — email verification is `UserProfile.email_verified_at` (allauth's
  `ACCOUNT_EMAIL_VERIFICATION` is `none`). Signup does not set it; Google
  sign-in, a password reset or OTP change, and an email change do. Accepting an
  invitation needs it; declining does not.
- K2.7 — no live refresh: the draft card appears on the next load of the chat.
  The Topbar polls notifications every 30 s; wiring a chat reload to it was
  left out.
- K2 — added a `replaces` FK, so a correction saved as a draft retires the old
  fix only when it goes live. Approval is recorded as review kind `cleared`.
- K3.2 — import tokens are added to `core.UsageTracking.tokens_used` (per user
  per day) and logged as `[Solutions] import tokens=`.
- K4.3 — tag filter runs in Python over the newest 2,000 rows on every
  database; `tag_scan_capped` says when the library is larger.
- K5 — the insight tiles count chat searches only; page browsing is logged
  (`source='page'`) but not counted.
- K6.3 — chat reads go through `inference/kb_access.py`
  (`chat/tools/knowledge.py`: list, `_resolve_kb`, `read_document`). Agent runs,
  the builder and gallery pickers, publishing, uploads, ingest, reindex and the
  `/rag/` endpoints stay owner-only. Agent runs are told apart from chat by
  `execution_id` (`chat_org_id`).
- K6.3 — retrieval does not filter by user: the HNSW index and the full-text
  index are keyed by KB id, so sharing needed no engine change.
- K7.1 — the org picker sits on the empty new-chat screen (ChatHeader), not on
  the sidebar's New chat button.
- K7.2 — the agent's `orgId` applies to runs not started from a conversation
  (trigger, mission, Run button). Runs from chat or a delegating orchestrator
  keep the chat's org, or stay personal. Unattended callers may not
  `save_solution` or `review_solution`.
- Notification links carry `&org=` (`solutions/api.py::page_link`), and the
  notification list now parses a link's base path up to `/`, `?` or `#`.

## 10. Later (not in this plan)

- Sharing agents with an org (roles "builder"/"runner", one door per object —
  see `APP_FLOW_GAP_REVIEW.md` §"What I understand today").
- Agents reading org knowledge bases (after K6).
- Topic owners: tags mapped to people who get the stale nudges for that tag.
- The S5 benchmark suite from `SOLUTION_MEMORY_PLAN.md` (retrieval set +
  100%-bar isolation guardrails) — worth doing right after K2, because K2
  changes what is searchable.
- Export an org's knowledge (JSON) before deleting an org.
