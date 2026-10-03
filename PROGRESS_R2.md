# PROGRESS_R2 — kolo 2 oprav (větev `fix/round2-2026-10-01`)

Základ: `fix/critical-2026-09-30` @ `1a6e96d`. Worktree `../tixly-fix`. `tixly/` se nemění.

## Infrastruktura (izolovaná, nikdy produkce)
- `fix-pg` postgis 17-3.5 → `localhost:55632`; DB `tixly_fix` (template, z migrací od nuly, 25/25 OK, `logs/r2/A_migrate_from_zero.log`), pracovní DB `e2e` (TEMPLATE tixly_fix). `tixly_app` NOBYPASSRLS heslo `fixapp`; `neondb_owner` heslo `fixowner`.
- `fix-redis` → `:56679`; `fix-mail` (Mailpit) SMTP `:51225`, UI/API `:58225`.
- fake-gopay `nextjs-boilerplate/tests/helpers/fake-gopay.mjs` → `:3998`.
- App: `next start -p 3200` s `nextjs-boilerplate/fix.app.env` (DATABASE_URL = tixly_app).
- Obnova: `docker start fix-pg fix-redis fix-mail` (nebo REPRO v audit/REPRO.md, `PGC=fix-pg sh audit/db/migrate-from-zero.sh tixly_fix`).

## Krok A — obnova stavu (2026-10-03)
- Worktree `../tixly-fix` existoval na `fix/critical-2026-09-30` @ `1a6e96d`, čistý (bez necommitnutých změn).
- Větev `fix/round2-2026-10-01` NEEXISTOVALA, PROGRESS_R2.md ani FIX_REPORT_R2.md neexistovaly → **z kola 2 nebylo hotové nic**. Větev založena z `1a6e96d`.
- Kontejnery kola 1 (DB :55632, mailpit, redis) neexistovaly; běžely jen osiřelé `next start :3200` a fake-gopay `:3998` z kola 1 → ukončeny. Infrastruktura postavena znovu od nuly z migrací.
- Auditní sada zkopírována z `../tixly-audit/audit` (a6130f5) do `audit/` (bez logs/node_modules).

## Stav kroků
| Krok | Stav | Commit |
|---|---|---|
| A obnova | HOTOVO | 073b00f |
| 0 audit skripty + ověření kola 1 + x-user-id | HOTOVO | 8d97de9 (skripty), 43871e0 (fix x-vercel-cron) |
| 1 webhooky fail-closed | HOTOVO | 81aa2b7 (tabulka logs/r2/1_webhook_table.md) |
| 2 V2 | HOTOVO | c3c9b8e (+ tsc fix) |
| 3 V8 + 156 tabulek | rozpracováno | |
| 4 V9 R-56 | čeká | |
| 5 V4/S1/V6/S8/P1/QR | čeká | |
| Závěr + FIX_REPORT_R2 | čeká | |

## Krok 0 — výsledky (2026-10-03, app :3200 pod tixly_app)
Požadované kontroly: r2_e2e_02:P15a PASS, r2_e2e_03:R1b PASS, R1c PASS (opravený dotaz, kind=refund), r2_e2e_04_app:X14 PASS,
r2_e2e_05:C5 PASS (10×200, 50×429), r2_e2e_10: D1 D2 D3b D4 D5 D6 PASS (D3a = S8, krok 5), r2_e2e_12 (sonda expirace) E1–E4 PASS.
x-user-id: kiosk s podvrženým x-user-id existující obsluhy → 401, 0 objednávek (PASS hned). Navíc nalezeno a opraveno:
x-vercel-cron nebyl stripován a 3 cron routy ho braly jako autentizaci (resale-payouts 200 bez tajemství) → 43871e0.
Zbývající FAIL v audit sadě = nálezy kroků 2–5 (P1, P5d/C2b, P7d/X2/X3, P13, D3a, V12) + mimo zadání (R5, R6, V9b, X6).
Pozn.: tsc = 1 chyba v .next/types pro rfid/scan/route.ts (předexistující v d4b43f4, soubor je mezi necommitnutými změnami v tixly/).

## Krok 1 — výsledky
16+1 RED → GREEN 29/29 (`tests/fix-r2-webhooks.live.test.ts`); unit payment 63/63; HTTP audit 02 P4–P10b PASS po rebuildu.
Neopraveno: Pluxee — dotaz na stav u vendor API (vendor dokumentaci nemáme, endpoint by byl odhad).
Číslování migrací kola 2 od 480 (uživatel má necommitnuté 472–478; kolo 1 už kolidovalo na 472).

## Krok 2 — výsledky
RED 5/5 → GREEN 5/5 (`tests/fix-r2-v2-tixly-app.live.test.ts`), migrace 480 od nuly 26/26 + nad stávajícím 2×.
POZOR pro krok 3: storno/self-refund vrací kapacitu `UPDATE catalog.ticket_types` pod kontextem kupce — funguje jen díky
díře V8 (větev `status='published'` FOR ALL bez WITH CHECK). Test V2 kapacitu hlídá → po uzavření V8 musí zůstat zelený.
Neověřeno: admin/import pod tixly_app (stejná třída RETURNING) — změněn jen sentinel hesla.
