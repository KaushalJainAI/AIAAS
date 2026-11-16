# `skills/`: reusable instructions

The user sees this as a library of named instructions, for example "how to write
a release note". Give one to an agent or use it in chat instead of pasting it
each time. Skills can be shared publicly and forked (copied) by anyone.

## Data (`models.py`)

| Model | What it is |
|---|---|
| `Skill` | A title, a description and the instruction text, owned by one user |

## Files

| File | What it does |
|---|---|
| `services.py` | Finds and loads skills for a user |
| `views.py` | List, create, edit, delete, `search`, `share` (toggle public) and `fork` |
| `serializers.py` | API shape |
| `urls.py` | `/api/skills/` |
| `management/commands/seed_skills.py` | Installs the built-in skills |

## Rules

- Only the owner (or an admin) can edit or delete a skill. Everyone else reads and forks.
- `fork` works only on a skill that is shared or that the caller owns.

## Tests

`skills/tests/test_skills.py`, `skills/tests/test_used_by.py`.
