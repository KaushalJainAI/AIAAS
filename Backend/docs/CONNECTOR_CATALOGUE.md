# Connector catalogue

The list of every connector we plan to offer: how it works, what **we** must
set up, what **the user** needs, and the steps the user follows to get started.
It is the source for each card's "Get started" panel (plan §5, Phase 9). How to
build it is in [CONNECTOR_CATALOGUE_PLAN.md](CONNECTOR_CATALOGUE_PLAN.md).

Researched 2026-11-23 from each vendor's own docs and, where marked, their live
`.well-known` metadata. **(U)** marks a fact we could not confirm from the
vendor; a card's live check (plan Phase 4) must settle every (U) before the
card is switched on. Vendors change things, so re-check a card when you touch
it.

## How to read an entry

- **Engine**: which mechanism runs it.
  - **MCP**: the vendor's hosted MCP server. We store a row; the vendor runs the
    tools.
  - **API card**: our `call_api` tool with a ready-made connection (base URL,
    auth, trimmed OpenAPI spec). GET is a read; anything else asks for approval.
  - **SQL**: our `query_sql` tool with a driver for that database. Statements are
    parsed; reads only unless the agent is allowed to write.
  - **Native**: our own Python tools (Gmail, Drive, Sheets, Calendar, Docs,
    Notion today).
- **Wave**: when it ships. 1 = first batch; 2 = needs a vendor app or more
  code; 3 = spike first; ✗ = not possible today.
- **We need**: platform-side work. "Register an app" means you create a
  developer app with the vendor and put its id and secret in production's env.
- **User needs**: account, plan, role or admin approval the user must have.
- **Steps**: exactly what the card's "Get started" panel shows.

Every connector starts **read-only**. Writes are added per connector later, and
always go through an agent's grant and the approval gate.

**Standard sign-in steps (S1)**, used by every MCP card whose vendor lets us
register automatically and needs nothing else from the user:
1. Click **Connect**.
2. Sign in to the vendor in the window that opens.
3. Review what AIAAS may see and click **Allow** (or **Approve**). Done.

Sections 1–13 were researched first; §14–§20 (added 2026-11-24) cover the
second sweep: design, finance and HR, analytics, more developer tools, social
networks and more Indian services.

---

## 1. Developer and engineering

### GitHub — MCP — Wave 2
- **We need:** register a GitHub OAuth App (or GitHub App) with our
  `/oauth/callback` URL; `MCP_OAUTH_GITHUB_CLIENT_ID/SECRET` in env. No dynamic
  registration. Endpoint `https://api.githubcopilot.com/mcp/readonly` with
  `X-MCP-Toolsets: repos,issues,pull_requests`.
- **User needs:** a GitHub account. In a company org, an owner may have to
  approve our app first; Copilot Business/Enterprise orgs must turn on the "MCP
  servers in Copilot" policy. Whether a user without Copilot can use the
  endpoint is (U).
- **Steps:**
  1. Click **Connect**.
  2. Sign in to GitHub and click **Authorize**.
  3. If your company's repos are missing, ask an org owner to approve the app
     in the organisation's settings (menu name (U)).
- **Read-only:** repos, issues, pull requests, files.

### Linear — MCP — Wave 1
- **We need:** nothing; Linear supports automatic registration (verified
  live). Endpoint `https://mcp.linear.app/mcp/readonly`, scope `read`.
- **User needs:** a Linear account.
- **Steps:** 1. Click **Connect**. 2. Sign in to Linear and approve. Done.
- **Note:** connections last about 25 days before Linear asks you to sign in
  again.

### Sentry — MCP — Wave 1
- **We need:** nothing if automatic registration works (advertised live,
  not in their prose docs; live check confirms). Endpoint
  `https://mcp.sentry.dev/mcp?skills=inspect,triage`. Calls run one at a time.
- **User needs:** a Sentry (sentry.io) account in the organisation.
- **Steps:** 1. Click **Connect**. 2. Sign in to Sentry and approve. Done.
- **Read-only:** issues, events, traces, releases. AI "Seer" analysis is left
  out (paid Sentry feature).

### Supabase — MCP — Wave 1
- **We need:** confirm automatic registration in the live check (U). Endpoint
  `https://mcp.supabase.com/mcp?read_only=true&project_ref=<id>`.
- **User needs:** a Supabase account and the project's reference id.
- **Steps:**
  1. In Supabase, open your project's settings and copy the **Project ID**
     (project ref) (menu path (U)).
  2. Paste it here and click **Connect**.
  3. Sign in to Supabase and approve.
- **Read-only:** `read_only=true` runs every query as a read-only Postgres user.

### Neon — MCP — Wave 1
- **We need:** confirm registration (U). Endpoint
  `https://mcp.neon.tech/mcp?readonly=true`.
- **User needs:** a Neon account.
- **Steps:** 1. Click **Connect**. 2. Sign in to Neon and choose read-only
  access. Done.
- **Note:** Neon says its MCP server is "for development and testing". A
  production database is safer as a **Postgres** SQL card with a read-only role.

### Cloudflare — API card — Wave 1
- **We need:** card with base `https://api.cloudflare.com/client/v4`, spec from
  `github.com/cloudflare/api-schemas`, auth `Bearer`.
- **User needs:** a Cloudflare account.
- **Steps:**
  1. Open **dash.cloudflare.com → My Profile → API Tokens → Create Token**.
  2. Pick **Custom token**; add only **Read** permissions (e.g. *Zone → DNS →
     Read*, *Zone → Analytics → Read*).
  3. Optionally set an expiry, then **Create Token** and copy it (shown once).
  4. Paste it here and click **Save**.
- **Read-only:** enforced by Cloudflare's token permissions.

### DigitalOcean — API card — Wave 1
- **We need:** base `https://api.digitalocean.com`, spec from
  `github.com/digitalocean/openapi`, `Bearer`.
- **User needs:** a DigitalOcean account.
- **Steps:**
  1. **Control Panel → API → Tokens → Generate New Token**.
  2. Name it, choose an expiry, and select **Read Only** scope.
  3. Copy the token, paste it here, **Save**.

### Vercel — API card — Wave 1
- **We need:** base `https://api.vercel.com`, `Bearer`. No official OpenAPI
  spec found; write a small spec for the read endpoints (projects, deployments,
  logs).
- **User needs:** a Vercel account.
- **Steps:**
  1. **vercel.com → Account Settings → Tokens → Create**.
  2. Scope it to one team or project and pick an expiry. (Vercel has no
     read-only tokens; our card only sends GET without approval.)
  3. Copy, paste here, **Save**.
- **Note:** a hosted Vercel MCP server is listed by third parties (U).

### Netlify — API card — Wave 1
- **We need:** base `https://api.netlify.com/api/v1/`, spec
  `github.com/netlify/open-api` (`swagger.yml`), `Bearer`.
- **User needs:** a Netlify account.
- **Steps:** 1. **app.netlify.com → User settings → Applications → Personal
  access tokens → New access token**. 2. Name, expiry, **Generate**. 3. Paste
  here, **Save**.
- **Note:** tokens have full access; resetting your password cancels them.

### PagerDuty — API card — Wave 1
- **We need:** base `https://api.pagerduty.com`, spec from
  `github.com/PagerDuty/api-schema`, auth header `Authorization: Token
  token=<key>` (exact format; needs the header-prefix option, plan Phase 10).
- **User needs:** PagerDuty **account admin** to create the key.
- **Steps:** 1. Admin opens **Integrations → API Access Keys → Create New API
  Key** (menu path (U)). 2. Tick **Read-only API Key**. 3. Copy, paste here,
  **Save**.

### Datadog — API card — Wave 2
- **We need:** per-region base (`api.datadoghq.com`, `api.datadoghq.eu`,
  `api.us3.datadoghq.com`...), two headers `DD-API-KEY` + `DD-APPLICATION-KEY`
  (two-secret auth, plan Phase 10). A hosted Datadog MCP exists in their docs;
  its endpoint is (U).
- **User needs:** Datadog org access to create keys.
- **Steps:**
  1. **Organization Settings → API Keys → New Key**; copy.
  2. **Organization Settings → Application Keys → New Key**; restrict scopes to
     reads (e.g. `dashboards_read`, `monitors_read`); copy.
  3. Choose your Datadog site (US1, EU, US3...), paste both keys, **Save**.

---

## 2. Projects and work

### Asana — MCP — Wave 2
- **We need:** register an **MCP app** at `app.asana.com/0/my-apps` (Create new
  app → type *MCP app* → add our redirect URL); env client id + secret. Scope
  `default`. Endpoint `https://mcp.asana.com/v2/mcp`.
- **User needs:** an Asana account. Workspace admins can block apps; Enterprise+
  admins approve MCP clients one by one.
- **Steps:** 1. Click **Connect**. 2. Sign in to Asana, pick the workspace,
  approve. 3. If refused, ask your Asana admin to allow "AIAAS" in Asana's app
  management (menu path (U)).

### Atlassian (Jira, Confluence) — MCP — Wave 3 (spike)
- **We need:** spike first. Endpoint `https://mcp.atlassian.com/v2/mcp`.
  Unclear if third-party clients can register (U).
- **User needs:** a Jira/Confluence Cloud site, and a site admin who adds our
  site to **Settings → Rovo → Rovo MCP server → Domains**. Some calls spend
  Rovo credits.
- **Steps (if built):** 1. Ask your admin to add `<our domain>` to the Rovo MCP
  domain list. 2. Click **Connect**, sign in, pick your site, approve.
- **Likely alternative:** a native Jira connector, as Notion has.

### Trello — API card — Wave 1
- **We need:** base `https://api.trello.com/1/`, key + token sent as query
  parameters (two-secret query auth, Phase 10). No OpenAPI; write a small spec.
- **User needs:** a Trello account.
- **Steps:**
  1. Open **trello.com/apps/admin**, create a Power-Up, open its **Trello Auth**
     tab, **Generate a new API key**, copy it.
  2. Open the link shown here (Trello's authorize page with `scope=read`,
     `expiration=never`), click **Allow**, copy the token.
  3. Paste key and token, **Save**.

### ClickUp — API card — Wave 1
- **We need:** base `https://api.clickup.com/api/v2/`, header `Authorization:
  pk_…` with **no** `Bearer`. A hosted ClickUp MCP (OAuth) is listed (U).
- **User needs:** a ClickUp account.
- **Steps:** 1. **Avatar → Settings → Apps → API Token → Generate**. 2. Copy,
  paste here, **Save**.
- **Note:** the token never expires and is not read-only; our card only reads
  without approval.

### Todoist — API card — Wave 1
- **We need:** base `https://api.todoist.com`, spec
  `https://developer.todoist.com/openapi.json`, `Bearer`.
- **User needs:** a Todoist account.
- **Steps:** 1. **app.todoist.com → Settings → Integrations → Developer** and
  copy the **API token**. 2. Paste here, **Save**.

### Monday.com — API card — Wave 1
- **We need:** base `https://api.monday.com/v2` (GraphQL), header
  `Authorization: <token>` with no `Bearer`. GraphQL reads are POST, so mark the
  query operation as a read in the card (a curated read list, see plan §8.6).
  Hosted MCP `mcp.monday.com/mcp` is listed (U).
- **User needs:** a Monday account.
- **Steps:** 1. **Avatar → Developers → API token → Show**, copy. 2. Paste
  here, **Save**.

### Airtable — API card — Wave 1
- **We need:** base `https://api.airtable.com/v0/`, `Bearer`. No official
  OpenAPI; write a small spec (list bases, list records, get record).
- **User needs:** an Airtable account.
- **Steps:**
  1. Open **airtable.com/create/tokens → Create new token**.
  2. Name it; add scopes **data.records:read** and **schema.bases:read** only.
  3. Under **Access**, add the bases the assistant may read.
  4. **Create token**, copy it (shown once), paste here, **Save**.

### Calendly — API card — Wave 1
- **We need:** base `https://api.calendly.com`, `Bearer`; small spec.
- **User needs:** Calendly; API access may need a paid plan (U).
- **Steps:** 1. **Integrations → API & Webhooks → Generate new token** (menu
  path (U)). 2. Give it read scopes (a new token has no access until scopes are
  granted). 3. Copy (shown once), paste here, **Save**.

### Cal.com — API card — Wave 1
- **We need:** base `https://api.cal.com/v2`, `Bearer cal_live_…`.
- **Steps:** 1. **Settings → Security → API Keys → New**. 2. Copy, paste here,
  **Save**.

### Zoho (CRM, Books, Desk, Mail…) — MCP — Wave 2
- **We need:** a **per-user server URL**: Zoho has the user create their own MCP
  server, and its URL carries a secret key ("treat your MCP Server URL like a
  password"). So the URL is stored as a credential, not on the row (plan Phase 9,
  user-supplied endpoint). No app registration for us.
- **User needs:** a Zoho account; a Zoho admin to create the MCP server.
- **Steps:**
  1. Sign in at **mcp.zoho.in** (or your region's Zoho MCP console).
  2. **Create MCP Server**; add the tools you want (pick view-only tools for
     read-only).
  3. Open **Connect** and copy the server URL.
  4. Paste it here and click **Connect**; sign in to Zoho and approve.

### Notion — Native — live today
- Steps already on the card: create an internal integration at
  `notion.so/my-integrations`, share pages with it, paste the token.

---

## 3. CRM and sales

### HubSpot — MCP — Wave 3 (spike)
- **We need:** an **MCP Auth App** in our HubSpot developer account (client id
  + secret, PKCE, `client_secret_post`). Whether a privately distributed app
  can serve any customer without HubSpot's Marketplace review is (U).
- **User needs:** a HubSpot account; HubSpot permissions decide what is visible.
- **Steps (if built):** 1. Click **Connect**. 2. Pick your HubSpot account,
  review permissions, **Connect app**.

### Pipedrive — API card — Wave 1
- **We need:** base `https://api.pipedrive.com/v1`, spec
  `developers.pipedrive.com/docs/api/v1/openapi.yaml`, token header
  `x-api-token` (U) or `api_token` query param.
- **User needs:** a Pipedrive account. One token per user; it has your full
  access.
- **Steps:** 1. **Settings → Personal preferences → API**. 2. Copy the token,
  paste here, **Save**.

### Close — API card — Wave 2
- **We need:** base `https://api.close.com/api/v1/` (U), Basic auth with the key
  as username (U). Confirm in the live check.
- **Steps:** 1. **Settings → API Keys → New API Key**. 2. Copy, paste, **Save**.

### Salesforce — OAuth API card — Wave 3
- Not yet researched. Needs a Salesforce Connected App and the OAuth preset
  (plan Phase 12).

---

## 4. Customer support

### Zendesk — OAuth API card — Wave 3
- **We need:** Zendesk now calls API tokens deprecated, and a token acts as the
  admin who made it. Use OAuth (plan Phase 12): register an OAuth client per
  Zendesk subdomain (U: global client option).
- **User needs:** Zendesk admin to approve.
- Base `https://{subdomain}.zendesk.com/api/v2`.

### Freshdesk — API card — Wave 1
- **We need:** base `https://{domain}.freshdesk.com/api/v2` (per-account
  domain, Phase 10), Basic auth with the API key as username and `X` as
  password. Freshdesk also runs an official MCP that takes only an API key; its
  endpoint is (U).
- **User needs:** a Freshdesk agent or admin account.
- **Steps:** 1. Click your **profile picture → Profile settings**; copy **Your
  API Key**. 2. Enter your Freshdesk domain (e.g. `acme` from
  `acme.freshdesk.com`) and the key, **Save**.
- **Note:** the key has your agent's full permissions.

### Intercom — API card — Wave 2
- **We need:** base `https://api.intercom.io`, `Bearer`, spec
  `github.com/Intercom/Intercom-OpenAPI`. A hosted MCP
  `mcp.intercom.com/mcp` is listed (U); prefer it if confirmed.
- **User needs:** Intercom workspace admin.
- **Steps:** 1. **Developer Hub → New app → Configure → Authentication**, copy
  the access token. 2. Paste here, **Save**.

---

## 5. Marketing, email and forms

### Mailchimp — API card — Wave 1
- **We need:** base `https://{dc}.api.mailchimp.com/3.0/` (the `dc` is the
  suffix after the dash in the key, e.g. `us21`), Basic auth (any username, key
  as password), spec `https://api.mailchimp.com/schema/openapi/OpenAPI.json`.
- **User needs:** Mailchimp Manager role or higher.
- **Steps:** 1. **Profile → Extras → API keys → Create A Key**. 2. Copy it
  (shown once), paste here, **Save**.
- **Note:** keys made after 2026-06-22 expire after one year; the card warns a
  month before.

### Klaviyo — API card — Wave 1
- **We need:** base `https://a.klaviyo.com/api/`, header `Authorization:
  Klaviyo-API-Key <key>` plus a `revision` header (header prefix + static header,
  Phase 10), spec `github.com/klaviyo/openapi`. Hosted MCP `mcp.klaviyo.com/mcp`
  is listed (U).
- **Steps:** 1. **Your organisation name (bottom left) → Settings → API keys →
  Create Private API Key**. 2. Choose **Read-only access**. 3. Copy, paste,
  **Save**.

### SendGrid — API card — Wave 1
- **We need:** base `https://api.sendgrid.com/v3`, `Bearer SG.…`.
- **Steps:** 1. **Settings → API Keys → Create API Key**. 2. Choose
  **Restricted Access** and give **Read** only to the parts you need (Stats,
  Suppressions…). 3. Copy (shown once), paste, **Save**.

### Brevo — API card — Wave 1
- **We need:** base `https://api.brevo.com/v3/`, header `api-key: xkeysib-…`.
  Hosted MCP `https://mcp.brevo.com/v1/brevo/mcp` with API-key auth is listed
  (U).
- **Steps:** 1. **app.brevo.com/settings/keys/api → Generate a new API key**
  (labels (U)). 2. Copy, paste, **Save**. (Keys have full access (U).)

### Postmark — API card — Wave 1
- **We need:** base `https://api.postmarkapp.com`, header
  `X-Postmark-Server-Token`.
- **Steps:** 1. Open your **Server → API Tokens**, copy the server token.
  2. Paste, **Save**.

### Typeform — API card — Wave 1
- **We need:** base `https://api.typeform.com`, `Bearer` (U: scheme).
- **Steps:** 1. **Account → Personal tokens → Generate a new token**. 2. Pick
  read scopes only (`forms:read`, `responses:read`, `workspaces:read`).
  3. Copy, paste, **Save**.

### Jotform — API card — Wave 1
- **We need:** base `https://api.jotform.com` (EU `eu-api.jotform.com`, HIPAA
  `hipaa-api.jotform.com`: region field), header `APIKEY`.
- **User needs:** daily API caps by plan (Starter 1,000 calls/day).
- **Steps:** 1. **jotform.com/myaccount/api → Create New Key** (a read-only
  option is (U)). 2. Copy, paste, pick your region, **Save**.

### Webflow — API card — Wave 2
- **We need:** base `https://api.webflow.com/v2`, `Bearer`.
- **Steps:** 1. **Site settings → Apps & integrations** and generate a site
  API token with read scopes (exact labels (U)). 2. Copy, paste, **Save**.

### Contentful — API card — Wave 1
- **We need:** base `https://cdn.contentful.com` (Content Delivery API, which is
  read-only by design), `Bearer`, plus the space id.
- **Steps:** 1. **Space → Settings → API keys → Add API key**. 2. Copy the
  **Space ID** and **Content Delivery API access token**. 3. Paste both,
  **Save**.

---

## 6. Commerce and payments

### Stripe — MCP — Wave 2 (read-only)
- **We need:** nothing to register (automatic registration advertised live,
  public client). Endpoint `https://mcp.stripe.com`. Our tool list leaves out
  every write and money-moving tool.
- **User needs:** a Stripe account; a Stripe admin can switch MCP access off for
  the whole team.
- **Steps:** 1. Click **Connect**. 2. Sign in to Stripe, choose **Sandbox**
  (recommended) or live, review permissions, approve.
- **Note:** Stripe ends the connection 14 days after you approve it, however
  often it is used. The card asks you to sign in again from day 11.

### Razorpay — MCP — Wave 2
- **We need:** endpoint `https://mcp.razorpay.com/mcp`. Auth is Razorpay key id
  + secret (sent as one token) or OAuth (U: whether third parties can register).
  A key has full account power, so prefer OAuth; if only keys work, our tool list
  holds reads only (payments, orders, settlements).
- **User needs:** an activated Razorpay account (India).
- **Steps (key route):** 1. **Razorpay Dashboard → Account & Settings → API
  Keys → Generate Key** (U: menu path). 2. Use **Test mode** keys first.
  3. Paste Key Id and Key Secret, **Save**.

### Shopify — OAuth API card — Wave 3
- **We need:** Shopify no longer lets stores create admin custom apps in the
  admin; new apps come from the **Dev Dashboard** or Shopify CLI. So this is an
  OAuth app we register (plan Phase 12). Header `X-Shopify-Access-Token`; base
  `https://{shop}.myshopify.com/admin/api/{version}/graphql.json`.
- **User needs:** store owner or staff with app permissions.

### WooCommerce — API card — Wave 1
- **We need:** base `https://{store}/wp-json/wc/v3` (per-store URL, Phase 10),
  Basic auth with consumer key and secret, HTTPS only.
- **User needs:** WordPress admin on the store.
- **Steps:** 1. **WooCommerce → Settings → Advanced → REST API → Add key**.
  2. Pick a user and set **Permissions: Read**. 3. **Generate API key**; copy
  the consumer key and secret. 4. Enter your store URL and both values, **Save**.

### Shiprocket — API card — Wave 2
- **We need:** Shiprocket issues a short-lived token from a login call (email +
  password of an "API user"), so the card needs a **login-for-token** auth type
  (Phase 10). Base from `apidocs.shiprocket.in`.
- **Steps:** 1. **Shiprocket panel → Settings → API → Configure → Create an API
  User**. 2. Set its email and password. 3. Paste them here, **Save**.

### Cashfree — ✗ for now
- Their MCP server is local-only (a Node process), which production does not run.
  Possible later as an API card with app id + secret per product.

### Paytm — ✗ for now
- Paytm's MCP server is available by request only (U). Revisit if they open it.

### PhonePe, Plaid — ✗
- PhonePe's API is for merchant checkout, not reading an account. Plaid needs
  production approval and its own Link flow.

---

## 7. Investing (India)

**Rule for this section:** read-only, always. Since 1 April 2026, SEBI requires
API orders to come from a static IP registered to that one client (Zerodha,
Angel One and Dhan all say so). A shared server cannot meet that for many users,
and placing trades is not something an assistant should do unattended anyway.
Brokers also expire logins **every day**, so the card says "Sign in again each
morning".

### Zerodha (Kite) — MCP — Wave 2
- **We need:** endpoint `https://mcp.kite.trade/mcp` (free). Our tool list keeps
  only reads: holdings, positions, margins, orders, trades, quotes, mutual funds.
  No GTT or order tools. Two things to settle first: whether Zerodha allows a
  third-party platform to connect (U), and whether their login (a link returned
  by a `login` tool) survives our pooled sessions, which close after 5 idle
  minutes (agent-loop risk, check in Phase 4).
- **User needs:** a Zerodha account with 2FA.
- **Steps:** 1. Click **Connect**. 2. Open the Kite login link the assistant
  shows, sign in with your Zerodha ID, password and 2FA. 3. Repeat each trading
  day (Zerodha ends API logins at 6 AM).
- **Note:** Kite's terms forbid redistributing live market data. The assistant
  shows your own data to you only.

### Upstox — MCP — Wave 2
- **We need:** endpoint `https://mcp.upstox.com/mcp`. Read-only by Upstox's own
  design ("you cannot place orders"). Registration method (U).
- **Steps:** 1. Click **Connect**. 2. Sign in to Upstox and approve. 3. Repeat
  daily ("connections expire daily").

### Groww, Angel One, Dhan — ✗ for now
- Groww: ₹499/month subscription plus a **daily manual approval** of the key.
  Angel One and Dhan: no MCP; their APIs need per-client static IPs for orders
  and daily tokens. Possible later as read-only API cards (holdings, positions);
  low priority.

---

## 8. Food and local (India)

### Zomato — MCP — Wave 3 (spike)
- **We need:** endpoint `https://mcp-server.zomato.com/mcp` (publisher: Eternal
  Ltd, Zomato's parent). Sign-in links your phone number by OTP; whether it is
  OAuth is (U). Some sources mention an access form (U).
- **Tools:** restaurant search, menus, cart, offers, saved addresses, order
  history and tracking, and `checkout_cart`, which **places a real order** with
  QR payment.
- **Our setting:** reads and cart only at first. `checkout_cart` never runs
  without an explicit approval, and never in unattended runs.
- **Steps (if built):** 1. Click **Connect**. 2. Enter your phone number and the
  OTP Zomato sends. Done.

### Swiggy (Food, Instamart, Dineout, Scenes) — MCP — Wave 3 (apply)
- **We need:** four endpoints (`mcp.swiggy.com/food`, `/im`, `/dineout`,
  `/scenes`), OAuth 2.1 with PKCE. **Production access is invite-only**: apply
  through the Swiggy Builders Club form, terms per partner.
- **Action for you:** apply at `mcp.swiggy.com/builders`. Build only once
  accepted.

### Not possible (no public API, partner-only)
IRCTC, MakeMyTrip, BookMyShow, Practo, Meesho, Ola/Uber rides, ONDC (needs
network-participant onboarding), DigiLocker (government partner approval),
Tally (runs on the user's own PC; no cloud API), ClearTax (GSP partner route).
Flipkart Seller API is possible for sellers only (Seller Dashboard → Manage
Profile → Developer Access); low priority.

---

## 9. Data and warehouses (SQL engine)

All of these run through `query_sql`, so the same safety holds for each: the
statement is parsed and must be a read; a row cap and a time limit apply; big
results spill to a file. Each card's steps include **creating a read-only
login** in the database, because a parser is a second line, not the first.
Where the vendor has an HTTP SQL API we use it instead of a heavy Python driver
(production is a small shared box).

### PostgreSQL / MySQL — SQL — live today
- Existing driver. Steps already on the Custom tools page.

### Supabase / Neon (as a database) — SQL — Wave 1
- **We need:** presets on the Postgres card (host pattern, port, SSL on). Neon:
  the `-pooler` host. Supabase: the pooler on port 5432 (session mode).
- **Steps (Supabase):**
  1. In the SQL editor, create a read-only role:
     `create role ai_reader login password '…';`
     `grant usage on schema public to ai_reader;`
     `grant select on all tables in schema public to ai_reader;`
  2. **Connect → Session pooler**; copy host, port and database name.
  3. Paste them with the user `ai_reader.<project-ref>` (pooler user format
     (U)) and password, **Save**.

### Snowflake — SQL (HTTP SQL API) — Wave 2
- **We need:** a Snowflake driver that calls `POST https://<account>.
  snowflakecomputing.com/api/v2/statements` with **key-pair (JWT)** auth: no
  heavy driver, only `cryptography` + JWT signing. Reject `CALL`, `EXECUTE
  IMMEDIATE`, `COPY INTO`, multi-statement batches. Pass `timeout`.
- **User needs:** a Snowflake role that can create users/roles (to set up a
  read-only user), and a warehouse. Snowflake bills warehouse time when a query
  wakes it (60-second minimum each start).
- **Steps:**
  1. Generate a key pair on your computer (the card shows the two `openssl`
     commands).
  2. In a Snowflake worksheet, create a read-only role and user:
     `create role ai_reader;` `grant usage on warehouse <wh> to role ai_reader;`
     `grant usage on database <db> to role ai_reader;`
     `grant usage on schema <db>.<schema> to role ai_reader;`
     `grant select on all tables in schema <db>.<schema> to role ai_reader;`
     `create user ai_reader default_role=ai_reader default_warehouse=<wh>
     rsa_public_key='<public key>';` `grant role ai_reader to user ai_reader;`
  3. Set the warehouse to auto-suspend after 60 seconds to keep costs low.
  4. Paste your account identifier, user, warehouse, database, schema and the
     **private** key here, **Save**.
- **Alternative:** Snowflake also has managed MCP servers per account
  (`https://<account>/api/v2/databases/{db}/schemas/{schema}/mcp-servers/{name}`,
  OAuth or PAT). Status (U). The SQL card is simpler and keeps our checks.

### Databricks — SQL (Statement Execution API) — Wave 2
- **We need:** a driver calling `POST /api/2.0/sql/statements/` with
  `warehouse_id`, `row_limit`, `byte_limit`, `wait_timeout`, and
  `disposition=INLINE`. No `databricks-sql-connector` (it always installs
  pandas). Auth: personal access token (OAuth needs an admin-enabled app).
- **User needs:** a SQL warehouse; Unity Catalog grants. Idle warehouses keep
  billing until they auto-stop (serverless default 10 minutes).
- **Steps:**
  1. Create a service principal or use your user; grant it `USE CATALOG`,
     `USE SCHEMA` and `SELECT` only.
  2. Generate a personal access token in your user settings (menu path (U));
     copy.
  3. Open your SQL warehouse's **Connection details** (U); copy the server
     hostname and warehouse id.
  4. Paste host, warehouse id and token, **Save**.

### BigQuery — SQL (REST jobs.query) — Wave 2
- **We need:** a driver calling `POST bigquery.googleapis.com/bigquery/v2/
  projects/{p}/queries` with `useLegacySql=false`, `maximumBytesBilled`,
  `timeoutMs`; poll `getQueryResults` when not complete. Auth: a service-account
  JSON key (simplest), or Google OAuth with `bigquery.readonly` (we already hold
  a Google client; scope verification status (U)). Reject scripting
  (`DECLARE`, `EXECUTE IMMEDIATE`, `CALL`).
- **User needs:** a Google Cloud project with billing. BigQuery charges per data
  scanned (minimum 10 MiB per table per query).
- **Steps (service account; console labels (U)):**
  1. **Google Cloud console → IAM & Admin → Service accounts → Create**.
  2. Grant **BigQuery Data Viewer** and **BigQuery Job User**.
  3. **Keys → Add key → JSON**; download.
  4. Upload the file here, set a **maximum bytes per query** (default 1 GB),
     **Save**.

### Amazon Redshift — SQL (Data API) — Wave 3
- **We need:** the Redshift Data API needs AWS request signing; `boto3` is
  heavy for our box, so this waits for a size check. Auth: an IAM role the
  customer lets us assume, plus a database user.
- **User needs:** AWS admin to create the role; `GRANT SELECT` only.

### ClickHouse Cloud — SQL (HTTP) — Wave 1
- **We need:** a driver over ClickHouse's HTTP interface (port 8443) with
  `readonly=1` on every request; reject table functions (`url()`, `s3()`,
  `file()`). Hosted MCP `https://mcp.clickhouse.cloud/mcp` also exists
  (`run_select_query` is SELECT-only).
- **Steps (SQL syntax to confirm in the live check (U)):**
  1. In the SQL console: `create user ai_reader identified by '…' settings
     readonly = 1;` `grant select on <db>.* to ai_reader;`
  2. Copy your service's **HTTPS** host from **Connect**.
  3. Paste host, user and password, **Save**.

### MongoDB Atlas — new `query_mongo` tool — Wave 2
- **We need:** MongoDB's HTTP Data API shut down on 2025-09-30, so this uses
  `pymongo` (small: ~1 MB). It is not SQL: a new read tool that takes
  `find` / `aggregate` / `count` and **rejects** `$out`, `$merge`, `$function`,
  `$accumulator`, `$where` stages, with `maxTimeMS` and a result cap.
- **Steps (Atlas labels (U)):**
  1. **Atlas → Database Access → Add New Database User**; role **Read Only**
     (`read`) on your database.
  2. **Network Access →** allow our server's IP (shown on the card).
  3. **Connect → Drivers**; copy the `mongodb+srv://` string.
  4. Paste it with the user's password, **Save**.

---

## 10. Communication

### Slack — Messaging (live) — MCP ✗
- Slack's MCP server accepts only apps listed in the Slack Marketplace (or
  internal apps). Reading and posting already work in **Messaging** with a bot
  token.

### Telegram — Messaging — Wave 2
- Bot token in the URL path (`api.telegram.org/bot<token>/…`). Fits Messaging
  better than an API card.
- **Steps:** 1. In Telegram, message **@BotFather**, send `/newbot`, pick a name
  and a username ending in `bot`. 2. Copy the token, paste it here, **Save**.

### Discord — Messaging — Wave 2
- `Authorization: Bot <token>`, base `https://discord.com/api/v10`.
- **Steps (labels (U)):** 1. **discord.com/developers → New Application → Bot
  → Reset Token**, copy. 2. Invite the bot to your server with read-message
  permissions. 3. Paste the token, **Save**.

### Twilio — API card — Wave 2
- Basic auth with **API Key SID + Secret** (two secrets). Spec
  `github.com/twilio/twilio-oai`. SMS sending is already a Messaging channel; the
  card adds reading message logs and call records.

---

## 11. Files and office

- **Google** (Gmail, Drive, Sheets, Calendar, Docs): native, live.
- **Microsoft 365** (Outlook, OneDrive, Teams, Excel), **Dropbox**, **Box**,
  **Zoom**: need the OAuth preset (plan Phase 12) and an app registered with
  each vendor. Not yet researched in depth.

---

## 12. Utilities

### OpenWeather — API card — Wave 1
- `appid=<key>` query param, base `https://api.openweathermap.org`.
- **Steps:** 1. Sign up at **openweathermap.org**; the key arrives by email (also
  at **home.openweathermap.org/api_keys**). 2. Paste it, **Save**. New keys can
  take a while to start working (U: delay).

### Google Maps Platform — API card — Wave 2
- `key=` query param. A leaked unrestricted key **bills your Google account**,
  so the steps insist on restrictions.
- **User needs:** a Google Cloud project with **billing enabled**.
- **Steps:** 1. **Cloud console → Google Maps Platform → Keys & Credentials →
  Create credentials → API key**. 2. **Restrict key**: API restrictions → only
  the APIs you need (Places, Geocoding); application restrictions → **IP
  addresses** → our server IP (shown on the card). 3. Paste, **Save**.

---

## 13. "Everything else": an aggregator card (decision needed)

One integration that brings thousands of apps. Researched options:

| Option | Fits a multi-user product? | Cost at ~50 users / 10k calls a month | Watch out |
|---|---|---|---|
| **Pipedream Connect** | Yes: per-user ids, our own OAuth clients allowed | ~$99/month (Startup, 100 users) | Free tier is development-only; Pipedream may show on the sign-in screen (U) |
| Composio | Yes: per-user MCP URLs, tool allowlists, approval hook (experimental) | ~$0–18/month | **May 2026 security incident leaked customer credentials** |
| Arcade.dev | Yes, if we use its sign-in modes (not header mode) | ~$125/month | SOC 2 wording inconsistent |
| Merge Agent Handler | Yes | ~$1,000/month | Expensive |
| Zapier MCP | **No**: each user needs their own Zapier account and token | — | Built for one person, not a product |
| Nango | Self-hostable, but MCP/tool calls are enterprise-only; licence is Elastic 2.0 | ~$50 + compute | Licence question for a hosted product |

Recommendation: **wait.** Ship our own cards first; revisit Pipedream Connect
only if users ask for apps we do not have. Every aggregator means a third party
holds every user's tokens.

---

## 14. Design and whiteboards

| Connector | Engine · Wave | We need | User needs | Steps |
|---|---|---|---|---|
| **Miro** | MCP · 1 | Nothing: automatic registration (verified live, `mcp.miro.com`), scope `boards:read` | Any Miro plan, free included | S1, then pick your Miro team |
| **Figma** | MCP · 3 | Registration is advertised (`mcp.figma.com/mcp`), but Figma reportedly accepts only clients on its **MCP Catalog** (U). Apply to be listed | A Figma account; writing needs a full seat | S1, once listed |
| **Canva** | MCP · 3 | `mcp.canva.com/mcp` advertises registration, but Canva **reviews each app before launch**. Apply | A Canva account | S1, once approved |
| **Coda / Superhuman Docs** | MCP · 2 | Coda's MCP (registration verified) is being replaced by the Superhuman Docs MCP; build on the new one. OAuth grants read **and** write, so our tool list keeps reads | A Coda account | S1 |

## 15. Files, meetings and office suites

| Connector | Engine · Wave | We need | User needs | Steps |
|---|---|---|---|---|
| **Microsoft 365** (Outlook, OneDrive, Teams, Excel, SharePoint) | OAuth API card · 3 | A multi-tenant Entra app plus **publisher verification** (free Microsoft partner account) so users see no "unverified" warning; Graph OpenAPI spec (`msgraph-metadata`, verified). Microsoft's own MCP covers directory data only, not mail or files | A work or school account; some companies need an admin to approve the app | 1. Click **Connect**. 2. Sign in with your work account. 3. Accept the read permissions (mail, files, calendar). 4. If it says "Need admin approval", ask IT to grant consent for AIAAS |
| **Dropbox** | MCP · 3 (spike) | `mcp.dropbox.com/mcp` (beta; rate-limited when probed). Registration (U) | A Dropbox account | S1 |
| **Box** | MCP · 3 | `mcp.box.com`. A Box **admin** enables it in **Admin Console → Integrations** and creates the client id and secret. No read-only scope, so our list keeps reads | A Box admin | 1. Admin enables Box MCP and gives us the client details. 2. S1 |
| **Zoom** | MCP · 3 | No automatic registration: register a **General app** in the Zoom App Marketplace (OAuth + PKCE). Regional endpoint, exact path (U) | A Zoom account | S1, after our app is published |
| **Webex** | MCP · 3 | No automatic registration; register a Webex integration. The **org admin** enables it in Control Hub | Webex org admin approval | 1. Admin enables AIAAS in **Control Hub**. 2. S1 |
| **Loom** | via Atlassian | Loom's tools sit inside the Atlassian MCP (§2) | — | — |

## 16. Finance, payroll, HR and legal

| Connector | Engine · Wave | We need | User needs | Steps |
|---|---|---|---|---|
| **Xero** | MCP · 2 | `api.xero.com/mcp/v1`, OAuth + PKCE, no client secret; registration (U). Its V1 tools **don't ask before writing**, so request granular read scopes only (e.g. `accounting.transactions.read`) | Xero **Core plan or higher** (Starter: demo company only); 5,000 calls/day per company | S1, then pick your organisation |
| **QuickBooks Online** | OAuth API card · 3 | No hosted MCP (Intuit's is local-only). Register an Intuit app; production keys need Intuit's **app assessment** | A QuickBooks Online subscription | 1. Click **Connect**. 2. Sign in to Intuit, pick your company, **Connect** |
| **Gusto** | MCP · 3 (spike) | `mcp.api.gusto.com`, registration verified. It has **run_payroll**, **file_ein** and other writes; reads only, and the spike must prove writes can't be reached | Company **admin** | S1, choosing data categories on the consent screen |
| **BambooHR** | MCP · 3 | Per company `https://{subdomain}.bamboohr.com/api/mcp` (beta). No automatic registration: register an app in BambooHR's developer portal | An **admin** turns on **Settings → Apps → AI Connectors** | 1. Admin turns on AI Connectors. 2. Enter your subdomain, then S1 |
| **Greenhouse** | MCP · 3 | `mcp.us.greenhouse.io` (US only) advertises registration, but **custom clients must be added to Greenhouse's redirect allow-list by contacting them** | Admin sets **Dev Center → MCP Access** with read scopes | 1. Admin creates MCP access with read scopes. 2. S1 |
| **Salesforce** | MCP · 3 | Hosted MCP needs an **External Client App** (not a Connected App), scope `mcp_api` | Admin enables **Setup → MCP Service** | 1. Admin enables the MCP service. 2. S1 |
| **DocuSign** | ✗ for now | `mcp.docusign.com` exists but its discovery is broken (DocuSign community, Sept 2026). Our `esign` app already sends for signature | — | — |
| **FreshBooks** | ✗ | No official MCP or confirmed third-party API route | — | — |

## 17. Product analytics and monitoring

| Connector | Engine · Wave | We need | User needs | Steps |
|---|---|---|---|---|
| **Mixpanel** | MCP · 1 | Registration verified. Region field: US `mcp.mixpanel.com/mcp`, EU `mcp-eu.mixpanel.com/mcp`, India `mcp-in.mixpanel.com/mcp`. No read-only mode, so reads only in our list. 600 calls/hour per user | An **org admin** turns on MCP (**Settings → Org → AI Settings**); on by default for free/growth accounts made after 2026-08-01 | 1. Pick your region. 2. S1 |
| **Amplitude** | MCP · 1 | Registration verified; US `mcp.amplitude.com/mcp`, EU `mcp.eu.amplitude.com/mcp`; scope `all:read` | **Plus add-on or Enterprise**. For read-only, an admin gives you a role with MCP write off | 1. Pick your region. 2. S1 |
| **PostHog** | MCP · 1 | `mcp.posthog.com/mcp`; registration via `oauth.posthog.com` (verified) | A PostHog account | S1. Or **Settings → Personal API keys → Create** with read scopes (e.g. `insight:read`) and paste it |
| **Grafana Cloud** | MCP · 1 | `mcp.grafana.com/mcp`, registration verified; tokens 1 hour, refresh up to 30 days | Grafana Cloud with the Assistant on; role **Assistant Cloud MCP User** | 1. S1. 2. On the consent page keep **Read** on; turn **Write** and **Query** off |
| **New Relic** | MCP · 2 | US `mcp.newrelic.com/mcp/`, EU `mcp.eu.newrelic.com/mcp/` (U); scope `observability:read`; registration (U) | A **paid** New Relic plan | S1, or paste a **User API key** (`NRAK-…`) |
| **Google Analytics 4** | API card (Google sign-in) · 2 | Our Google OAuth client with `analytics.readonly`; Google may require app verification for it (U) | Access to the GA4 property | 1. Click **Connect**, sign in with Google. 2. Enter the GA4 **property id** (Admin → Property details) |
| **Google Search Console** | API card (Google sign-in) · 2 | Scope `webmasters.readonly` (verified) | Access to the property | 1. Click **Connect**, sign in with Google. 2. Pick the site |
| **YouTube (public data)** | API card · 1 | API key as `key=`; base `www.googleapis.com/youtube/v3`; 10,000 quota units/day per key | A Google Cloud project | 1. **Cloud console → APIs & Services → enable YouTube Data API v3 → Credentials → Create API key**, restrict it to that API. 2. Paste it |
| **Segment** | API card · 2 | `Authorization: Bearer <token>`; API host (U) | **Team or Business** plan; a workspace owner makes the token | 1. Owner: **Settings → Workspace settings → Access Management → Tokens → Create Token**. 2. Paste it |

## 18. More developer and business tools

| Connector | Engine · Wave | We need | User needs | Steps |
|---|---|---|---|---|
| **GitLab** | MCP · 1 | `gitlab.com/api/v4/mcp` (GA), automatic registration per GitLab's docs. No read-only mode: narrow with header `X-Gitlab-Enabled-Mcp-Server-Toolsets`, reads only in our list | Any plan; a group owner may need to allow MCP for the top-level group | S1 |
| **Bitbucket** | API card · 2 | App passwords ended June 2026; use **scoped API tokens**. Auth Basic `email:token` (U), base `api.bitbucket.org/2.0` (U) | An Atlassian account | 1. **Atlassian account → Security → Create API token with scopes → Bitbucket**, read scopes. 2. Paste email and token |
| **CircleCI** | API card · 2 | MCP `mcp.circleci.com/v1/mcp` exists, but its OAuth metadata path 404'd, so start with the personal token | A CircleCI account | 1. **User settings → Personal API Tokens → Create**. 2. Paste it |
| **Azure DevOps** | MCP · 3 | `mcp.dev.azure.com/{org}`, Entra sign-in only (no automatic registration); headers `X-MCP-Readonly: true`, `X-MCP-Toolsets` | An Entra-backed Azure DevOps org | 1. Enter your organisation name. 2. Sign in with your work account |
| **Postman** | MCP · 1 | US `mcp.postman.com/minimal`, registration verified. EU is API-key only | A Postman account | S1 (EU: **Settings → API keys → Generate**, paste) |
| **Hugging Face** | MCP · 1 | `huggingface.co/mcp`, registration verified; leave Jobs and repo-writing tool groups off | A Hugging Face account | S1 |
| **BrowserStack** | MCP · 2 | `mcp.browserstack.com/mcp`, OAuth; registration (U). Test sessions use paid minutes: reads only | A BrowserStack plan | S1 |
| **Mapbox** | MCP · 1 | `mcp.mapbox.com/mcp`, registration verified | A Mapbox account | S1 |
| **Freshsales** | API card · 1 | `https://{domain}.freshsales.io/api/`, header `Authorization: Token token=<key>`; 1,000 calls/hour | A Freshsales account | 1. **Profile picture → Profile Settings → API Settings**, copy **Your API key**. 2. Enter your domain and the key |
| **Chargebee** | API card · 1 | `https://{site}.chargebee.com/api/v2`, Basic auth with the key as username. Chargebee also has hosted MCP servers per site (U: auth) | An **admin** creates a **read-only** key | 1. **Settings → Configure Chargebee → API Keys and Webhooks → Add API key → Read-only key**. 2. Enter your site name and the key |
| **NewsAPI** | API card · 2 | Base `newsapi.org/v2`, key header (U). Free plan is development-only (24-hour delay); production needs a paid plan | A NewsAPI account | 1. Register at **newsapi.org**, copy the key from your account page. 2. Paste it |

## 19. Social networks

| Connector | Engine · Wave | We need | User needs | Steps |
|---|---|---|---|---|
| **X (Twitter)** | MCP · 3 | `api.x.com/mcp?read_only=true` (write tools removed). No automatic registration: we register an X app and supply its Client ID. **X bills per read** (pay-per-use credits, e.g. $0.005 per post read): decide who pays | An X account | S1, once our app is registered and funded |
| **LinkedIn** | ✗ | No official MCP; useful APIs need partner programs with review | — | — |
| **Meta (Instagram, Facebook Pages)** | ✗ for now | Meta's hosted MCP covers Ads, DevTools and WhatsApp Business only; organic reads need **App Review + Business Verification** | — | — |
| **Reddit** | ✗ | Self-serve API apps closed; access by request; commercial use needs a contract | — | — |

## 20. More Indian services

| Connector | Engine · Wave | We need | User needs | Steps |
|---|---|---|---|---|
| **Exotel** | MCP · 2 | `mcp.exotel.com/mcp` (62 tools); credentials go in a JSON `Authorization` header (key, token, account SID). Calls and SMS cost money and reach people: reads only (call and SMS logs, number lookup) | An Exotel account; only **admins** see the API token | 1. **my.exotel.com → Settings → API Settings → API Credentials**. 2. Paste key, token and account SID |
| **WATI** (WhatsApp) | MCP · 2 | `mcp.wati.io/mcp` (EU and KSA hosts too), OAuth. Send and broadcast reach customers: reads only (contacts, conversations, templates, credits) | A WATI subscription | 1. Pick your region. 2. S1 |
| **MoEngage** | MCP · 2 | `mcp.moengage.com`, OAuth. It can pause or stop live campaigns: reads only (stats, segments, dashboards) | A MoEngage workspace | S1 |
| **Setu BillPay** | MCP · 3 | `billpay-mcp.setu.co/mcp`, OAuth + phone OTP. **Paying bills moves money**: view bills and history only | A phone number on Setu | 1. S1. 2. Enter the OTP Setu sends |
| **Juspay** | API card · 2 | `api.juspay.in`, Basic auth (key as username) + header `x-merchantid`. Their MCP is local-only. Reads only (order status, gateways) | A Juspay merchant account | 1. **Dashboard → Settings → Security → Create API Key** (U). 2. Paste key and merchant id |
| **Ola Maps** | API card · 1 | API key; geocoding, places, directions (all reads). Prepaid credits since 2026-09-01 | An Ola Maps account with credits | 1. Create a key in the Ola Maps console (path (U)). 2. Paste it |
| **Mappls (MapmyIndia)** | API card · 2 | REST key from `apis.mappls.com/console` (auth details (U)) | A Mappls developer account | 1. Create a key in the console. 2. Paste it |
| **Bhashini** | API card · 2 | Indian-language translation and speech; headers `userID` + `ulcaApiKey` (U); free for integrators (U) | A Bhashini (ULCA) account | 1. Register at **bhashini.gov.in/ulca**, verify email. 2. **My Profile → Generate** a key. 3. Paste user id and key |
| **Sarvam AI** | API card · 2 | Header `api-subscription-key`; speech and translation; credit-based | A Sarvam account | 1. **indus.sarvam.ai/key-management → API Keys → Create** (shown once). 2. Paste it |
| **IndiaMART** | Inbound webhook · 2 | IndiaMART **pushes** each new lead to a URL; our webhook trigger already starts an agent from a URL, so a lead can start a follow-up agent. The pull API is being retired | A **paid** seller with the Push API add-on | 1. In AIAAS, give an agent a **webhook** trigger and copy its URL. 2. **seller.indiamart.com → Lead Manager → ⋮ → Import/Export Leads → Push API**, paste the URL, confirm the OTP |
| **Zoho Books, Zoho Desk** | via Zoho MCP (§2) | Listed in the Zoho MCP builder; the user adds their tools to their Zoho server | — | See Zoho |
| **CleverTap** | ✗ for now | MCP in private beta for selected customers | — | — |
| **Gupshup, Interakt, AiSensy** | Messaging candidates | WhatsApp send APIs belong in Messaging, not connectors (24-hour window and template rules) | — | — |
| **Delhivery, Instamojo** | ✗ for now | Delhivery's API is behind its login and its MCP is local-only; Instamojo's docs could not be confirmed | — | — |
| **Khatabook, Vyapar, Zepto, Blinkit, PolicyBazaar, CRED, Tata 1mg, Jio, Airtel** | ✗ | No public API (partner or enterprise only) | — | — |

---

## 21. Compared with Perplexity (read 2026-11-24)

From Perplexity's own help centre (Connectors & Integrations collection,
Premium Data Sources, plugin and admin articles).

### Their list, against ours

| Perplexity connector | Their plan | Reads / acts | Ours |
|---|---|---|---|
| Google Drive, Gmail, Google Calendar | Pro+ | Read; Calendar edit; send/create only in Comet | **Live** (native) |
| Notion | Max+ | Read | **Live** (native) |
| Dropbox, Box | Pro+ | Read (live search; "High-Precision" indexes chosen files) | §15, Wave 3 |
| Microsoft 365 (SharePoint, OneDrive) | Pro+ | Read **and** write, 55 tools | §15, Wave 3 (OAuth preset) |
| Outlook.com | — | Read inbox + primary calendar | **Gap**: add with Microsoft 365 (same Graph app) |
| Microsoft Teams | Paid | Read + send messages | **Gap**: Messaging channel already lists Teams (PLATFORM_CAPABILITIES_PLAN); confirm it reads too |
| Slack | Pro+ | Read + send | Messaging (bot token); MCP blocked (§10) |
| Asana, Jira, Confluence | Paid | Read + create/update/delete | §2 (Asana Wave 2; Atlassian spike) |
| Linear | Enterprise only | Read + create/update | §1, **Wave 1** (we can offer it to everyone) |
| GitHub | Pro+ | Read + write | §1, Wave 2 |
| HubSpot | Pro+ | **Read-only** | §3, spike |
| Salesforce | Pro+ | Read + write (no bulk, no email) | §16, Wave 3 |
| Snowflake | Pro+ | Read-only (user OAuth or key pair) | §9, Wave 2 (key pair) |
| Databricks | Pro+ | Arbitrary SQL; read-only only via Unity Catalog grants | §9, Wave 2 (our parser + grants) |
| Apple Health | iPhone app only | Read | **Gap / idea**: our Expo app could read HealthKit on iOS (and Health Connect on Android); needs its own privacy design |
| Custom remote MCP (Mac app, Enterprise) | — | — | Retired here by choice (H-169) |

### Data they license (no user sign-in)

Included for everyone: Wiley (academic), PitchBook, CB Insights, Statista,
Midpage (US legal). With the user's own licence: FactSet, Morningstar, Crunchbase,
Interactive Brokers, Coinbase and about 20 more. **Not for us now**: these are
paid data deals, not connectors. The connector-shaped ones (Crunchbase,
Interactive Brokers, Coinbase) can be researched as cards later.

### What is worth copying

1. **Per-tool Allow / Always ask / Disable** on every connector tool. We have it
   for built-in tools (`toolPermissions`, `agents/config.py`) and modes for MCP
   (`connectors: {mode: all|read|selected}`), but not "always ask" per MCP tool.
   Candidate for Phase 3.
2. **Mention a connector in chat** (`@hubspot`, or "+ → Use a plugin") so the
   model knows which source to use this turn. Our slash commands are the place.
3. **Live search by default, index only what the user picks.** Matches our native
   Drive tools; keep it for Dropbox/Box when built.
4. **Admin controls for organisations**: a connector switch per org, who may use
   it (all / admins / roles), and a default of *off* for new connectors. We have
   organisations (`core.Organization`); this is a later phase.
5. **Say plainly what a connector cannot do** (their "not supported" lists). Our
   `setup_guide.limits` is exactly that field.
6. **A "propose a connector" form**, reviewed by their team. Cheap; a later UI
   item.

### Where we are ahead

Linear for every plan (theirs is Enterprise-only), Mixpanel, Amplitude, PostHog,
Grafana, GitLab, Sentry, Stripe, 23 API-key apps and the Indian services
(Zerodha, Upstox, Zomato, Razorpay, Zoho, Exotel, WATI…) have no Perplexity
equivalent in their help centre.
