#!/usr/bin/env bash
# Kolo 23: čisté demo prostředí (lokální fix-pg, DB ${R21_DB:-r23demo}, migrace od nuly + seed-demo). Jen localhost.
set -euo pipefail
cd /c/Users/omnia/Documents/tixly
D=${R21_DB:-r23demo}
docker exec fix-pg psql -U neondb_owner -d postgres -q -c "DROP DATABASE IF EXISTS $D WITH (FORCE)"
STAGING_DB=$D STAGING_APP_DB_PASSWORD=fixapp STAGING_PROMOTER_PASSWORD='Demo2026!heslo' STAGING_ENV_FILE=logs/r23/staging.env \
  PSQL_DOCKER_ARGS="--network container:fix-pg" bash scripts/staging/create.sh --local postgresql://neondb_owner:fixowner@localhost:5432/postgres
