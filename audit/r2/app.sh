#!/bin/sh
# Kolo 2: start/stop aplikace pod tixly_app (:3200). Pouziti: sh audit/r2/app.sh start|stop|build
cd "$(dirname "$0")/../../nextjs-boilerplate" || exit 1
case "$1" in
  stop)  for p in $(netstat -ano | grep -E 'LISTENING' | grep -E '[:.]3200 ' | awk '{print $NF}' | sort -u); do taskkill //PID $p //F //T >/dev/null 2>&1; done ;;
  build) set -a; . ./fix.app.env; set +a; npx next build > ../logs/r2/build_last.txt 2>&1; echo "build exit=$?" ;;
  start) set -a; . ./fix.app.env; set +a; nohup npx next start -p 3200 > ../logs/r2/app_server.txt 2>&1 &
         for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3200/api/health && { echo "app up"; exit 0; }; sleep 1; done; echo "app NOT up"; exit 1 ;;
esac
