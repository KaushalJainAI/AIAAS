# dummy-data

Declarative fixtures loaded by `instance/scripts/seed_instance.py` (ORM) and `instance/scripts/simulate_user_journey.py` (API).

- `users/*.json` — personas (`@example.com`, `dummy-*` passwords). `regular_user` is primary.
- `agents/*.json` — `AgentSerializer` shapes (flat camelCase). Provider `nvidia` uses platform fallback so no credential needed.
- `knowledge-bases/*.json` — KB defs; documents are in `documents/*.md` and linked by name.
- `documents/*.md` — synthetic KB content (indexed via HNSW if available, else `stored`).
- `folders/tree.json` — folder tree (IDs are materialized on create).

Adding a fixture: add JSON here → add it to `instance/scripts/utils/fixtures.py` if it should be auto-seeded, or seed manually via `utils/api_client.py`.
