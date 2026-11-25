# Connector probe, 2026-11-26

`manage.py connector_check --probe --all` sends one GET per API card with an obviously fake key. REACHABLE means the host, the path and the auth placement reached the vendor, which refused the fake key.
It does not prove that a real key works, that the response has the shape the card expects, or that a SKIPPED card (one that needs a form field) would pass with its field filled.

| Slug | Operation | Status | Verdict | Note |
|---|---|---|---|---|
| airtable | `GET /meta/whoami` | 401 | REACHABLE |  |
| brevo | `GET /account` | 401 | REACHABLE |  |
| calcom | `GET /me` | 401 | REACHABLE |  |
| calendly | `GET /users/me` | 401 | REACHABLE |  |
| clickup | `GET /user` | 401 | REACHABLE |  |
| cloudflare | `GET /user/tokens/verify` | 400 | WARN | path or host suspect |
| contentful | `GET /entries` | - | SKIPPED | needs field space_id |
| digitalocean | `GET /v2/account` | 401 | REACHABLE |  |
| freshdesk | `GET /agents/me` | - | SKIPPED | needs field subdomain |
| jotform | `GET /user` | - | SKIPPED | needs field region |
| klaviyo | `GET /lists` | 401 | REACHABLE |  |
| mailchimp | `GET /ping` | - | SKIPPED | needs field dc |
| netlify | `GET /user` | 401 | REACHABLE |  |
| openweather | `GET /data/2.5/weather` | 401 | REACHABLE |  |
| pagerduty | `GET /abilities` | 401 | REACHABLE |  |
| pipedrive | `GET /users/me` | 401 | REACHABLE |  |
| postmark | `GET /server` | 401 | REACHABLE |  |
| sendgrid | `GET /user/profile` | 401 | REACHABLE |  |
| todoist | `GET /api/v1/projects` | 401 | REACHABLE |  |
| trello | `GET /members/me` | 401 | REACHABLE |  |
| typeform | `GET /forms` | 403 | REACHABLE |  |
| vercel | `GET /v2/user` | 403 | REACHABLE |  |
| woocommerce | `GET /products` | - | SKIPPED | needs field store |

Probed 23 cards: 17 REACHABLE, 1 WARN, 0 FAIL, 5 SKIPPED.
