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
| A obnova | HOTOVO | (tento commit) |
| 0 audit skripty + ověření kola 1 + x-user-id | rozpracováno | |
| 1 webhooky fail-closed | čeká | |
| 2 V2 | čeká | |
| 3 V8 + 156 tabulek | čeká | |
| 4 V9 R-56 | čeká | |
| 5 V4/S1/V6/S8/P1/QR | čeká | |
| Závěr + FIX_REPORT_R2 | čeká | |
