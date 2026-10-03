# PROGRESS_R3 — kolo 3 oprav (větev `fix/round3-2026-10-03`)

Základ: `fix/round2-2026-10-01` @ `080b24a`. Worktree `../tixly-fix`. `tixly/` se nemění.
Při startu nové session: přečíst tento soubor a pokračovat prvním nehotovým krokem.

## Infrastruktura (z kola 2, běží)
- `fix-pg` :55632 (DB `e2e`, template `tixly_zero` = migrace od nuly), `fix-pgb` PgBouncer :56633, `fix-mail` :51225/:58225, `fix-redis` :56679
- fake-gopay `nextjs-boilerplate/tests/helpers/fake-gopay.mjs` :3998; app `sh audit/r2/app.sh build|start|stop` (:3200, tixly_app)
- auditní skripty: `sh audit/r2/run.sh <NN>` (výstup audit/logs/r2_e2e_NN.out) — kolo 3 kopíruje do logs/r3/

## Paměť (2026-10-03)
- Ukončeny osiřelé `next start` z auditu (porty 3100/3101, PID 19600/19076/36812/32268).
- ~33 python procesů jiného projektu (`czwin.py`, `refresh_*.py`, od 30. 9.) drží ~18 GB — nejsou Tixly, neukončeno; dotaz na uživatele.

## Stav kroků
| Krok | Stav | Commit |
|---|---|---|
| 0 závěrečné ověření kola 2 | čeká | |
| 1 kolize migrace 472 → 479 | čeká | |
| 2 R5, R6, mobile rate limit, guard trigger, X7 | čeká | |
| 3 54 eskalací | čeká | |
| 4 K4d, K3a, K5, K8a, V9b | čeká | |
| 5 reseller print, admin/import, X6 | čeká | |
| Závěr + FIX_REPORT_R3 | čeká | |
