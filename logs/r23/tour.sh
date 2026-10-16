#!/usr/bin/env bash
# Kolo 23 — scénář turné (golden-path-r8-theatre-tour) nad čerstvou r23a: simulátor GoPay (:3998) + Sentry (:3995) + next start (:3200).
# Snímky spec ukládá do logs/r8/tour → zkopírují se do logs/r23/tour a logs/r8/tour se vrátí na stav z gitu.
T=/c/Users/omnia/Documents/tixly; R=$T/logs/r23
bash $R/build_db.sh r23a > $R/9_build_db_r23a_tour.txt 2>&1; tail -1 $R/9_build_db_r23a_tour.txt
for k in $(docker exec fix-redis redis-cli --scan --pattern 'rl:*'); do docker exec fix-redis redis-cli DEL "$k" >/dev/null; done
rm -f $R/9_tour_envelopes.jsonl $R/9_tour_envelopes.jsonl.raw.jsonl
cd $T/nextjs-boilerplate; node tests/helpers/fake-gopay.mjs >> $R/fake_gopay.txt 2>&1 & GP=$!; cd $T
node $T/e2e/load/r14-fake-sentry.mjs 3995 $R/9_tour_envelopes.jsonl > $R/9_tour_sim.txt 2>&1 & SIMP=$!
R21_DB=r23a R21_NET_LOG=$(cygpath -m $R/9_tour_net.log) bash $R/serve_r23.sh > $R/9_tour_server.txt 2>&1 & SV=$!
for _ in $(seq 1 120); do curl -s -o /dev/null http://localhost:3200/api/health && break; sleep 1; done
cd $T/e2e && BASE_URL=http://localhost:3200 AUDIT_OWNER_URL=postgresql://neondb_owner:fixowner@localhost:55632/r23a MAILPIT=http://localhost:58225 \
  npx playwright test tests/golden-path-r8-theatre-tour.spec.ts --project=golden-path --workers=1 --reporter=list > $R/9_tour.txt 2>&1
echo "tour exit $?"; sed 's/\x1b\[[0-9;]*[A-Za-z]//g' $R/9_tour.txt | grep -E "^\s+[0-9]+ (passed|failed|skipped|flaky)|✘" | head
kill $SV $SIMP $GP 2>/dev/null; bash $R/stop_mine.sh > /dev/null
mkdir -p $R/tour && cp $T/logs/r8/tour/* $R/tour/ && cd $T && git checkout -- logs/r8/tour && git status --short logs/r8
