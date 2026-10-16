#!/usr/bin/env bash
# Kolo 19 — jeden blok: simulátor Sentry (:3995) + next start (:3200, r19demo) + spec golden-path-r19-sentry11.
#   run_sentry.sh <štítek>     výstupy logs/r19/<štítek>_envelopes.jsonl(.raw.jsonl), <štítek>_sentry.txt, <štítek>_server.txt
# Proměnné pro server (R19_CLIENT_DSN, R19_TUNNEL_DEST, R19_APP_VERSION) viz serve_r19.sh; server i simulátor běží jen
# po dobu skriptu.
T=/c/Users/omnia/Documents/tixly; R=$T/logs/r19; L=$1
rm -f $R/${L}_envelopes.jsonl $R/${L}_envelopes.jsonl.raw.jsonl
for k in $(docker exec fix-redis redis-cli --scan --pattern 'rl:*'); do docker exec fix-redis redis-cli DEL "$k" >/dev/null; done
node $T/e2e/load/r14-fake-sentry.mjs 3995 $R/${L}_envelopes.jsonl > $R/${L}_sim.txt 2>&1 & SIMP=$!
bash $R/serve_r19.sh > $R/${L}_server.txt 2>&1 & SV=$!
for _ in $(seq 1 120); do curl -s -o /dev/null http://localhost:3200/api/health && break; sleep 1; done
cd $T/nextjs-boilerplate; set -a; . ./fix.app.env; set +a
cd $T/e2e && BASE_URL=http://localhost:3200 R19_SIM_OUT=$R/${L}_envelopes.jsonl \
  npx playwright test tests/golden-path-r19-sentry11.spec.ts --project=golden-path --workers=1 --reporter=list > $R/${L}_sentry.txt 2>&1
echo "$L playwright exit $?"
sed 's/\x1b\[[0-9;]*[A-Za-z]//g' $R/${L}_sentry.txt | grep -E "^\[r19\]|passed|failed|✘|✓" | head -40
# ukončit server (next start běží jako potomek) a simulátor
pkill -P $SV 2>/dev/null; kill $SV $SIMP 2>/dev/null
bash $R/stop_mine.sh
