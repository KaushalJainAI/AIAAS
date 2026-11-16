# `tools_config/`: the Tools page

The user sees this as the Tools page: switch a tool off, or change one of its
limits (for example how many search results it returns). Tools themselves are
code in `chat/tools/`; this app stores only what **you** changed.

**No row means the default.** A fresh install has zero rows and every tool
behaves normally. "Reset to default" deletes the row. A row that matches the
defaults is deleted on save.

This is separate from an agent's grants. A grant decides what *one agent* may
use. This decides what *exists* for your account at all.

## Data (`models.py`)

| Model | What it is |
|---|---|
| `ToolConfig` | One row per (user, tool) you changed |

## Files

| File | What it does |
|---|---|
| `settings_schema.py` | Every tool's settings: integers with a floor, ceiling and default. `LOCKED_TOOLS` cannot be switched off |
| `overlay.py` | Fast read of your changes, cached 60 s. A failed read means nothing is off |
| `serializers.py`, `views.py`, `urls.py` | `/api/tools/`: the catalogue plus your changes |
| `signals.py` | Clears the cache when you change something |

## Rules

- A failed read means nothing is switched off. Never the reverse, or a cache miss strips a running agent's toolbox.
- Enforcement is in `chat/tools/` (`disabled_tools_for`), not here. A switch that nothing reads does nothing.
- A test fails if a declared setting is never read by its tool.

## Tests

`tools_config/tests/test_config.py`.
