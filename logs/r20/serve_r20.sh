#!/usr/bin/env bash
# Kolo 20: build / server proti lokální fix-pg (DB ${R20_DB:-r20demo}) se Sentry DSN na simulátor (127.0.0.1:3995). Jen localhost.
#   serve_r20.sh [build]
# Pojistka net-guard.cjs (NODE_OPTIONS): *.sentry.io se zablokuje (DNS i connect), každé spojení mimo localhost do R20_NET_LOG.
cd /c/Users/omnia/Documents/tixly/nextjs-boilerplate
set -a; . ./fix.app.env; set +a
export DATABASE_URL=postgresql://tixly_app:fixapp@localhost:55632/${R20_DB:-r20demo}
export DATABASE_URL_DIRECT=$DATABASE_URL
export DATABASE_URL_SUPER=postgresql://neondb_owner:fixowner@localhost:55632/${R20_DB:-r20demo}
export DATABASE_URL_OPS=$DATABASE_URL_SUPER
export KV_URL=redis://localhost:56679 KV_REST_API_URL=http://localhost:9 ARES_BASE_URL=http://localhost:3997
export SENTRY_DSN=http://r20publickey@127.0.0.1:3995/1
export NEXT_PUBLIC_SENTRY_DSN=$SENTRY_DSN
unset SENTRY_AUTH_TOKEN
export NODE_OPTIONS="${NODE_OPTIONS:-} --require $(cygpath -m /c/Users/omnia/Documents/tixly/logs/r20/net-guard.cjs)"
export R20_NET_LOG=${R20_NET_LOG:-$(cygpath -m /c/Users/omnia/Documents/tixly/logs/r20/net.log)}
if [ "$1" = build ]; then exec npx next build; fi
exec npx next start -p 3200
