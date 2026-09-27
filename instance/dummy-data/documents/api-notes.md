# API notes

## Auth
- `POST /api/auth/register/` `{username=email, email, password, password2, first_name, last_name}` → `{access, refresh}`
- `POST /api/auth/login/` `{email, password}` → `{access, refresh}`
- Header: `Authorization: Bearer <access>` or `X-API-Key` or `?token=` for SSE/WS

## Execute
- `POST /api/orchestrator/agents/{id}/execute/` `{goal}` → `202 {execution_id}`
- Stream: `GET /api/streaming/executions/{id}/stream/?token=<jwt>`
- Logs: `GET /api/logs/executions/{id}/` → `{revision, turns: [{reasoning, steps}]}`

## Documents & Folders
- `POST /api/inference/folders/` `{name, parent_id}`
- `POST /api/inference/documents/` multipart `file`
- `POST /api/inference/rag/search/` `{query, top_k}`

Dummy seed for `instance/` — re-seed via `python instance/scripts/seed_instance.py`.
