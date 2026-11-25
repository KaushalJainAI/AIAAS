# `datasources/`: your own databases and APIs as tools

The user sees this as "Custom tools" on the Connections page. It lets the AI
query **your** database or call **your** API through one generic tool each,
instead of one connector per system:

- `query_sql` (`chat/tools/data.py`) for a database
- `call_api` (`chat/tools/apicaller.py`) for an HTTP API

Nothing is off until you add a connection.

## Data (`models.py`)

| Model | What it is |
|---|---|
| `DataConnection` | A database: SQLite file or PostgreSQL. The password is a secret reference, never stored here |
| `ApiConnection` | An HTTP API: base URL, auth, operations |
| `SharedTool` | A published copy others can install, without credentials |

## Files

| File | What it does |
|---|---|
| `sqlcheck.py` | Decides which SQL is allowed by **parsing** it, not by pattern matching. Raises `SqlRefused` |
| `drivers.py` | Runs a checked statement against each database kind. Checks the host against the scope, and caps rows (`ROW_CAP`) |
| `sharing.py` | Publishes a connection as a `SharedTool` (credentials stripped) and installs copies |
| `auth_template.py` | Template auth: the `parts` (header, query or Basic) a credential fills, with `{field}` placeholders. Validates parts, and builds headers and params from resolved values. Used by the serializer, by `call_api` and by API cards (`mcp_integration/card_template.py`) |
| `catalogue/` | OpenAPI 3 spec files that API cards (`kind='api'`) point at. Only GET/HEAD operations, one marked `x-aiaas-check` |
| `models.py`, `serializers.py` | The three models and their API shape. `ApiConnection.card_slug` records which API card built a connection |
| `views.py`, `urls.py` | Private CRUD for your tools, sharing, and the shared-tool install routes. Under `/api/datasources/` |
| `apps.py` | App config |

## Rules

- Statements are read-only unless the call says `write`. SQLite files are opened read-only for reads.
- Inline results stop at the row cap (`query_sql.maxRows`) and say `more`. A full export refuses past `MAX_SPILL_ROWS`.
- A shared tool carries no secret. The installer must link their own credential (`sharing._needs`).

## Tests

`datasources/tests/`: `test_api.py`, `test_data.py`, `test_sharing.py`,
`test_api_auth_template.py`.
