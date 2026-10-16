#!/usr/bin/env bash
# Kolo 19: čisté demo prostředí agentury (lokální fix-pg, DB r19demo). Jen localhost.
set -euo pipefail
cd /c/Users/omnia/Documents/tixly
docker exec fix-pg psql -U neondb_owner -d postgres -q -c "DROP DATABASE IF EXISTS r19demo WITH (FORCE)"
STAGING_DB=r19demo STAGING_APP_DB_PASSWORD=fixapp STAGING_PROMOTER_PASSWORD='Demo2026!heslo' STAGING_ENV_FILE=logs/r19/staging.env \
  PSQL_DOCKER_ARGS="--network container:fix-pg" bash scripts/staging/create.sh --local postgresql://neondb_owner:fixowner@localhost:5432/postgres
