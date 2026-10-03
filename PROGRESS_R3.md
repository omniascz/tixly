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
| 0 závěrečné ověření kola 2 | HOTOVO — regrese (deadlock poolu) opravena 91a1316, skripty 2d80acc | 91a1316, 2d80acc |
| 1 kolize migrace 472 → 479 | HOTOVO | e78c5cc |
| 2 R5, R6, mobile rate limit, guard trigger, X7 | HOTOVO | f800b76 d58c3ef 799bfa0 b275ecf b110d66 b1c9b72 055b631 |
| 3 54 eskalací | HOTOVO (ESKALACE_R3.md; test 17/17; unit 513/0; live 151/0) | db3bffe |
| 4 K4d, K3a, K5, K8a, V9b | rozpracováno | |
| 5 reseller print, admin/import, X6 | čeká | |
| Závěr + FIX_REPORT_R3 | čeká | |

## Krok 0 — výsledek (logs/r3/0_*)
Před opravou: 05 C1a/C1b/C2a/C2c FAIL = REGRESE kola 2 (sloučení poolů v R-56 → deadlock vnořených výpůjček, 98/100 500).
Po opravě + 2 opravách skriptů (V12 sloupec, C2c prefix): 01 26/0, 02 36/0, 03 21/3 (R5,R6,V9b), 04 13/1 (X6),
05 8/0, 06 17/4 (K3a,K4d,K5,K8a), 09 12/0, 10 7/0, 11 8/0, 12 5/0. Live 94/0 (+87 skip Neon).
P1, P5d, C2b, P13, V12, D3a PASS; C1a, C2a PASS.

## Krok 2 — průběh
- R5 HOTOVO f800b76 (webhook REFUNDED → executeOrderRefund bez brány; test 3/3; regrese 37/37)
- R6 HOTOVO d58c3ef (reacquire-capacity / auto-refund + e-mail; test 3/3; regrese 52/52)
- mobile auth HOTOVO 799bfa0 (nový nález: /api/mobile/* bez identity → vždy 401; +25 dalších rout se stejnou vadou → report, neopraveno)
- mobile rate limit HOTOVO (viz git log fix(R3-mobile-rl))
- my auth HOTOVO b110d66 (/api/my/* bez identity; upgrade-options padá na catalog.seat_maps → report)
- guard trigger HOTOVO b1c9b72 (migrace 486; test 23/23; RED bez triggeru 12, bez rout 6; live 132/0)
- X7 HOTOVO (migrace 487; test 2/2) — KROK 2 HOTOVÝ

## Krok 3 — poznámky pro report
- claim skupinové pozvánky: guard 486 blokoval zápis gopay_payment_id pod kupcem (regrese b1c9b72, live sada ji nezachytila) → opraveno v db3bffe.
- K4d: platform-auth verifyAdminToken taky musí kontrolovat typ tokenu.
- Nálezy mimo zadání: seat-upgrade-notify cron používá neexistující sloupce (seat_upgrades.order_id/notified_at, seats.row_label);
  seat_upgrades UPDATE/INSERT politika `true`, postal_deliveries/travel_bookings INSERT `true`; group-invitations/[token] veřejně vrací e-mail organizátora;
  subscriptions.holders restwert_credit_halire měnitelné kupcem pod RLS (vlastní řádek); exchange mění event_id celé objednávky, ne lístku;
  free upgrade nemění kapacitu typů; my/orders upgrade-options → catalog.seat_maps neexistuje; 25 rout bez identity (logs/r3/2_unlisted_auth_routes.txt).
