"""The "Get started" panel on a connector card, checked before it is stored.

`MCPServer.setup_guide` is data, not code: the web and mobile apps render it,
so its shape is fixed here and nowhere else. Curated rows get their guide from
a migration (`0024_kind_and_setup_guide`), which calls `validate_setup_guide`,
so a bad guide stops the migration rather than reaching a card.

Only the keys below are allowed. An unknown key is refused rather than dropped,
because a typo such as `step` for `steps` would otherwise produce a card with
no steps and no error.
"""

GUIDE_KEYS = frozenset({"you_need", "admin_needed", "cost", "time", "steps", "limits"})
STEP_KEYS = frozenset({"text", "url"})

MAX_LIST_ITEMS = 8
MAX_ITEM_CHARS = 200
MAX_ADMIN_CHARS = 300
MAX_COST_CHARS = 120
MAX_TIME_CHARS = 60
MAX_STEPS = 12
MAX_STEP_TEXT_CHARS = 400
MAX_URL_CHARS = 500


def _text(value, field, *, max_chars, required):
    if not isinstance(value, str):
        raise ValueError(f"{field} must be text")
    text = value.strip()
    if required and not text:
        raise ValueError(f"{field} cannot be empty")
    if len(text) > max_chars:
        raise ValueError(f"{field} is longer than {max_chars} characters")
    return text


def _text_list(value, field):
    if not isinstance(value, list):
        raise ValueError(f"{field} must be a list")
    if len(value) > MAX_LIST_ITEMS:
        raise ValueError(f"{field} can have at most {MAX_LIST_ITEMS} items")
    return [
        _text(item, f"{field} item {n}", max_chars=MAX_ITEM_CHARS, required=True)
        for n, item in enumerate(value, start=1)
    ]


def _admin_needed(value):
    if value is None:
        return None
    # A blank answer means "nobody's permission is needed", the same as null.
    return _text(value, "admin_needed", max_chars=MAX_ADMIN_CHARS, required=False) or None


def _url(value, field):
    if not isinstance(value, str):
        raise ValueError(f"{field} must be text")
    url = value.strip()
    if not url.startswith("https://") or len(url) == len("https://"):
        raise ValueError(f"{field} must start with https://")
    if len(url) > MAX_URL_CHARS:
        raise ValueError(f"{field} is longer than {MAX_URL_CHARS} characters")
    return url


def _steps(value):
    if not isinstance(value, list):
        raise ValueError("steps must be a list")
    if not 1 <= len(value) <= MAX_STEPS:
        raise ValueError(f"steps needs between 1 and {MAX_STEPS} steps")
    steps = []
    for n, step in enumerate(value, start=1):
        if not isinstance(step, dict):
            raise ValueError(f"step {n} must be an object")
        unknown = sorted(str(key) for key in step if key not in STEP_KEYS)
        if unknown:
            raise ValueError(f"step {n} has an unknown field: {unknown[0]}")
        if "text" not in step:
            raise ValueError(f"step {n} needs text")
        clean = {
            "text": _text(step["text"], f"step {n} text",
                          max_chars=MAX_STEP_TEXT_CHARS, required=True),
        }
        if "url" in step:
            clean["url"] = _url(step["url"], f"step {n} url")
        steps.append(clean)
    return steps


def validate_setup_guide(value) -> dict:
    """Return the guide normalised, with every key present, or raise ValueError.

    `{}` is valid and means "no guide". Any other guide must have `steps`; the
    other keys are optional and take their defaults here.
    """
    if not isinstance(value, dict):
        raise ValueError("setup guide must be an object")
    if not value:
        return {}
    unknown = sorted(str(key) for key in value if key not in GUIDE_KEYS)
    if unknown:
        raise ValueError(f"setup guide has an unknown field: {unknown[0]}")
    if "steps" not in value:
        raise ValueError("setup guide needs steps")
    return {
        "you_need": _text_list(value.get("you_need", []), "you_need"),
        "admin_needed": _admin_needed(value.get("admin_needed")),
        "cost": _text(value.get("cost", ""), "cost",
                      max_chars=MAX_COST_CHARS, required=False),
        "time": _text(value.get("time", ""), "time",
                      max_chars=MAX_TIME_CHARS, required=False),
        "steps": _steps(value["steps"]),
        "limits": _text_list(value.get("limits", []), "limits"),
    }
