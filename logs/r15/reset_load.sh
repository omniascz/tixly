#!/usr/bin/env bash
# Kolo 15 zátěž: čisté demo prostředí agentury (lokální fix-pg, DB r15load). Jen localhost.
set -euo pipefail
cd /c/Users/omnia/Documents/tixly
docker exec fix-pg psql -U neondb_owner -d postgres -q -c "DROP DATABASE IF EXISTS r15load WITH (FORCE)"
STAGING_DB=r15load STAGING_APP_DB_PASSWORD=fixapp STAGING_PROMOTER_PASSWORD='Demo2026!heslo' STAGING_ENV_FILE=logs/r15/staging.env \
  PSQL_DOCKER_ARGS="--network container:fix-pg" bash scripts/staging/create.sh --local postgresql://neondb_owner:fixowner@localhost:5432/postgres
