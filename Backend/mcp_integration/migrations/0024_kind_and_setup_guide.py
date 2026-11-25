"""Connector kind and the Get started panel (Phase 9a of CONNECTOR_CATALOGUE_PLAN).

`kind` says which engine runs a card; `type` stays the transport, so a native
card keeps its `type='native'` and gains `kind='native'`. `setup_guide` is the
panel the web and mobile apps show before a person connects: what they need,
the steps, and the limits. The shape is checked by `setup_guide.py`.

Data: every native row is marked `kind='native'`. Each enabled curated row gets
its guide here, matched by name, and the validator runs inside the migration,
so a guide that does not pass stops the deploy instead of reaching a card.
Disabled curated rows keep an empty guide; nothing shows them. Reversing drops
the two columns and leaves the data alone, which is the only reverse there is.
"""
from django.db import migrations, models

from mcp_integration.setup_guide import validate_setup_guide

_GOOGLE_LIMIT = (
    "If it stops working after about a week, click Connect again. Google "
    "expires sign-ins for apps still in Testing status."
)


def _google_guide(step):
    return {
        "you_need": ["A Google account"],
        "cost": "Free",
        "time": "1 minute",
        "steps": [
            {"text": "Click Connect."},
            {"text": "Sign in with your Google account."},
            {"text": step},
        ],
        "limits": [_GOOGLE_LIMIT],
    }


_NOTION_GUIDE = {
    "you_need": ["A Notion workspace"],
    "steps": [
        {
            "text": "Create an internal integration at notion.so/my-integrations.",
            "url": "https://www.notion.so/my-integrations",
        },
        {"text": "Copy the integration's token."},
        {
            "text": (
                "Share each page or database you want AIAAS to see: open it, "
                "click the ••• menu, then Connections, and add the integration."
            ),
        },
        {"text": "Click Connect on this card and paste the token."},
    ],
    "limits": ["Notion reports pages that are not shared with the integration as not found."],
}

# Curated card name -> guide. Each guide is checked by the validator when the
# migration runs, so a typo here fails loudly rather than shipping.
_GUIDES = {
    "Gmail": _google_guide(
        "Allow AIAAS to read, draft, send and label your email.",
    ),
    "Google Drive": _google_guide(
        "Allow AIAAS to find and read your Drive files, and create new ones.",
    ),
    "Google Sheets": _google_guide(
        "Allow AIAAS to read and write your spreadsheets.",
    ),
    "Google Calendar": _google_guide(
        "Allow AIAAS to read your calendar, and create, change and cancel events.",
    ),
    "Google Docs": _google_guide(
        "Allow AIAAS to read your documents, and create or add to them.",
    ),
    "Notion": _NOTION_GUIDE,
}


def _set_kind_and_guides(apps, schema_editor):
    MCPServer = apps.get_model("mcp_integration", "MCPServer")

    MCPServer.objects.filter(type="native").update(kind="native")

    for name, guide in _GUIDES.items():
        checked = validate_setup_guide(guide)
        MCPServer.objects.filter(
            name=name, user__isnull=True, enabled=True,
        ).update(setup_guide=checked)


class Migration(migrations.Migration):

    dependencies = [
        ('mcp_integration', '0023_tool_pins'),
    ]

    operations = [
        migrations.AddField(
            model_name='mcpserver',
            name='kind',
            field=models.CharField(
                choices=[
                    ('mcp', 'Hosted MCP server'),
                    ('native', 'Built-in tools'),
                    ('api', 'API card'),
                    ('sql', 'Database'),
                ],
                default='mcp',
                help_text='Which engine runs this connector. `type` stays the transport.',
                max_length=8,
            ),
        ),
        migrations.AddField(
            model_name='mcpserver',
            name='setup_guide',
            field=models.JSONField(
                blank=True,
                default=dict,
                help_text='Get started panel for this connector (see setup_guide.py).',
            ),
        ),
        migrations.RunPython(_set_kind_and_guides, reverse_code=migrations.RunPython.noop),
    ]
