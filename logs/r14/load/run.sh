#!/usr/bin/env bash
# Kolo 14 / krok 2: jeden zátěžový běh = nový termín 500 míst (setup) → k6 (300 kupců / 60 s) → konzistence.
# Použití: bash logs/r14/load/run.sh <štítek> [další -e pro k6, např. -e PAYFLOW=0]
# Předpoklad: běží server logs/r14/serve_load.sh (:3200), simulátor GoPay (:3998), PgBouncer fix-pgb.
set -u
L="$1"; shift
cd /c/Users/omnia/Documents/tixly/e2e
O=../logs/r14/load
BASE_URL=http://localhost:3200 OWNER_URL=postgresql://neondb_owner:fixowner@localhost:55632/r14load node load/r14-setup.mjs > $O/setup.json || { echo setup-fail; exit 1; }
cp $O/setup.json $O/setup_$L.json
K6=${K6:-/c/Users/omnia/AppData/Local/Temp/claude/C--Users-omnia-Documents-tixly/136194da-2835-42de-9495-b696e7896135/scratchpad/k6/k6-v2.3.0-windows-amd64/k6.exe}
# nativní k6 na hostiteli (Docker → hostitel měl občas „dial: i/o timeout" — síť testu, ne aplikace)
"$K6" run --quiet -e BASE=http://localhost:3200 -e GW=http://localhost:3998 -e SETUP="C:/Users/omnia/Documents/tixly/logs/r14/load/setup.json" "$@"   --summary-export "C:/Users/omnia/Documents/tixly/logs/r14/load/summary_$L.json" load/r14-sale.k6.js > $O/k6_$L.txt 2>&1
echo "k6 exit $?"
grep -E "t_|err_|s503|hold_conflict|sold_out|bought|harness" $O/k6_$L.txt
CRON=$(grep -E "^CRON_SECRET=" ../nextjs-boilerplate/fix.app.env | cut -d= -f2-)
EV=$(node -e "console.log(require('../logs/r14/load/setup.json').eventId)")
BASE_URL=http://localhost:3200 OWNER_URL=postgresql://neondb_owner:fixowner@localhost:55632/r14load CRON_SECRET="$CRON" node load/r14-consistency.mjs $EV > $O/consistency_$L.json
echo "consistency exit $?"
node -e "const d=require('../logs/r14/load/consistency_$L.json'); console.log(JSON.stringify(d.after)); console.log(JSON.stringify(d.checks))"
