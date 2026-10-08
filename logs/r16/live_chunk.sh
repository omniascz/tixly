#!/usr/bin/env bash
# Kolo 16 — část live sady proti r16a (tixly_app, RLS), 1 worker. Použití: live_chunk.sh <log> <soubory…>
cd /c/Users/omnia/Documents/tixly/nextjs-boilerplate
log=$1; shift
FIX_E2E=1 FIX_DB_OWNER_URL=postgresql://neondb_owner:fixowner@localhost:55632/r16a \
FIX_DB_APP_URL=postgresql://tixly_app:fixapp@localhost:55632/r16a \
FIX_PGBOUNCER_URL=postgresql://tixly_app:fixapp@localhost:56633/r16a \
npx vitest run -c vitest.live.config.ts --maxWorkers=1 --minWorkers=1 "$@" > "$log" 2>&1
