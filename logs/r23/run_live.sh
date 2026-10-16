#!/usr/bin/env bash
# Kolo 23 — live sada po částech (rozdělení kola 19, logs/r23/live/chunk_*) proti čerstvé r23a, tixly_app, 1 worker.
T=/c/Users/omnia/Documents/tixly; R=$T/logs/r23
bash $R/build_db.sh r23a > $R/9_build_db_r23a_live.txt 2>&1; tail -1 $R/9_build_db_r23a_live.txt
for k in $(docker exec fix-redis redis-cli --scan --pattern 'rl:*'); do docker exec fix-redis redis-cli DEL "$k" >/dev/null; done
# Kolo 23: části g00, g01 běží se simulátorem GoPay v run_live_g.sh
for c in n00 n01 n02 n03; do
  bash $R/live_chunk.sh $R/live/$c.txt $(cat $R/live/chunk_$c); echo "$c exit $?"
done
bash $R/with_gopay.sh bash $R/live_chunk.sh $R/live/webhook_pool.txt tests/fix-r3-webhook-pool.live.test.ts; echo "webhook_pool exit $?"
echo LIVE_DONE
