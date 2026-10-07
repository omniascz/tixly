#!/usr/bin/env bash
# Kolo 15 lokální sada: server proti r15a (lokální fix-pg). Jen localhost.
cd /c/Users/omnia/Documents/tixly/nextjs-boilerplate
set -a; . ./fix.app.env; set +a
export DATABASE_URL=postgresql://tixly_app:fixapp@localhost:55632/r15a
export DATABASE_URL_DIRECT=$DATABASE_URL
export DATABASE_URL_SUPER=postgresql://neondb_owner:fixowner@localhost:55632/r15a
export DATABASE_URL_OPS=$DATABASE_URL_SUPER
export KV_URL=redis://localhost:56679 KV_REST_API_URL=http://localhost:9 ARES_BASE_URL=http://localhost:3997
if [ "$1" = build ]; then exec npx next build; fi
exec npx next start -p 3200
