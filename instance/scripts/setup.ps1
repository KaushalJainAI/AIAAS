# instance/scripts/setup.ps1 — bootstrap instance world on Windows (PowerShell)
# Run from repo root:  powershell -ExecutionPolicy Bypass -File instance/scripts/setup.ps1
# Idempotent — safe to re-run.

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path "$PSScriptRoot/../..").Path
$BackendRoot = Join-Path $RepoRoot "Backend"

Write-Host "== AIAAS instance setup ==" -ForegroundColor Cyan
Write-Host "Repo: $RepoRoot"

# 1. Check env
if (-not (Test-Path "$BackendRoot/.env")) {
    Write-Host "Backend/.env missing — copy Backend/.env.local → Backend/.env and set SECRET_KEY + CREDENTIAL_ENCRYPTION_KEY" -ForegroundColor Yellow
    if (Test-Path "$BackendRoot/.env.local") {
        Copy-Item "$BackendRoot/.env.local" "$BackendRoot/.env"
        Write-Host "  copied .env.local → .env (edit it now)" -ForegroundColor Yellow
    }
}

# 2. Migrate + seed credential types / models
Push-Location $BackendRoot
try {
    Write-Host "`n-- migrate --" -ForegroundColor Cyan
    python manage.py migrate

    Write-Host "`n-- populate credential types --" -ForegroundColor Cyan
    if (Test-Path "populate_credentials.py") { python manage.py shell < populate_credentials.py }

    Write-Host "`n-- populate models --" -ForegroundColor Cyan
    if (Test-Path "populate_models.py") { python manage.py shell < populate_models.py }

    Write-Host "`n-- seed instance world --" -ForegroundColor Cyan
    python "$RepoRoot/instance/scripts/seed_instance.py"

    Write-Host "`n-- simulate user journey (no LLM run) --" -ForegroundColor Cyan
    # only requires backend running; if not running, this will warn and continue
    try { python "$RepoRoot/instance/scripts/simulate_user_journey.py" --no-run } catch { Write-Host "  (backend not running — skipping API smoke, start it with: python manage.py runserver 0.0.0.0:8000)" -ForegroundColor Yellow }
} finally {
    Pop-Location
}

Write-Host "`nDone. Login as regular_user@example.com / Regular123!  (see instance/README.md)" -ForegroundColor Green
Write-Host "  API smoke:   python instance/scripts/simulate_user_journey.py --verbose"
Write-Host "  Browser:     cd instance/interactive-tests; npm install; npx playwright test --headed"
