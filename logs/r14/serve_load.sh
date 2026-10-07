#!/usr/bin/env bash
# Kolo 14 / krok 2: server pro zátěžový test — DB r14load PŘES PgBouncer (fix-pgb :56633, pool_mode transaction,
# default_pool_size dle /etc/pgbouncer/pgbouncer.ini). Jen localhost.
cd /c/Users/omnia/Documents/tixly/nextjs-boilerplate
set -a; . ./fix.app.env; set +a
export DATABASE_URL=postgresql://tixly_app:fixapp@localhost:56633/r14load
export DATABASE_URL_DIRECT=$DATABASE_URL
export DATABASE_URL_SUPER=postgresql://neondb_owner:fixowner@localhost:55632/r14load
export DATABASE_URL_OPS=$DATABASE_URL_SUPER
export KV_URL=redis://localhost:56679 KV_REST_API_URL=http://localhost:9 ARES_BASE_URL=http://localhost:3997
exec npx next start -p 3200
