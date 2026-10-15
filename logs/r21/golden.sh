#!/usr/bin/env bash
# Kolo 21 — jeden blok: čerstvé r21demo, simulátor GoPay (:3998) + Sentry (:3995) + next start (:3200), pak spec(y) golden-path.
#   golden.sh <štítek> <spec…>    výstupy logs/r21/<štítek>.txt, <štítek>_server.txt (log serveru), <štítek>_envelopes.jsonl
# Kolo 21: + R21_SIM_OUT / R19_SIM_OUT (výstup simulátoru Sentry) a proměnné z fix.app.env (CRON_SECRET).
# Spec dostane R20_SERVER_LOG (cesta k logu serveru) a AUDIT_OWNER_URL (čtení z DB pro porovnání).
T=/c/Users/omnia/Documents/tixly; R=$T/logs/r21; L=$1; shift
[ -n "$R21_NO_RESET" ] || bash $R/reset_demo.sh > $R/${L}_reset.txt 2>&1 || { echo "reset selhal"; exit 1; }
for k in $(docker exec fix-redis redis-cli --scan --pattern 'rl:*'); do docker exec fix-redis redis-cli DEL "$k" >/dev/null; done
rm -f $R/${L}_envelopes.jsonl $R/${L}_envelopes.jsonl.raw.jsonl
cd $T/nextjs-boilerplate; node tests/helpers/fake-gopay.mjs >> $R/fake_gopay.txt 2>&1 & GP=$!; cd $T
node $T/e2e/load/r14-fake-sentry.mjs 3995 $R/${L}_envelopes.jsonl > $R/${L}_sim.txt 2>&1 & SIMP=$!
bash $R/serve_r21.sh > $R/${L}_server.txt 2>&1 & SV=$!
for _ in $(seq 1 120); do curl -s -o /dev/null http://localhost:3200/api/health && break; sleep 1; done
cd $T/nextjs-boilerplate; set -a; . ./fix.app.env; set +a  # Kolo 21: CRON_SECRET pro (c)
cd $T/e2e && R21_SIM_OUT=$(cygpath -m $R/${L}_envelopes.jsonl) R19_SIM_OUT=$(cygpath -m $R/${L}_envelopes.jsonl) BASE_URL=http://localhost:3200 AUDIT_OWNER_URL=postgresql://neondb_owner:fixowner@localhost:55632/${R21_DB:-r21demo} MAILPIT=http://localhost:58225 \
  R20_SERVER_LOG=$(cygpath -m $R/${L}_server.txt) \
  npx playwright test "$@" --project=golden-path --workers=1 --reporter=list > $R/${L}.txt 2>&1
echo "$L exit $?"; sed 's/\x1b\[[0-9;]*[A-Za-z]//g' $R/${L}.txt | grep -E "^\s+[0-9]+ (passed|failed|skipped|flaky)|✘" | head
kill $SV $SIMP $GP 2>/dev/null; bash $R/stop_mine.sh > /dev/null
