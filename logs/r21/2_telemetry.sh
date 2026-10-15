#!/usr/bin/env bash
# Kolo 21 / krok 2 — `npm run build` se SENTRY_DSN a NEXT_PUBLIC_SENTRY_DSN na simulátor (http://<klíč>@127.0.0.1:3995/1),
# bez SENTRY_AUTH_TOKEN, a záznam VŠECH pokusů o odchozí spojení mimo localhost.
# Mechanismus pojistky (jako scripts/ci/build-no-network.sh → no-network-preload.cjs, v podobě logs/r19/net-guard.cjs):
# NODE_OPTIONS=--require logs/r21/net-guard.cjs ve všech procesech node buildu. Překlad i connect na *.sentry.io se
# zablokuje dřív, než spojení odejde (ENOTFOUND) — jen se zapíše „BLOCKED"; ostatní spojení mimo localhost se zapíší.
#   2_telemetry.sh <štítek>     výstupy logs/r21/2_<štítek>_build.txt, 2_<štítek>_net.log, 2_<štítek>_net_summary.txt
set -u
T=/c/Users/omnia/Documents/tixly; R=$T/logs/r21; L=$1
NET=$R/2_${L}_net.log; rm -f "$NET"
cd $T/nextjs-boilerplate
set -a; . ./fix.app.env; set +a
export DATABASE_URL=postgresql://tixly_app:fixapp@localhost:55632/${R21_DB:-r21demo}
export DATABASE_URL_DIRECT=$DATABASE_URL DATABASE_URL_SUPER=postgresql://neondb_owner:fixowner@localhost:55632/${R21_DB:-r21demo}
export DATABASE_URL_OPS=$DATABASE_URL_SUPER
export KV_URL=redis://localhost:56679 KV_REST_API_URL=http://localhost:9 ARES_BASE_URL=http://localhost:3997
export SENTRY_DSN=http://r21publickey@127.0.0.1:3995/1
export NEXT_PUBLIC_SENTRY_DSN=${R21_CLIENT_DSN:-$SENTRY_DSN}
# test tunelu jako v kole 19: klientské DSN ve tvaru SaaS (jen řetězec), tunel /api/monitoring přepsán na simulátor
[ -n "${R21_TUNNEL_DEST:-}" ] && export _SENTRY_TUNNEL_DESTINATION_OVERRIDE=$R21_TUNNEL_DEST
[ -n "${R21_RELEASE_SHA:-}" ] && export VERCEL_GIT_COMMIT_SHA=$R21_RELEASE_SHA
unset SENTRY_AUTH_TOKEN SENTRY_ORG SENTRY_PROJECT
export NODE_OPTIONS="${NODE_OPTIONS:-} --require $(cygpath -m $R/net-guard.cjs)"
export R21_NET_LOG=$(cygpath -m "$NET")
echo "# 2_telemetry.sh $L — HEAD $(git rev-parse HEAD) — $(date -Iseconds)" > $R/2_${L}_build.txt
echo "# SENTRY_DSN=http://r21p…@127.0.0.1:3995/1 NEXT_PUBLIC_SENTRY_DSN=${R21_CLIENT_DSN:+klient ve tvaru SaaS (řetězec) + tunel na simulátor} SENTRY_AUTH_TOKEN=${SENTRY_AUTH_TOKEN:-<nenastaven>}" >> $R/2_${L}_build.txt
npm run build >> $R/2_${L}_build.txt 2>&1; rc=$?
touch "$NET"
{
  echo "# Kolo 21 — souhrn odchozích spojení buildu ($L), exit buildu $rc"
  echo "řádků v net logu: $(wc -l < "$NET")"
  echo "pokusů mimo localhost celkem (BLOCKED + connect): $(grep -cE 'BLOCKED|connect ' "$NET")"
  echo "z toho zablokovaných *.sentry.io: $(grep -c 'BLOCKED' "$NET")"
  echo "cílové hostitele:"; sed -E 's/.* (BLOCKED (dns|dns\.promises|connect) |connect )([^ :]+).*/  \3/' "$NET" | sort | uniq -c
} > $R/2_${L}_net_summary.txt
cat $R/2_${L}_net_summary.txt
exit $rc
