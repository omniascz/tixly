#!/usr/bin/env bash
# Kolo 24 (kopie K23): build / server proti lokální fix-pg (DB ${R21_DB:-r24demo}) se Sentry DSN na simulátor (127.0.0.1:3995). Jen localhost.
#   serve_r24.sh [build]
# Pojistka net-guard.cjs (NODE_OPTIONS): *.sentry.io se zablokuje (DNS i connect), každé spojení mimo localhost do R21_NET_LOG.
cd /c/Users/omnia/Documents/tixly/nextjs-boilerplate
set -a; . ./fix.app.env; set +a
export DATABASE_URL=postgresql://tixly_app:fixapp@localhost:55632/${R21_DB:-r24demo}
export DATABASE_URL_DIRECT=$DATABASE_URL
export DATABASE_URL_SUPER=postgresql://neondb_owner:fixowner@localhost:55632/${R21_DB:-r24demo}
export DATABASE_URL_OPS=$DATABASE_URL_SUPER
export KV_URL=redis://localhost:56679 KV_REST_API_URL=http://localhost:9 ARES_BASE_URL=http://localhost:3997
export SENTRY_DSN=http://r24publickey@127.0.0.1:3995/1
export NEXT_PUBLIC_SENTRY_DSN=${R21_CLIENT_DSN:-$SENTRY_DSN}
# test tunelu jako v kole 19: klientské DSN ve tvaru SaaS (jen řetězec), tunel /api/monitoring přepsán na simulátor
[ -n "${R21_TUNNEL_DEST:-}" ] && export _SENTRY_TUNNEL_DESTINATION_OVERRIDE=$R21_TUNNEL_DEST
[ -n "${R21_RELEASE_SHA:-}" ] && export VERCEL_GIT_COMMIT_SHA=$R21_RELEASE_SHA
unset SENTRY_AUTH_TOKEN
# Kolo 24 (kopie K23): konfigurace P (výchozí) = bez ALLOW_MOCK_PAYMENTS (produkčně), D = R24_ALLOW_MOCK=1 → ALLOW_MOCK_PAYMENTS=1 (řízené demo)
if [ "${R24_ALLOW_MOCK:-}" = 1 ]; then export ALLOW_MOCK_PAYMENTS=1; else unset ALLOW_MOCK_PAYMENTS; fi
echo "[serve_r24] ALLOW_MOCK_PAYMENTS=${ALLOW_MOCK_PAYMENTS:-<nenastaveno>}"
export NODE_OPTIONS="${NODE_OPTIONS:-} --require $(cygpath -m /c/Users/omnia/Documents/tixly/logs/r24/net-guard.cjs)"
export R21_NET_LOG=${R21_NET_LOG:-$(cygpath -m /c/Users/omnia/Documents/tixly/logs/r24/net.log)}
if [ "$1" = build ]; then exec npx next build; fi
exec npx next start -p 3200
