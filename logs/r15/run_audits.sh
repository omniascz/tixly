#!/usr/bin/env bash
# Kolo 15 — audity 01–12 vč. 07b a 08 proti serveru r15a (:3200) se simulátorem GoPay (:3998) a Mailpitem.
# Server i simulátor běží jen po dobu skriptu. Použití: run_audits.sh [od] [do] (čísla 01…12, 07b)
T=/c/Users/omnia/Documents/tixly; R=$T/logs/r15
cd $T/nextjs-boilerplate
node tests/helpers/fake-gopay.mjs >> $R/fake_gopay.txt 2>&1 & GP=$!
bash $R/serve_r15a.sh > $R/9_server_audit.txt 2>&1 & SV=$!
for _ in $(seq 1 120); do curl -s -o /dev/null http://localhost:3200/api/health && break; sleep 1; done
set -a; . ./fix.app.env; set +a
export AUDIT_BASE=http://localhost:3200 AUDIT_OWNER_URL=postgresql://neondb_owner:fixowner@localhost:55632/r15a
export AUDIT_APP_URL=postgresql://tixly_app:fixapp@localhost:55632/r15a FAKE_GOPAY=http://localhost:3998 MAILPIT=http://localhost:58225
export AUDIT_LOG_PREFIX=r15_ AUDIT_STATE=./state.r15.json
cd $T/audit/e2e
start=${1:-01}; end=${2:-12}; go=0
for f in 01-setup-roles 02-purchase 03-refund-scan 04-role-differential 05-concurrency 06-security 07-rls-direct 07b-rls-published-write 08-idor-sweep 09-seated 10-demo-paths 11-operations 12-cron-expire-probe; do
  [ "${f%%-*}" = "$start" ] && go=1; [ $go = 1 ] || continue
  node $f.mjs > $R/9_audit_$f.txt 2>&1; echo "$f exit $? $(grep '# SUMMARY' $R/9_audit_$f.txt)"
  [ "${f%%-*}" = "$end" ] && break
done
# ukončit server (next start běží jako potomek) a simulátor
pkill -P $SV 2>/dev/null; kill $SV $GP 2>/dev/null; wait 2>/dev/null
