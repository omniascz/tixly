#!/usr/bin/env bash
# Kolo 19: build / server proti r19demo (lokální fix-pg) se Sentry DSN na simulátor (127.0.0.1:3995). Jen localhost.
#   serve_r19.sh [build]
# R19_CLIENT_DSN: DSN prohlížeče (výchozí = simulátor přímo). Pro test tunelu (krok 2) DSN ve tvaru Sentry SaaS
# (jen řetězec — prohlížeč posílá na tunel /api/monitoring, server přepíše na simulátor přes
# _SENTRY_TUNNEL_DESTINATION_OVERRIDE; nikdo se na sentry.io nepřipojuje).
cd /c/Users/omnia/Documents/tixly/nextjs-boilerplate
set -a; . ./fix.app.env; set +a
export DATABASE_URL=postgresql://tixly_app:fixapp@localhost:55632/${R19_DB:-r19demo}
export DATABASE_URL_DIRECT=$DATABASE_URL
export DATABASE_URL_SUPER=postgresql://neondb_owner:fixowner@localhost:55632/${R19_DB:-r19demo}
export DATABASE_URL_OPS=$DATABASE_URL_SUPER
export KV_URL=redis://localhost:56679 KV_REST_API_URL=http://localhost:9 ARES_BASE_URL=http://localhost:3997
export SENTRY_DSN=http://r19publickey@127.0.0.1:3995/1
export NEXT_PUBLIC_SENTRY_DSN=${R19_CLIENT_DSN:-$SENTRY_DSN}
[ -n "$R19_TUNNEL_DEST" ] && export _SENTRY_TUNNEL_DESTINATION_OVERRIDE=$R19_TUNNEL_DEST
[ -n "$R19_RELEASE_SHA" ] && export VERCEL_GIT_COMMIT_SHA=$R19_RELEASE_SHA
[ -n "$R19_APP_VERSION" ] && export APP_VERSION=$R19_APP_VERSION NEXT_PUBLIC_APP_VERSION=$R19_APP_VERSION
unset SENTRY_AUTH_TOKEN
# pojistka: žádné spojení na *.sentry.io (telemetrie webpack pluginu Sentry), log nelokálních spojení
export NODE_OPTIONS="${NODE_OPTIONS:-} --require $(cygpath -m /c/Users/omnia/Documents/tixly/logs/r19/net-guard.cjs)"
export R19_NET_LOG=${R19_NET_LOG:-$(cygpath -m /c/Users/omnia/Documents/tixly/logs/r19/net.log)}
if [ "$1" = build ]; then exec npx next build; fi
exec npx next start -p 3200
