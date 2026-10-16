# PROGRESS_R4 — kolo 4 oprav (větev `fix/round4-2026-10-03`)

Základ: `fix/round3-2026-10-03` @ `e5789d7`. Worktree `../tixly-fix`. `tixly/` se nemění (ani přejmenování).
Kolize migrace 479 se neřeší (sloučení). Migrace od 489 (488 rezervováno).
Při startu nové session: přečíst tento soubor a pokračovat prvním nehotovým krokem.
Infrastruktura jako v kole 3 (viz PROGRESS_R3.md). Výstupy: logs/r4/.

## Stav kroků
| Krok | Stav | Commit |
|---|---|---|
| 1a S2 upgrade únik | HOTOVO | 7b481c1 |
| 1b 5xx calendar.ics, kiosk | HOTOVO | 03f6c93 |
| 1c audit 08 bez FAIL | HOTOVO — 2/0, 154 rout, 0 úniků, 0×5xx (logs/r4/1c_*) | |
| 2 routy bez identity + tabulka všech rout + generovaný test | HOTOVO — 2a–2g + tabulka/test bea7c5d; oauth/authorize ověřit HTTP v závěru | bea7c5d |
| 3a seat-upgrade-notify | HOTOVO 9524f6e | |
| 3b RLS politiky true | HOTOVO (+ převod vstupenky 4fea477) | |
| 3c veřejný e-mail organizátora | HOTOVO 133dfc2 | |
| 3d restwert | HOTOVO d235d8d | |
| 3e exchange | HOTOVO caad0e0 | |
| 3f upgrade-options 500 | HOTOVO (+ kapacita 34e7711) | |
| 3g mobil /api/v1/buyer/orders | HOTOVO 092c6469 | |
| 3h QR tištěné vstupenky | HOTOVO 6a7bdf7d (vizuální kontrola v závěru) | |
| 3i mobile-promoter typecheck | HOTOVO db6e8542 — tsc 0; předexistující: package-lock nesynchronizovaný (npm ci EUSAGE) | |
| 4 CI a provoz | HOTOVO — ci 4fb049ed, lint 525998ac, drift eecb95e3, rls fe4e3d7b, backup 6cdce801, README 67f126df | |
| Závěr | HOTOVO — typecheck/unit/live/build zelené, audity 01–12 vč. 07b/08 0 FAIL, vizuál QR+skener OK | f945e9bb |

## Poznámky
- Krok 2 rozpracováno: klasifikátor audit/r4/classify-routes.mjs (984 routa+metoda); nález scanner/school-group bez ověření obsluhy.
- POZOR: jednou selhal fix-k3-capacity v souběžné dávce (chk_catalog_ticket_types_remaining v cronu expirace); 4× nereprodukováno, příčina neznámá — sledovat v závěrečné live sadě.
- 3i: předexistující nález — mobile-promoter/package-lock.json nesynchronizovaný s package.json (npm ci EUSAGE); lockfile neměněn.
- KROK 3 HOTOVÝ.
- KROK 4 HOTOVÝ (act není → actionlint+shellcheck, kroky lokálně). Lokální scratch DB ci_check smazat v závěru. Další: Závěr (typecheck, unit, live, build, audity 01–12 vč. 07b/08 po jednom; oauth/authorize HTTP; vizuál QR tisku + skeneru).
