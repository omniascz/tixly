#!/bin/sh
# Kolo 2: spusti auditni E2E skript(y) proti fix infrastrukture. Pouziti: sh audit/r2/run.sh 01 02 ... (z korene worktree)
cd "$(dirname "$0")/.." || exit 1
. r2/env.sh
export CRON_SECRET=$(grep '^CRON_SECRET=' ../nextjs-boilerplate/fix.app.env | cut -d= -f2-)
for n in "$@"; do
  f=$(ls e2e/${n}-*.mjs | head -1); arg=""
  case "$n" in 04) arg=app;; esac
  echo "=== $f $arg"
  (cd e2e && node $(basename $f) $arg) > logs/${AUDIT_LOG_PREFIX}e2e_${n}${arg:+_$arg}.out 2>&1
  echo "exit=$?"; grep -E '^# SUMMARY|^  FAIL' logs/${AUDIT_LOG_PREFIX}e2e_${n}${arg:+_$arg}.out
done
