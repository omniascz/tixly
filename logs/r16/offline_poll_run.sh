#!/usr/bin/env bash
# offline_poll_run.sh <serve skript> <label> — čerstvé r16demo, server + GoPay, celý spec offline skeneru s měřením v bodě 5
T=/c/Users/omnia/Documents/tixly; SV=$1; L=$2
bash $T/logs/r16/reset_demo.sh > $T/logs/r16/3_reset_$L.txt 2>&1 || exit 1
for k in $(docker exec fix-redis redis-cli --scan --pattern 'rl:login*'); do docker exec fix-redis redis-cli DEL "$k" >/dev/null; done
rm -f $T/logs/r16/fixture_$L.json
(cd $T/nextjs-boilerplate && node tests/helpers/fake-gopay.mjs >> $T/logs/r16/fake_gopay.txt 2>&1 &)
(bash $SV > $T/logs/r16/3_server_$L.txt 2>&1 &)
for i in $(seq 1 120); do curl -s -m 60 -o /dev/null http://localhost:3200/api/health && break; sleep 1; done
cd $T/e2e && BASE_URL=http://localhost:3200 AUDIT_OWNER_URL=postgresql://neondb_owner:fixowner@localhost:55632/r16demo R14_FIXTURE=$T/logs/r16/fixture_$L.json \
  npx playwright test tests/golden-path-r14-offline-scanner.spec.ts --project=golden-path --workers=1 > $T/logs/r16/3_offline_$L.txt 2>&1
echo "$L exit $?"; sed 's/\x1b\[[0-9;]*[A-Za-z]//g' $T/logs/r16/3_offline_$L.txt | grep -E "DIAG-POLL|passed|failed"
