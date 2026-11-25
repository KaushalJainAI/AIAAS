"""
Data migration: API cards, batch B (Phase 10 of CONNECTOR_CATALOGUE_PLAN).

Eleven cards: Freshdesk, Mailchimp, Klaviyo, SendGrid, Brevo, Postmark,
Typeform, Jotform, Contentful, WooCommerce and OpenWeather. For each one this
writes the credential type the person pastes a key into, and the card row with
its connection template, its Get started guide and its trimmed OpenAPI spec
(`datasources/catalogue/<icon>.json`).

Every card is written off (`enabled=False`, `coming_soon=True`). A card goes on
only after a live check (plan rule H-110).

The data is inline. This migration imports no app module and calls no
validator, so it keeps working when those modules change. The tests in
`mcp_integration/tests/test_api_cards_data_b.py` run the validators instead.
Reversing deletes the eleven rows and the eleven credential types.
"""
from django.db import migrations

READ_ONLY = "Read-only: the assistant can look things up but cannot change anything."


def _field(name, label, help_text, pattern):
    return {"name": name, "label": label, "help": help_text, "pattern": pattern}


def _key(description, field_id="apiKey", name="API key"):
    return [{
        "id": field_id,
        "name": name,
        "type": "string",
        "required": True,
        "description": description,
        "isPassword": True,
    }]


def _template(icon, base_url, auth_parts, fields):
    return {
        "base_url": base_url,
        "spec": f"{icon}.json",
        "auth": {"parts": auth_parts},
        "fields": fields,
        "allowed_methods": ["GET", "HEAD"],
    }


def _step(text, url=None):
    step = {"text": text}
    if url:
        step["url"] = url
    return step


CARDS = [
    {
        "name": "Freshdesk",
        "icon": "freshdesk",
        "category": "productivity",
        "tagline": "Look up your support tickets, contacts, companies and agents.",
        "help_url": "https://developers.freshdesk.com/api/#authentication",
        "cred_name": "Freshdesk API key",
        "cred_description": "Your Freshdesk API key. Lets the assistant read tickets, contacts and agents.",
        "fields_schema": _key("Your Freshdesk API key, from your profile settings."),
        "template": _template(
            "freshdesk",
            "https://{subdomain}.freshdesk.com/api/v2",
            [{"in": "basic", "user": "{apiKey}", "password": "X"}],
            [_field("subdomain", "Freshdesk subdomain", "acme in acme.freshdesk.com",
                    r"^[a-z0-9-]{1,63}$")],
        ),
        "guide": {
            "you_need": [
                "A Freshdesk agent or admin account",
                "Your Freshdesk subdomain, e.g. acme for acme.freshdesk.com",
            ],
            "admin_needed": None,
            "cost": "No extra charge for the key.",
            "time": "2 minutes",
            "steps": [
                _step("Click your profile picture, then Profile settings."),
                _step("Copy the Your API Key value shown on that page."),
                _step("Enter your Freshdesk subdomain: the acme part of acme.freshdesk.com."),
                _step("Paste the key here and click Save."),
            ],
            "limits": [
                READ_ONLY,
                "The key has your agent's full permissions, so the assistant sees what you can see in Freshdesk.",
            ],
        },
    },
    {
        "name": "Mailchimp",
        "icon": "mailchimp",
        "category": "communication",
        "tagline": "Look up your audiences, their member counts and your email campaigns.",
        "help_url": "https://mailchimp.com/developer/marketing/docs/fundamentals/",
        "cred_name": "Mailchimp API key",
        "cred_description": "Your Mailchimp API key. Lets the assistant read audiences and campaigns.",
        "fields_schema": _key("Your Mailchimp API key. It ends with a dash and a data center, e.g. -us21."),
        "template": _template(
            "mailchimp",
            "https://{dc}.api.mailchimp.com/3.0",
            [{"in": "basic", "user": "anystring", "password": "{apiKey}"}],
            [_field("dc", "Mailchimp data center",
                    "the part after the dash at the end of your key, e.g. us21",
                    r"^[a-z]{2,3}[0-9]{1,3}$")],
        ),
        "guide": {
            "you_need": [
                "A Mailchimp account with the Manager role or higher",
                "Your data center: the part after the dash at the end of your key, e.g. us21",
            ],
            "admin_needed": "Mailchimp Manager role or higher on the account.",
            "cost": "No extra charge for the key.",
            "time": "2 minutes",
            "steps": [
                _step("Open your Mailchimp profile, then Extras, then API keys."),
                _step("Click Create A Key and copy it. Mailchimp shows it only once."),
                _step("Enter your data center, the part after the dash in the key, e.g. us21."),
                _step("Paste the key here and click Save."),
            ],
            "limits": [
                READ_ONLY,
                "Keys made after 2026-06-22 expire after one year.",
            ],
        },
    },
    {
        "name": "Klaviyo",
        "icon": "klaviyo",
        "category": "communication",
        "tagline": "Look up your lists, profiles and metrics.",
        "help_url": "https://developers.klaviyo.com/en/reference/api_overview",
        "cred_name": "Klaviyo API key",
        "cred_description": "Your Klaviyo private API key. Lets the assistant read lists, profiles and metrics.",
        "fields_schema": _key("Your Klaviyo private API key, created as read-only."),
        "template": _template(
            "klaviyo",
            "https://a.klaviyo.com/api",
            [
                {"in": "header", "name": "Authorization", "value": "Klaviyo-API-Key {apiKey}"},
                {"in": "header", "name": "revision", "value": "2026-10-15"},
            ],
            [],
        ),
        "guide": {
            "you_need": ["A Klaviyo account where you can manage API keys"],
            "admin_needed": None,
            "cost": "No extra charge for the key.",
            "time": "2 minutes",
            "steps": [
                _step("Click your organisation name at the bottom left, then Settings, then API keys."),
                _step("Click Create Private API Key."),
                _step("Choose Read-only access."),
                _step("Paste the key here and click Save."),
            ],
            "limits": [
                READ_ONLY,
                "The assistant reads Klaviyo through API revision 2026-10-15. Newer revisions can change what comes back.",
            ],
        },
    },
    {
        "name": "SendGrid",
        "icon": "sendgrid",
        "category": "communication",
        "tagline": "Look up your email sending stats, unsubscribes and templates.",
        "help_url": "https://www.twilio.com/docs/sendgrid/api-reference/how-to-use-the-sendgrid-v3-api/authentication",
        "cred_name": "SendGrid API key",
        "cred_description": "Your SendGrid API key. Lets the assistant read sending stats, unsubscribes and templates.",
        "fields_schema": _key("Your SendGrid API key. Use a restricted key with Read access only."),
        "template": _template(
            "sendgrid",
            "https://api.sendgrid.com/v3",
            [{"in": "header", "name": "Authorization", "value": "Bearer {apiKey}"}],
            [],
        ),
        "guide": {
            "you_need": ["A SendGrid account where you can create API keys"],
            "admin_needed": None,
            "cost": "No extra charge for the key.",
            "time": "3 minutes",
            "steps": [
                _step("Open Settings, then API Keys."),
                _step("Click Create API Key."),
                _step("Choose Restricted Access and give Read only to the parts you need, such as Stats and Suppressions."),
                _step("Copy the key. SendGrid shows it only once."),
                _step("Paste the key here and click Save."),
            ],
            "limits": [
                READ_ONLY,
                "The key only sees the parts you gave Read access to. Anything else returns an error.",
            ],
        },
    },
    {
        "name": "Brevo",
        "icon": "brevo",
        "category": "communication",
        "tagline": "Look up your contacts, email campaigns and transactional templates.",
        "help_url": "https://developers.brevo.com/reference/getaccount",
        "cred_name": "Brevo API key",
        "cred_description": "Your Brevo API key. Lets the assistant read contacts, campaigns and templates.",
        "fields_schema": _key("Your Brevo API key, starting with xkeysib-."),
        "template": _template(
            "brevo",
            "https://api.brevo.com/v3",
            [{"in": "header", "name": "api-key", "value": "{apiKey}"}],
            [],
        ),
        "guide": {
            "you_need": ["A Brevo account"],
            "admin_needed": None,
            "cost": "No extra charge for the key.",
            "time": "2 minutes",
            "steps": [
                _step("Open Brevo's API keys page, app.brevo.com/settings/keys/api.",
                      url="https://app.brevo.com/settings/keys/api"),
                _step("Create a new API key on that page."),
                _step("Copy the new key."),
                _step("Paste the key here and click Save."),
            ],
            "limits": [
                READ_ONLY,
                "Brevo keys have full access to the account. The assistant only sends read requests with this key.",
            ],
        },
    },
    {
        "name": "Postmark",
        "icon": "postmark",
        "category": "communication",
        "tagline": "Look up your email delivery stats, bounces, templates and message streams.",
        "help_url": "https://postmarkapp.com/developer/api/overview",
        "cred_name": "Postmark server token",
        "cred_description": "Your Postmark server token. Lets the assistant read delivery stats, bounces and templates.",
        "fields_schema": _key("Your Postmark server token, from the server's API Tokens.",
                              name="Server token"),
        "template": _template(
            "postmark",
            "https://api.postmarkapp.com",
            [
                {"in": "header", "name": "X-Postmark-Server-Token", "value": "{apiKey}"},
                {"in": "header", "name": "Accept", "value": "application/json"},
            ],
            [],
        ),
        "guide": {
            "you_need": ["A Postmark account with a server"],
            "admin_needed": None,
            "cost": "No extra charge for the token.",
            "time": "2 minutes",
            "steps": [
                _step("Open your Server, then API Tokens."),
                _step("Copy the server token."),
                _step("Paste the key here and click Save."),
            ],
            "limits": [
                READ_ONLY,
                "A server token only sees the one server it belongs to.",
            ],
        },
    },
    {
        "name": "Typeform",
        "icon": "typeform",
        "category": "productivity",
        "tagline": "Look up your forms, their responses and your workspaces.",
        "help_url": "https://www.typeform.com/developers/get-started/",
        "cred_name": "Typeform API key",
        "cred_description": "Your Typeform personal token. Lets the assistant read forms, responses and workspaces.",
        "fields_schema": _key("Your Typeform personal token. Create it with read scopes only."),
        "template": _template(
            "typeform",
            "https://api.typeform.com",
            [{"in": "header", "name": "Authorization", "value": "Bearer {apiKey}"}],
            [],
        ),
        "guide": {
            "you_need": ["A Typeform account"],
            "admin_needed": None,
            "cost": "No extra charge for the token. Your plan can limit API use.",
            "time": "3 minutes",
            "steps": [
                _step("Open Account, then Personal tokens."),
                _step("Click Generate a new token."),
                _step("Pick only the read scopes: forms:read, responses:read and workspaces:read."),
                _step("Copy the token."),
                _step("Paste the key here and click Save."),
            ],
            "limits": [
                READ_ONLY,
                "The token only has the scopes you pick. An area outside them returns an error.",
                "Responses can contain names, emails and other answers people typed into your forms.",
            ],
        },
    },
    {
        "name": "Jotform",
        "icon": "jotform",
        "category": "productivity",
        "tagline": "Look up your forms, submissions and usage.",
        "help_url": "https://api.jotform.com/docs/",
        "cred_name": "Jotform API key",
        "cred_description": "Your Jotform API key. Lets the assistant read forms, submissions and usage.",
        "fields_schema": _key("Your Jotform API key."),
        "template": _template(
            "jotform",
            "https://{region}.jotform.com",
            [{"in": "header", "name": "APIKEY", "value": "{apiKey}"}],
            [{
                "name": "region",
                "label": "Jotform region",
                "help": "Use api unless your Jotform account is in the EU or HIPAA region",
                "pattern": "^(api|eu-api|hipaa-api)$",
                "options": ["api", "eu-api", "hipaa-api"],
            }],
        ),
        "guide": {
            "you_need": [
                "A Jotform account",
                "Your Jotform region: api (standard), eu-api (EU) or hipaa-api (HIPAA)",
            ],
            "admin_needed": None,
            "cost": "No extra charge for the key.",
            "time": "2 minutes",
            "steps": [
                _step("Open your Jotform API page, jotform.com/myaccount/api.",
                      url="https://www.jotform.com/myaccount/api"),
                _step("Click Create New Key."),
                _step("Copy the key."),
                _step("Pick your region: standard, EU or HIPAA."),
                _step("Paste the key here and click Save."),
            ],
            "limits": [
                READ_ONLY,
                "Daily API calls are capped by your plan. The Starter plan allows 1,000 calls a day.",
            ],
        },
    },
    {
        "name": "Contentful",
        "icon": "contentful",
        "category": "development",
        "tagline": "Look up the published entries, assets and content types in a space.",
        "help_url": "https://www.contentful.com/developers/docs/references/content-delivery-api/",
        "cred_name": "Contentful Content Delivery token",
        "cred_description": "Your Contentful Content Delivery API token. Lets the assistant read published content.",
        "fields_schema": _key("Your Contentful Content Delivery API access token."),
        "template": _template(
            "contentful",
            "https://cdn.contentful.com/spaces/{space_id}",
            [{"in": "header", "name": "Authorization", "value": "Bearer {apiKey}"}],
            [_field("space_id", "Space ID", "The Space ID shown with your access token",
                    r"^[a-z0-9]{8,64}$")],
        ),
        "guide": {
            "you_need": [
                "A Contentful account with access to the space",
                "Your Space ID",
            ],
            "admin_needed": None,
            "cost": "No extra charge for the key.",
            "time": "3 minutes",
            "steps": [
                _step("Open your space, then Settings, then API keys."),
                _step("Click Add API key."),
                _step("Copy the Space ID and the Content Delivery API access token."),
                _step("Enter your Space ID."),
                _step("Paste the key here and click Save."),
            ],
            "limits": [
                READ_ONLY,
                "The Content Delivery API serves published content only. Unpublished drafts are not visible.",
            ],
        },
    },
    {
        "name": "WooCommerce",
        "icon": "woocommerce",
        "category": "productivity",
        "tagline": "Look up your store's products, orders, customers and coupons.",
        "help_url": "https://woocommerce.github.io/woocommerce-rest-api-docs/",
        "cred_name": "WooCommerce REST API key",
        "cred_description": "Your WooCommerce consumer key and secret. Lets the assistant read the store.",
        "fields_schema": [
            {
                "id": "consumerKey",
                "name": "Consumer key",
                "type": "string",
                "required": True,
                "description": "The consumer key from WooCommerce REST API settings.",
                "isPassword": True,
            },
            {
                "id": "consumerSecret",
                "name": "Consumer secret",
                "type": "string",
                "required": True,
                "description": "The consumer secret from WooCommerce REST API settings.",
                "isPassword": True,
            },
        ],
        "template": _template(
            "woocommerce",
            "https://{store}/wp-json/wc/v3",
            [{"in": "basic", "user": "{consumerKey}", "password": "{consumerSecret}"}],
            [_field("store", "Store address", "The hostname only, e.g. shop.example.com",
                    r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$")],
        ),
        "guide": {
            "you_need": [
                "Your store's web address, e.g. shop.example.com",
                "WordPress admin access to the store",
            ],
            "admin_needed": "A WordPress administrator on the store.",
            "cost": "No extra charge for the key.",
            "time": "3 minutes",
            "steps": [
                _step("In WordPress admin, open WooCommerce, then Settings, then Advanced, then REST API."),
                _step("Click Add key."),
                _step("Pick a user and set Permissions to Read."),
                _step("Click Generate API key, then copy the consumer key and the consumer secret."),
                _step("Enter your store address, e.g. shop.example.com. The store must use HTTPS."),
                _step("Paste the key here and click Save."),
            ],
            "limits": [
                READ_ONLY,
                "The store must be served over HTTPS. Plain HTTP is refused.",
            ],
        },
    },
    {
        "name": "OpenWeather",
        "icon": "openweather",
        "category": "utilities",
        "tagline": "Look up current weather, forecasts and air quality for any place.",
        "help_url": "https://openweathermap.org/api",
        "cred_name": "OpenWeather API key",
        "cred_description": "Your OpenWeather API key. Lets the assistant read weather, forecasts and air quality.",
        "fields_schema": _key("Your OpenWeather API key."),
        "template": _template(
            "openweather",
            "https://api.openweathermap.org",
            [{"in": "query", "name": "appid", "value": "{apiKey}"}],
            [],
        ),
        "guide": {
            "you_need": ["An OpenWeather account"],
            "admin_needed": None,
            "cost": "Free to sign up. Paid plans are optional.",
            "time": "5 minutes, plus a short wait for the key to start working",
            "steps": [
                _step("Sign up at openweathermap.org.", url="https://openweathermap.org"),
                _step("Find your key in the email OpenWeather sends, or on your API keys page.",
                      url="https://home.openweathermap.org/api_keys"),
                _step("Copy the key."),
                _step("Paste the key here and click Save."),
            ],
            "limits": [
                READ_ONLY,
                "New keys can take a while to start working.",
            ],
        },
    },
]


def forward(apps, schema_editor):
    CredentialType = apps.get_model('credentials', 'CredentialType')
    MCPServer = apps.get_model('mcp_integration', 'MCPServer')

    for card in CARDS:
        slug = f"card-{card['icon']}"
        CredentialType.objects.update_or_create(
            slug=slug,
            defaults={
                'name': card['cred_name'],
                'description': card['cred_description'],
                'icon': '',
                'auth_method': 'api_key',
                'fields_schema': card['fields_schema'],
                'is_active': True,
            },
        )
        MCPServer.objects.update_or_create(
            name=card['name'],
            user=None,
            defaults={
                'display_name': card['name'],
                'kind': 'api',
                'type': 'http',
                'url': '',
                'category': card['category'],
                'tagline': card['tagline'],
                'icon_slug': card['icon'],
                'help_url': card['help_url'],
                'required_credential_types': [slug],
                'enabled': False,
                'coming_soon': True,
                'setup_guide': card['guide'],
                'template': card['template'],
            },
        )


def backward(apps, schema_editor):
    CredentialType = apps.get_model('credentials', 'CredentialType')
    MCPServer = apps.get_model('mcp_integration', 'MCPServer')

    MCPServer.objects.filter(
        name__in=[card['name'] for card in CARDS], user__isnull=True,
    ).delete()
    CredentialType.objects.filter(
        slug__in=[f"card-{card['icon']}" for card in CARDS],
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('mcp_integration', '0026_api_cards_a'),
        ('credentials', '0012_chatgpt_credential_type'),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
