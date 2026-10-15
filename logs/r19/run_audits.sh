#!/usr/bin/env bash
# Kolo 19 — audity 01–12 vč. 07b a 08 proti serveru r19a (:3200) se simulátorem GoPay (:3998), Sentry (:3995) a Mailpitem.
# Server i simulátory běží jen po dobu skriptu. Použití: run_audits.sh [od] [do] (čísla 01…12, 07b)
T=/c/Users/omnia/Documents/tixly; R=$T/logs/r19
cd $T/nextjs-boilerplate
node tests/helpers/fake-gopay.mjs >> $R/fake_gopay.txt 2>&1 & GP=$!
node $T/e2e/load/r14-fake-sentry.mjs 3995 $R/9_audit_envelopes.jsonl >> $R/9_audit_sim.txt 2>&1 & SIMP=$!
R19_DB=r19a R19_NET_LOG=$(cygpath -m $R/9_audit_net.log) bash $R/serve_r19.sh > $R/9_server_audit.txt 2>&1 & SV=$!
for _ in $(seq 1 120); do curl -s -o /dev/null http://localhost:3200/api/health && break; sleep 1; done
set -a; . ./fix.app.env; set +a
export AUDIT_BASE=http://localhost:3200 AUDIT_OWNER_URL=postgresql://neondb_owner:fixowner@localhost:55632/r19a
export AUDIT_APP_URL=postgresql://tixly_app:fixapp@localhost:55632/r19a FAKE_GOPAY=http://localhost:3998 MAILPIT=http://localhost:58225
export AUDIT_LOG_PREFIX=r19_ AUDIT_STATE=./state.r19.json
cd $T/audit/e2e
start=${1:-01}; end=${2:-12}; go=0
for f in 01-setup-roles 02-purchase 03-refund-scan 04-role-differential 05-concurrency 06-security 07-rls-direct 07b-rls-published-write 08-idor-sweep 09-seated 10-demo-paths 11-operations 12-cron-expire-probe; do
  [ "${f%%-*}" = "$start" ] && go=1; [ $go = 1 ] || continue
  node $f.mjs > $R/9_audit_$f.txt 2>&1; echo "$f exit $? $(grep '# SUMMARY' $R/9_audit_$f.txt)"
  [ "${f%%-*}" = "$end" ] && break
done
kill $SV $SIMP $GP 2>/dev/null; bash $R/stop_mine.sh > /dev/null
