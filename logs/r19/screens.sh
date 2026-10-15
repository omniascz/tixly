#!/usr/bin/env bash
# Kolo 19 — čerstvé r19demo, server (aktuální build .next, simulátor Sentry běží) a 28 screenshotů (spec kola 15).
#   screens.sh <adresář pod logs/r19> <štítek>
T=/c/Users/omnia/Documents/tixly; R=$T/logs/r19; D=$1; L=$2
bash $R/reset_demo.sh > $R/${L}_reset.txt 2>&1 || { echo "reset selhal"; exit 1; }
for k in $(docker exec fix-redis redis-cli --scan --pattern 'rl:*'); do docker exec fix-redis redis-cli DEL "$k" >/dev/null; done
rm -rf $R/$D; mkdir -p $R/$D
node $T/e2e/load/r14-fake-sentry.mjs 3995 $R/${L}_screens_envelopes.jsonl > $R/${L}_screens_sim.txt 2>&1 & SIMP=$!
bash $R/serve_r19.sh > $R/${L}_screens_server.txt 2>&1 & SV=$!
for _ in $(seq 1 120); do curl -s -o /dev/null http://localhost:3200/api/health && break; sleep 1; done
cd $T/e2e && BASE_URL=http://localhost:3200 SHOTS=$R/$D AUDIT_OWNER_URL=postgresql://neondb_owner:fixowner@localhost:55632/r19demo \
  npx playwright test tests/golden-path-r15-screens.spec.ts --project=golden-path --workers=1 --reporter=list > $R/${L}_screens.txt 2>&1
echo "$L screens exit $?; PNG: $(ls $R/$D/*.png 2>/dev/null | wc -l)"
sed 's/\x1b\[[0-9;]*[A-Za-z]//g' $R/${L}_screens.txt | grep -E "passed|failed" | tail -3
kill $SV $SIMP 2>/dev/null; bash $R/stop_mine.sh
