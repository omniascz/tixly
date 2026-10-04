# PROGRESS_R8 — kolo 8: divadelní prodej pro turné agenturu

Větev `fix/round8-theatre-2026-10-04` z `505084a8` v `tixly/`. PR na konci do `integrate/2026-10-04`.
Zakázáno: reflog expire, gc, prune, reset --hard, clean, push --force, mazání wip/fix/integrate/audit větví,
stash drop/clear. Nepushovat master, nespouštět deploy, žádná produkce, testy jen na localhost.
Migrace od 500. Výstupy: logs/r8/. Při startu nové session: přečíst tento soubor.

## Stav kroků
| Krok | Stav | Commit |
|---|---|---|
| 0 provize 0 | HOTOVO — použito: fee_schedules (0 % jde nastavit, výpočty `??`); opraveno: faktura provize při 0 → 200 bez faktury (dřív 422 NO_FEES) ; RED 1 → GREEN 2/2 | (viz commit) |
| 1 inscenace a termíny | HOTOVO — mig 500 (karta inscenace, doplňky termínu, veřejné čtení inscenací a sálů), termín na pár kliknutí (ceník z předchozího termínu, sedadla z plánku), veřejná stránka inscenace, program podle měst + filtr; RED 6 → GREEN 6/6 | (viz commit) |
| 2 sály a editor plánku | čeká | |
| 3 blokace míst | čeká | |
| 4 slevové kategorie | čeká | |
| 5 rezervace s platbou na pokladně | čeká | |
| 6 firemní objednávky na fakturu | čeká | |
| 7 zrušení a přesun (C-14) | čeká | |
| 8 reporty | čeká | |
| 9 E2E scénář turné | čeká | |
| Závěr | čeká | |

## Rozhodnutí použito / opraveno / nově
- Krok 0: POUŽITO platform.fee_schedules + PATCH /api/platform/promoters/[id] (feePctBps 0) + cron payouts-auto-settle (0 zachová); OPRAVENO lib/accounting/commission.ts (NO_FEES → no-op).
- Krok 1: POUŽITO catalog.productions + events.production_id + admin seznam inscenací, copyLayoutToEventSeats; ROZŠÍŘENO productions o kartu (mig 500), admin/productions (POST karta); NOVĚ admin/productions/[id] (GET/PATCH), [id]/terms (POST), lib/theatre/{terms,production-card,public-program}, api/public/productions/[id], api/public/program, stránky [locale]/inscenace/[id], [locale]/program, admin/productions/[id]; OPRAVENO veřejné čtení catalog.venues (web ukazoval „Online" místo sálu), build od nuly bral jen 4xx migrace (.github/scripts/build-db-from-migrations.sh), NOVĚ generovaný test ochrany rout (tests/route-guard-inventory.test.ts).

## Poznámky
- Infrastruktura jako v kole 7: fix-pg :55632, fix-pgb :56633, fix-mail :51225/:58225, fix-redis :56679, fake-gopay :3998.
