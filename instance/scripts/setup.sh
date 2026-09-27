#!/usr/bin/env bash
# instance/scripts/setup.sh — bootstrap instance world (bash / WSL / CI)
# Run from repo root:  bash instance/scripts/setup.sh
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BACKEND_ROOT="$REPO_ROOT/Backend"

echo "== AIAAS instance setup =="
echo "Repo: $REPO_ROOT"

if [[ ! -f "$BACKEND_ROOT/.env" ]]; then
  echo "Backend/.env missing — copying .env.local if present"
  [[ -f "$BACKEND_ROOT/.env.local" ]] && cp "$BACKEND_ROOT/.env.local" "$BACKEND_ROOT/.env" && echo "  copied .env.local → .env (edit SECRET_KEY + CREDENTIAL_ENCRYPTION_KEY)"
fi

pushd "$BACKEND_ROOT" >/dev/null
  echo "-- migrate --"
  python manage.py migrate

  echo "-- populate credential types --"
  [[ -f populate_credentials.py ]] && python manage.py shell < populate_credentials.py || true

  echo "-- populate models --"
  [[ -f populate_models.py ]] && python manage.py shell < populate_models.py || true

  echo "-- seed instance world --"
  python "$REPO_ROOT/instance/scripts/seed_instance.py"

  echo "-- simulate user journey (no LLM run) --"
  python "$REPO_ROOT/instance/scripts/simulate_user_journey.py" --no-run || echo "  (backend not running — start with: python manage.py runserver 0.0.0.0:8000)"
popd >/dev/null

echo ""
echo "Done. Login as regular_user@example.com / Regular123!  (see instance/README.md)"
echo "  API smoke:   python instance/scripts/simulate_user_journey.py --verbose"
echo "  Browser:     cd instance/interactive-tests; npm install; npx playwright test --headed"
