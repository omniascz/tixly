#!/usr/bin/env bash
# Kolo 13: původní kód (d0bbcb00) z čistého klonu — screenshoty „před". Jen localhost.
cd "C:/Users/omnia/AppData/Local/Temp/claude/C--Users-omnia-Documents-tixly/136194da-2835-42de-9495-b696e7896135/scratchpad/tixly-clean/nextjs-boilerplate" || exit 1
set -a; . /c/Users/omnia/Documents/tixly/nextjs-boilerplate/fix.app.env; set +a
export DATABASE_URL=postgresql://tixly_app:fixapp@localhost:55632/r13demo DATABASE_URL_DIRECT=postgresql://tixly_app:fixapp@localhost:55632/r13demo
export DATABASE_URL_SUPER=postgresql://neondb_owner:fixowner@localhost:55632/r13demo DATABASE_URL_OPS=postgresql://neondb_owner:fixowner@localhost:55632/r13demo
export KV_URL=redis://localhost:56679 KV_REST_API_URL=http://localhost:9 ARES_BASE_URL=http://localhost:3997
if [ "${1:-}" = build ]; then rm -rf .next; exec node node_modules/next/dist/bin/next build; fi
exec node node_modules/next/dist/bin/next start -p 3200
