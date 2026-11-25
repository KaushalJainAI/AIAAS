"""Say why the new API cards are switched off.

`0026`/`0027` ship 23 API cards as Coming soon (`enabled=False`) until a live
check passes (H-110). Every switched-off curated row must explain itself
(`test_fresh_install.test_a_disabled_connector_explains_itself`), so each card
whose `setup_notes` is empty gets one plain line. The note is written inline;
a later edit to a card leaves this migration alone.
"""
from django.db import migrations

NOTE = (
    "Coming soon — this connector is switched on once it has been checked "
    "against the live service. Its Get started steps show what it will need."
)


def add_notes(apps, schema_editor):
    MCPServer = apps.get_model("mcp_integration", "MCPServer")
    MCPServer.objects.filter(
        user__isnull=True, kind="api", enabled=False, setup_notes="",
    ).update(setup_notes=NOTE)


def remove_notes(apps, schema_editor):
    MCPServer = apps.get_model("mcp_integration", "MCPServer")
    MCPServer.objects.filter(user__isnull=True, kind="api", setup_notes=NOTE).update(setup_notes="")


class Migration(migrations.Migration):
    dependencies = [("mcp_integration", "0027_api_cards_b")]
    operations = [migrations.RunPython(add_notes, remove_notes)]
