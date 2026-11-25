"""API cards, batch A (Phase 10 of CONNECTOR_CATALOGUE_PLAN).

Twelve API cards: Cloudflare, DigitalOcean, Netlify, Vercel, PagerDuty, Todoist,
Trello, ClickUp, Airtable, Calendly, Cal.com and Pipedrive. Each card is a row
of `kind='api'` that the engine (`card_template.py`) runs from its `template`:
a base URL, a trimmed OpenAPI spec in `datasources/catalogue/`, and the auth
shape. Each card gets one credential type holding its key (`card-<icon_slug>`).

Every card is written with `enabled=False, coming_soon=True`. A card is switched
on only after a live check passes (project rule H-110), never by this migration.

Everything is written **inline**: the card list is a literal in this file, and
the migration imports no app module, so a later edit to a validator or a list
elsewhere cannot change what this migration does (see 0010 and 0024 for why).
The guides are already in the shape `setup_guide.py` accepts; the migration does
not call the validator. The test `tests/test_api_cards_data_a.py` checks every
row against the validators after the migrations have run.

Reverse removes exactly these twelve card rows (by name, `user=None`) and the
twelve credential types (by slug). Nothing else is touched.
"""
from django.db import migrations

READ_ONLY = "Read-only: the assistant can look things up but cannot change anything."

CARDS = [
    {
        "name": "Cloudflare",
        "icon_slug": "cloudflare",
        "category": "development",
        "tagline": "Lets the assistant look up your Cloudflare zones, DNS records and accounts.",
        "help_url": "https://developers.cloudflare.com/fundamentals/api/get-started/create-token/",
        "cred": {
            "slug": "card-cloudflare",
            "name": "Cloudflare API token",
            "description": "Your Cloudflare API token. Used only for read requests.",
            "fields": [("apiKey", "API token", "Token from My Profile > API Tokens. Use read permissions only.")],
        },
        "base_url": "https://api.cloudflare.com/client/v4",
        "spec": "cloudflare.json",
        "auth": {"parts": [{"in": "header", "name": "Authorization", "value": "Bearer {apiKey}"}]},
        "guide": {
            "you_need": ["A Cloudflare account"],
            "cost": "Free",
            "time": "About 3 minutes",
            "steps": [
                {
                    "text": "Open the API tokens page: My Profile, then API Tokens.",
                    "url": "https://developers.cloudflare.com/fundamentals/api/get-started/create-token/",
                },
                {"text": "Click Create Token, then choose the custom token option that starts from scratch."},
                {"text": "Add read permissions only, for example Zone, DNS, Read."},
                {"text": "Optionally set an expiry, click Create Token, and copy the token. It is shown only once."},
                {"text": "Paste the key here and click Save."},
            ],
            "limits": [
                READ_ONLY,
                "The token sees only what its permissions allow, so keep it to read permissions.",
            ],
        },
    },
    {
        "name": "DigitalOcean",
        "icon_slug": "digitalocean",
        "category": "development",
        "tagline": "Lets the assistant look up your droplets, apps, domains and DNS records.",
        "help_url": "https://docs.digitalocean.com/reference/api/create-personal-access-token/",
        "cred": {
            "slug": "card-digitalocean",
            "name": "DigitalOcean API token",
            "description": "Your DigitalOcean personal access token. Used only for read requests.",
            "fields": [("apiKey", "API token", "Personal access token from API > Tokens, with the Read Only scope.")],
        },
        "base_url": "https://api.digitalocean.com",
        "spec": "digitalocean.json",
        "auth": {"parts": [{"in": "header", "name": "Authorization", "value": "Bearer {apiKey}"}]},
        "guide": {
            "you_need": ["A DigitalOcean account"],
            "cost": "Free",
            "time": "About 2 minutes",
            "steps": [
                {
                    "text": "Open the API page from the main menu (Account, then API), and open the Tokens tab.",
                    "url": "https://docs.digitalocean.com/reference/api/create-personal-access-token/",
                },
                {"text": "Click Generate New Token."},
                {"text": "Enter a name and choose an expiration."},
                {"text": "Under scopes, choose Read Only."},
                {"text": "Click Generate Token and copy it. It is shown only once."},
                {"text": "Paste the key here and click Save."},
            ],
            "limits": [
                READ_ONLY,
                "You choose the expiry when you create the token; revoke it on the same page if it leaks.",
            ],
        },
    },
    {
        "name": "Netlify",
        "icon_slug": "netlify",
        "category": "development",
        "tagline": "Lets the assistant look up your Netlify sites and their deploys.",
        "help_url": "https://docs.netlify.com/api-and-cli-guides/api-guides/get-started-with-api/",
        "cred": {
            "slug": "card-netlify",
            "name": "Netlify personal access token",
            "description": "Your Netlify personal access token. Used only for read requests.",
            "fields": [("apiKey", "Access token", "Personal access token from your Netlify user settings, Applications.")],
        },
        "base_url": "https://api.netlify.com/api/v1",
        "spec": "netlify.json",
        "auth": {"parts": [{"in": "header", "name": "Authorization", "value": "Bearer {apiKey}"}]},
        "guide": {
            "you_need": ["A Netlify account"],
            "cost": "Free",
            "time": "About 2 minutes",
            "steps": [
                {
                    "text": "Open your Netlify user settings, go to Applications, then Personal access tokens.",
                    "url": "https://docs.netlify.com/api-and-cli-guides/api-guides/get-started-with-api/",
                },
                {"text": "Click New access token, enter a name, and choose an expiration."},
                {"text": "Click Generate token and copy it. You cannot view it again after you leave the page."},
                {"text": "Paste the key here and click Save."},
            ],
            "limits": [
                READ_ONLY,
                "Resetting your Netlify password cancels every token created before the reset.",
                "If your team uses SSO, the token may need SSO sign-in to reach the team's sites.",
            ],
        },
    },
    {
        "name": "Vercel",
        "icon_slug": "vercel",
        "category": "development",
        "tagline": "Lets the assistant look up your Vercel projects, deployments and teams.",
        "help_url": "https://vercel.com/docs/rest-api",
        "cred": {
            "slug": "card-vercel",
            "name": "Vercel access token",
            "description": "Your Vercel access token. Used only for read requests.",
            "fields": [("apiKey", "Access token", "Token from your Vercel account settings, Tokens.")],
        },
        "base_url": "https://api.vercel.com",
        "spec": "vercel.json",
        "auth": {"parts": [{"in": "header", "name": "Authorization", "value": "Bearer {apiKey}"}]},
        "guide": {
            "you_need": ["A Vercel account"],
            "cost": "Free",
            "time": "About 2 minutes",
            "steps": [
                {"text": "Open your Vercel account settings and go to Tokens."},
                {"text": "Click Create and give the token a name. Pick its scope and an expiry date, then copy the token."},
                {"text": "Paste the key here and click Save."},
            ],
            "limits": [
                READ_ONLY,
                "Vercel tokens are not read-only; this card sends only GET requests, so it cannot change projects.",
            ],
        },
    },
    {
        "name": "PagerDuty",
        "icon_slug": "pagerduty",
        "category": "development",
        "tagline": "Lets the assistant look up your PagerDuty services, incidents and on-call schedules.",
        "help_url": "https://docs.pagerduty.com/account-admin/api-access-keys",
        "cred": {
            "slug": "card-pagerduty",
            "name": "PagerDuty REST API key",
            "description": "Your PagerDuty REST API key, read-only. Used only for read requests.",
            "fields": [("apiKey", "REST API key", "Read-only REST API key from Integrations, Developer Tools, API Access Keys.")],
        },
        "base_url": "https://api.pagerduty.com",
        "spec": "pagerduty.json",
        "auth": {"parts": [{"in": "header", "name": "Authorization", "value": "Token token={apiKey}"}]},
        "guide": {
            "you_need": ["A PagerDuty account where you are an account owner or admin"],
            "admin_needed": "Only an account owner or admin can create a REST API key.",
            "cost": "Free to create the key",
            "time": "About 2 minutes",
            "steps": [
                {
                    "text": "Open Integrations, then Developer Tools, then API Access Keys.",
                    "url": "https://docs.pagerduty.com/account-admin/api-access-keys",
                },
                {"text": "Click Create New API Key and enter a description."},
                {"text": "Tick Read-only API Key."},
                {"text": "Click Create Key. The key is shown in full only once."},
                {"text": "Paste the key here and click Save."},
            ],
            "limits": [
                READ_ONLY,
                "A read-only key allows only GET calls, which is all this card sends.",
            ],
        },
    },
    {
        "name": "Todoist",
        "icon_slug": "todoist",
        "category": "productivity",
        "tagline": "Lets the assistant look up your Todoist projects, tasks and labels.",
        "help_url": "https://developer.todoist.com/api/v1/",
        "cred": {
            "slug": "card-todoist",
            "name": "Todoist API token",
            "description": "Your Todoist API token. Used only for read requests.",
            "fields": [("apiKey", "API token", "API token from Settings, Integrations, Developer.")],
        },
        "base_url": "https://api.todoist.com",
        "spec": "todoist.json",
        "auth": {"parts": [{"in": "header", "name": "Authorization", "value": "Bearer {apiKey}"}]},
        "guide": {
            "you_need": ["A Todoist account"],
            "cost": "Free",
            "time": "About 1 minute",
            "steps": [
                {
                    "text": "Open Todoist settings, go to Integrations, then Developer.",
                    "url": "https://app.todoist.com/app/settings/integrations",
                },
                {"text": "Copy your API token."},
                {"text": "Paste the key here and click Save."},
            ],
            "limits": [
                READ_ONLY,
                "The token can change your tasks; this card sends only read requests.",
            ],
        },
    },
    {
        "name": "Trello",
        "icon_slug": "trello",
        "category": "productivity",
        "tagline": "Lets the assistant look up your Trello boards, lists and cards.",
        "help_url": "https://developer.atlassian.com/cloud/trello/guides/rest-api/authorization/",
        "cred": {
            "slug": "card-trello",
            "name": "Trello API key and token",
            "description": "Your Trello API key and token. Used only for read requests.",
            "fields": [
                ("apiKey", "API key", "Trello API key from the Power-Up admin page (trello.com/apps/admin)."),
                ("token", "Token", "Trello token from the authorize page, with read scope."),
            ],
        },
        "base_url": "https://api.trello.com/1",
        "spec": "trello.json",
        "auth": {
            "parts": [
                {"in": "query", "name": "key", "value": "{apiKey}"},
                {"in": "query", "name": "token", "value": "{token}"},
            ],
        },
        "guide": {
            "you_need": ["A Trello account"],
            "cost": "Free",
            "time": "About 3 minutes",
            "steps": [
                {
                    "text": "Open the Trello Power-Up admin page, open your Power-Up, and open its Trello Auth tab.",
                    "url": "https://trello.com/apps/admin",
                },
                {"text": "Copy the API key shown there, or click Generate a new API Key if there is none."},
                {
                    "text": (
                        "Open Trello's authorize page for that key with scope read and expiration never, "
                        "click Allow, and copy the token it shows."
                    ),
                },
                {"text": "Paste the key and the token here and click Save."},
            ],
            "limits": [
                READ_ONLY,
                "The token has read scope, so it can read boards but not change them.",
            ],
        },
    },
    {
        "name": "ClickUp",
        "icon_slug": "clickup",
        "category": "productivity",
        "tagline": "Lets the assistant look up your ClickUp workspaces, spaces, lists and tasks.",
        "help_url": "https://developer.clickup.com/docs/authentication",
        "cred": {
            "slug": "card-clickup",
            "name": "ClickUp personal API token",
            "description": "Your ClickUp personal API token. Used only for read requests.",
            "fields": [("apiKey", "API token", "Personal API token from Settings, Apps.")],
        },
        "base_url": "https://api.clickup.com/api/v2",
        "spec": "clickup.json",
        "auth": {"parts": [{"in": "header", "name": "Authorization", "value": "{apiKey}"}]},
        "guide": {
            "you_need": ["A ClickUp account"],
            "cost": "Free",
            "time": "About 1 minute",
            "steps": [
                {"text": "Click your avatar at the top right, then Settings."},
                {"text": "In the sidebar, click Apps."},
                {
                    "text": "Under API Token, click Generate or Regenerate, then click Copy.",
                    "url": "https://developer.clickup.com/docs/authentication",
                },
                {"text": "Paste the key here and click Save."},
            ],
            "limits": [
                READ_ONLY,
                "The token is not read-only; this card sends only read requests, so it cannot change tasks.",
            ],
        },
    },
    {
        "name": "Airtable",
        "icon_slug": "airtable",
        "category": "productivity",
        "tagline": "Lets the assistant look up your Airtable bases, tables and records.",
        "help_url": "https://airtable.com/developers/web/guides/personal-access-tokens",
        "cred": {
            "slug": "card-airtable",
            "name": "Airtable personal access token",
            "description": "Your Airtable personal access token. Used only for read requests.",
            "fields": [("apiKey", "Access token", "Personal access token with read scopes, for the bases you allow.")],
        },
        "base_url": "https://api.airtable.com/v0",
        "spec": "airtable.json",
        "auth": {"parts": [{"in": "header", "name": "Authorization", "value": "Bearer {apiKey}"}]},
        "guide": {
            "you_need": ["An Airtable account", "The bases you want the assistant to read"],
            "cost": "Free",
            "time": "About 3 minutes",
            "steps": [
                {
                    "text": "Open the personal access token page and click Create new token.",
                    "url": "https://airtable.com/create/tokens",
                },
                {"text": "Enter a name for the token."},
                {"text": "Under scopes, add data.records:read and schema.bases:read only."},
                {"text": "Under access, add the bases the assistant may read."},
                {"text": "Click Create token and copy it. It is shown only once."},
                {"text": "Paste the key here and click Save."},
            ],
            "limits": [
                READ_ONLY,
                "The token sees only the bases you add under access.",
            ],
        },
    },
    {
        "name": "Calendly",
        "icon_slug": "calendly",
        "category": "productivity",
        "tagline": "Lets the assistant look up your Calendly event types, meetings and invitees.",
        "help_url": "https://developer.calendly.com/docs/authentication/how-to-authenticate-with-personal-access-tokens",
        "cred": {
            "slug": "card-calendly",
            "name": "Calendly personal access token",
            "description": "Your Calendly personal access token. Used only for read requests.",
            "fields": [("apiKey", "Access token", "Personal access token from your Calendly profile menu, Developer.")],
        },
        "base_url": "https://api.calendly.com",
        "spec": "calendly.json",
        "auth": {"parts": [{"in": "header", "name": "Authorization", "value": "Bearer {apiKey}"}]},
        "guide": {
            "you_need": ["A Calendly account; API access may depend on your plan"],
            "cost": "Depends on your Calendly plan",
            "time": "About 3 minutes",
            "steps": [
                {
                    "text": (
                        "Open your profile menu, then Developer, then Personal access tokens. "
                        "If there is no Developer item, open calendly.com/integrations instead."
                    ),
                    "url": "https://developer.calendly.com/docs/authentication/how-to-authenticate-with-personal-access-tokens",
                },
                {"text": "Click Create personal access token, enter a name, and click Next."},
                {"text": "Select at least one scope, then click Create."},
                {"text": "Enter the verification code sent to your email and copy the token. It is shown only once."},
                {"text": "Paste the key here and click Save."},
            ],
            "limits": [
                READ_ONLY,
                "You can have up to 10 personal access tokens; the token cannot be shown again.",
            ],
        },
    },
    {
        "name": "Cal.com",
        "icon_slug": "calcom",
        "category": "productivity",
        "tagline": "Lets the assistant look up your Cal.com event types, bookings and schedules.",
        "help_url": "https://cal.com/docs/api-reference/v2/introduction",
        "cred": {
            "slug": "card-calcom",
            "name": "Cal.com API key",
            "description": "Your Cal.com API key. Used only for read requests.",
            "fields": [("apiKey", "API key", "API key that starts with cal_live_, from Settings, Security.")],
        },
        "base_url": "https://api.cal.com/v2",
        "spec": "calcom.json",
        "auth": {"parts": [{"in": "header", "name": "Authorization", "value": "Bearer {apiKey}"}]},
        "guide": {
            "you_need": ["A Cal.com account"],
            "cost": "Free to create the key; check your plan includes API access",
            "time": "About 2 minutes",
            "steps": [
                {"text": "Open Settings, then the Security tab."},
                {"text": "Find the API keys section and create a new key."},
                {"text": "Copy the key. Live keys start with cal_live_."},
                {"text": "Paste the key here and click Save."},
            ],
            "limits": [
                READ_ONLY,
                "Cal.com API keys are not read-only; this card sends only GET requests.",
            ],
        },
    },
    {
        "name": "Pipedrive",
        "icon_slug": "pipedrive",
        "category": "productivity",
        "tagline": "Lets the assistant look up your Pipedrive deals, people, organizations and pipelines.",
        "help_url": "https://developers.pipedrive.com/docs/api/v1",
        "cred": {
            "slug": "card-pipedrive",
            "name": "Pipedrive API token",
            "description": "Your Pipedrive personal API token. Used only for read requests.",
            "fields": [("apiKey", "API token", "Personal API token from Personal preferences, API.")],
        },
        "base_url": "https://api.pipedrive.com/v1",
        "spec": "pipedrive.json",
        "auth": {"parts": [{"in": "query", "name": "api_token", "value": "{apiKey}"}]},
        "guide": {
            "you_need": ["A Pipedrive account with API access turned on"],
            "admin_needed": "If API is missing from your list under Your companies, a company admin must turn it on first.",
            "cost": "Free to create the key; check your plan includes API access",
            "time": "About 2 minutes",
            "steps": [
                {
                    "text": "Click your account name at the top right, then choose Company settings.",
                    "url": "https://app.pipedrive.com/settings/api",
                },
                {"text": "Go to Personal preferences, then API."},
                {"text": "Copy your personal API token."},
                {"text": "Paste the key here and click Save."},
            ],
            "limits": [
                READ_ONLY,
                "The token acts as you, with full access to your Pipedrive data; this card sends only reads.",
            ],
        },
    },
]


def seed(apps, schema_editor):
    CredentialType = apps.get_model("credentials", "CredentialType")
    MCPServer = apps.get_model("mcp_integration", "MCPServer")

    for card in CARDS:
        cred = card["cred"]
        CredentialType.objects.update_or_create(
            slug=cred["slug"],
            defaults={
                "name": cred["name"],
                "description": cred["description"],
                "icon": "",
                "auth_method": "api_key",
                "is_active": True,
                "fields_schema": [
                    {
                        "id": field_id,
                        "name": field_name,
                        "type": "string",
                        "required": True,
                        "description": description,
                        "isPassword": True,
                    }
                    for field_id, field_name, description in cred["fields"]
                ],
            },
        )
        MCPServer.objects.update_or_create(
            name=card["name"],
            user=None,
            defaults={
                "display_name": card["name"],
                "kind": "api",
                "type": "http",
                "url": "",
                "category": card["category"],
                "tagline": card["tagline"],
                "icon_slug": card["icon_slug"],
                "help_url": card["help_url"],
                "required_credential_types": [cred["slug"]],
                "enabled": False,
                "coming_soon": True,
                "setup_guide": card["guide"],
                "template": {
                    "base_url": card["base_url"],
                    "spec": card["spec"],
                    "auth": card["auth"],
                    "fields": [],
                    "allowed_methods": ["GET", "HEAD"],
                },
            },
        )


def unseed(apps, schema_editor):
    CredentialType = apps.get_model("credentials", "CredentialType")
    MCPServer = apps.get_model("mcp_integration", "MCPServer")

    MCPServer.objects.filter(
        name__in=[card["name"] for card in CARDS], user__isnull=True,
    ).delete()
    CredentialType.objects.filter(
        slug__in=[card["cred"]["slug"] for card in CARDS],
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("mcp_integration", "0025_mcpserver_template"),
        ("credentials", "0012_chatgpt_credential_type"),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
