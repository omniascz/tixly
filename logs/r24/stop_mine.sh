#!/usr/bin/env bash
# Kolo 24 (kopie K23) — viz stop_mine.ps1 (jen procesy této session: next start :3200, simulátor Sentry :3995, simulátor GoPay)
powershell -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w /c/Users/omnia/Documents/tixly/logs/r24/stop_mine.ps1)"
