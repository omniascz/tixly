#!/usr/bin/env bash
# Kolo 21 — části g00, g01 live sady se simulátorem GoPay (:3998) po dobu běhu, čerstvá r21a.
T=/c/Users/omnia/Documents/tixly; R=$T/logs/r21
bash $R/build_db.sh r21a > $R/9_build_db_r21a_live_g.txt 2>&1; tail -1 $R/9_build_db_r21a_live_g.txt
for k in $(docker exec fix-redis redis-cli --scan --pattern 'rl:*'); do docker exec fix-redis redis-cli DEL "$k" >/dev/null; done
for c in g00 g01; do
  bash $R/with_gopay.sh bash $R/live_chunk.sh $R/live/$c.txt $(cat $R/live/chunk_$c); echo "$c exit $?"
done
echo LIVE_DONE
