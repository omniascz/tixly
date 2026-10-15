#!/usr/bin/env bash
# Kolo 22 — viz stop_mine.ps1 (jen procesy této session: next start :3200, simulátor Sentry :3995, simulátor GoPay)
powershell -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w /c/Users/omnia/Documents/tixly/logs/r22/stop_mine.ps1)"
