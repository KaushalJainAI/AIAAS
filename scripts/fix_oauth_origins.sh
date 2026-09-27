#!/bin/bash
# Diagnose (and optionally fix) the OAuth redirect allowlist on the EC2 box.
#
#   scp -i ~/.ssh/aiaas-deploy/my-pem.pem scripts/fix_oauth_origins.sh ec2-user@<host>:/tmp/
#   ssh  -i ~/.ssh/aiaas-deploy/my-pem.pem ec2-user@<host> 'bash /tmp/fix_oauth_origins.sh'          # diagnose
#   ssh  -i ~/.ssh/aiaas-deploy/my-pem.pem ec2-user@<host> 'bash /tmp/fix_oauth_origins.sh --apply'  # fix
#
# Why this exists
# ---------------
# credentials/views.py builds ALLOWED_REDIRECT_ORIGINS from four hardcoded
# localhost entries PLUS settings.CORS_ALLOWED_ORIGINS, and
# mcp_integration/views.py imports that same list. So one env var gates the
# Google credential flow AND every remote MCP server's OAuth. The frontend
# sends `${window.location.origin}/oauth/callback`, which in production is
# https://aiaas.kaushaljain.com/oauth/callback -- absent from the list, that is
# a flat 400 "Redirect URI origin is not allowed" before any provider is
# contacted.
#
# CORS_ALLOW_ALL_ORIGINS="True" does NOT feed that list. It is a different
# django-cors-headers setting, which is exactly why this can look configured
# and still be broken.
#
# The check reads the *running container*, not the compose file, because .env
# is also loaded and compose `environment:` does not override a key it never
# declares -- so the file can be missing the var while the app has it.

set -euo pipefail

ORIGIN="https://aiaas.kaushaljain.com"
COMPOSE="/home/ec2-user/docker-compose.yml"
CONTAINER="aiaas-backend"
APPLY="${1:-}"

echo "=== 1. What the running backend actually has ==="
if ! sudo docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Container '$CONTAINER' is not running. Start the stack first."
  sudo docker ps --format '  {{.Names}}\t{{.Status}}'
  exit 1
fi

# Printed as a list so a trailing-slash or scheme mismatch is visible; an
# origin that looks right but carries a stray "/" fails the exact-match check.
CURRENT=$(sudo docker exec "$CONTAINER" python -c \
  "from credentials.views import ALLOWED_REDIRECT_ORIGINS as A; print(A)" 2>&1) || {
    echo "Could not read the allowlist from the container:"
    echo "$CURRENT"
    exit 1
  }
echo "ALLOWED_REDIRECT_ORIGINS = $CURRENT"

if echo "$CURRENT" | grep -q "'$ORIGIN'"; then
  echo
  echo "OK -- $ORIGIN is already allowed. OAuth init will not 400 on the origin check."
  echo "Nothing to change. (If OAuth still fails, the cause is downstream:"
  echo " the provider-side registered redirect URI, or credentials, not this.)"
  exit 0
fi

echo
echo "BROKEN -- $ORIGIN is NOT in the allowlist."
echo "Every OAuth init from the public site answers 400 on the origin check."

if [ "$APPLY" != "--apply" ]; then
  echo
  echo "Re-run with --apply to fix. That will:"
  echo "  1. back up $COMPOSE"
  echo "  2. add CORS_ALLOWED_ORIGINS + CSRF_TRUSTED_ORIGINS to the backend service"
  echo "  3. recreate the backend container"
  echo "  4. re-run this check"
  exit 2
fi

echo
echo "=== 2. Backing up compose ==="
STAMP=$(date +%s)
sudo cp "$COMPOSE" "$COMPOSE.bak.$STAMP"
echo "Backup: $COMPOSE.bak.$STAMP"

echo
echo "=== 3. Patching compose ==="
if sudo grep -q 'CORS_ALLOWED_ORIGINS' "$COMPOSE"; then
  # Present in the file yet absent from the running app: the value is wrong, or
  # it sits under a service that is not the backend. Do not guess -- a blind
  # rewrite here would clobber a deliberate value.
  echo "CORS_ALLOWED_ORIGINS already appears in $COMPOSE but did not reach the app:"
  sudo grep -n 'CORS_ALLOWED_ORIGINS' "$COMPOSE"
  echo "Fix that line by hand (check the value and which service it is under),"
  echo "then re-run this script without --apply to verify."
  exit 3
fi

# Insert after each `DEBUG: "False"` line, which marks where the backend's
# environment block starts.
sudo python3 - "$COMPOSE" "$ORIGIN" <<'PYEOF'
import re
import sys

path, origin = sys.argv[1], sys.argv[2]
with open(path) as fh:
    s = fh.read()

addition = (
    f'      CORS_ALLOWED_ORIGINS: "{origin}"\n'
    f'      CSRF_TRUSTED_ORIGINS: "{origin}"\n'
)
s, n = re.subn(r'(      DEBUG: "False"\n)', r'\1' + addition, s)
if not n:
    sys.exit('No `DEBUG: "False"` anchor found; compose layout differs. Aborting.')

with open(path, 'w') as fh:
    fh.write(s)
print(f"Inserted after {n} DEBUG line(s).")
PYEOF

echo
echo "=== 4. Verifying compose still parses ==="
sudo docker-compose -f "$COMPOSE" config >/dev/null && echo "compose config OK"

echo
echo "=== 5. Recreating backend ==="
cd /home/ec2-user
sudo docker-compose up -d --force-recreate backend 2>&1 | tail -8

echo
echo "=== 6. Waiting for health ==="
for i in $(seq 1 30); do
  if sudo docker exec "$CONTAINER" curl -sf http://localhost:8000/api/health/ >/dev/null 2>&1; then
    echo "healthy after ${i}s"
    break
  fi
  sleep 1
done

echo
echo "=== 7. Re-checking the allowlist ==="
AFTER=$(sudo docker exec "$CONTAINER" python -c \
  "from credentials.views import ALLOWED_REDIRECT_ORIGINS as A; print(A)" 2>&1)
echo "ALLOWED_REDIRECT_ORIGINS = $AFTER"

if echo "$AFTER" | grep -q "'$ORIGIN'"; then
  echo
  echo "FIXED -- $ORIGIN is now allowed."
  echo "Roll back with: sudo cp $COMPOSE.bak.$STAMP $COMPOSE && sudo docker-compose up -d --force-recreate backend"
else
  echo
  echo "STILL BROKEN. The compose edit did not reach the app."
  echo "Most likely .env sets CORS_ALLOWED_ORIGINS to something else and is"
  echo "winning, or the backend service block was not the one patched."
  echo "Roll back with: sudo cp $COMPOSE.bak.$STAMP $COMPOSE && sudo docker-compose up -d --force-recreate backend"
  exit 4
fi
