#!/usr/bin/env bash
# Kolo 16 / krok 2 — kontrola zátěže: nejvýš 6× po 10 min; skončí, jakmile je stroj volný. Log logs/r16/2_load_checks.txt
L=/c/Users/omnia/Documents/tixly/logs/r16/2_load_checks.txt
for k in 1 2 3 4 5 6; do
  out=$(powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\Users\omnia\Documents\tixly\logs\r16\load_check.ps1' 2>&1 | tr -d '\r')
  echo "kontrola $k: $out" >> $L
  echo "$out" | grep -q " VOLNY " && { echo "VYSLEDEK VOLNY po kontrole $k" >> $L; exit 0; }
  [ $k -lt 6 ] && sleep 600
done
echo "VYSLEDEK OBSAZENY po 6 kontrolach" >> $L
