#!/usr/bin/env bash
# Kolo 20 — viz stop_mine.ps1 (jen procesy této session: next start :3200, simulátor Sentry :3995, simulátor GoPay)
powershell -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w /c/Users/omnia/Documents/tixly/logs/r20/stop_mine.ps1)"
