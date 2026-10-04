# PROGRESS_R9 — kolo 9: dokončení před spuštěním a příprava ostrého provozu

Větev `fix/round9-golive-2026-10-04` z `37d7dc04`. Zakázáno: reflog expire, gc, prune, reset --hard, clean, push --force,
mazání wip/fix/integrate/audit větví, stash drop/clear. Nepushovat master, nemergovat PR #2, žádný deploy, žádná produkce.
Výstupy logs/r9/. Při startu nové session přečíst tento soubor. Procesy na pozadí po bloku ukončit.

## Stav
| Krok | Stav | Commit |
|---|---|---|
| 1a PgBouncer pool 10 | HOTOVO — audit/r2/pgb/pgbouncer.ini + CI blok default_pool_size 2 → 10; fix-pgb přemontován na soubor z tohoto repa; RED pool-nested 1/1 fail → live přes PgBouncer 79/79 (21 skip Neon) | (viz commit) |
| 1b promo UI kategorie/zóny | čeká | |
| 1c skener „jiný termín" | čeká | |
| 1d Next advisory (obrázky) | čeká | |
| 2 sloučení PR | čeká | |
| 3 inventura | čeká | |
| 4 staging skripty | čeká | |
| 5 runbook | čeká | |
| Závěr | čeká | |

## Poznámky
- fix-pgb dříve mountoval konfiguraci z ../tixly-fix; nyní z tixly/audit/r2/pgb (spuštěn bez argumentu příkazu — výchozí CMD image).
- Simulátor GoPay byl systémem ukončen (paměť) → live sada bez něj padá na ECONNREFUSED; pro bloky testů ho spouštět a po bloku ukončit.
