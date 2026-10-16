#!/usr/bin/env bash
# ab_run.sh <14|15> <štítek> — jeden zátěžový běh na zvolené verzi (server přes PgBouncer), server po běhu zůstane
T=/c/Users/omnia/Documents/tixly; SP=/c/Users/omnia/AppData/Local/Temp/claude/C--Users-omnia-Documents-tixly/136194da-2835-42de-9495-b696e7896135/scratchpad
SV=$T/logs/r15/serve_load.sh; [ "$1" = 14 ] && SV=$SP/serve_load14.sh
(bash $SV > $T/logs/r15/load/server_$2.txt 2>&1 &)
for i in $(seq 1 120); do curl -s -m 60 -o /dev/null http://localhost:3200/api/health && break; sleep 1; done
echo "$2: $(grep -m1 Next.js $T/logs/r15/load/server_$2.txt)"
bash $T/logs/r15/load/run.sh $2 2>&1 | grep -E "t_page|t_plan|t_hold|t_checkout|t_webhook|noOversell" | cut -c1-120
