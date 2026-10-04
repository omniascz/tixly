# PROGRESS_R9 — kolo 9: dokončení před spuštěním a příprava ostrého provozu

Větev `fix/round9-golive-2026-10-04` z `37d7dc04`. Zakázáno: reflog expire, gc, prune, reset --hard, clean, push --force,
mazání wip/fix/integrate/audit větví, stash drop/clear. Nepushovat master, nemergovat PR #2, žádný deploy, žádná produkce.
Výstupy logs/r9/. Při startu nové session přečíst tento soubor. Procesy na pozadí po bloku ukončit.

## Stav
| Krok | Stav | Commit |
|---|---|---|
| 1a PgBouncer pool 10 | HOTOVO — audit/r2/pgb/pgbouncer.ini + CI blok default_pool_size 2 → 10; fix-pgb přemontován na soubor z tohoto repa; RED pool-nested 1/1 fail → live přes PgBouncer 79/79 (21 skip Neon) | (viz commit) |
| 1b promo UI kategorie/zóny | HOTOVO — výběr termínu → zaškrtnutí kategorií a zón, sloupec Omezení v seznamu, kontrola vlastnictví termínů/zón v API; Playwright A: RED (chybí ovládání) → GREEN | (viz commit) |
| 1c skener „jiný termín" | HOTOVO — hláška „Lístek platí na jiný termín: Racek — 29. 10. 2027 19:30, Ostrava (Komorní scéna)." + validFor; RED 1/1 → GREEN 1/1 (+ v9b 4/4) | (viz commit) |
| 1d Next advisory (obrázky) | HOTOVO — GHSA-2xp9-vwfh-vxw4 (critical, RCE AVIF) bez konfiguračního workaroundu → images.unoptimized: true (GHSA-h64f: „NOT impacted"); odstraněn placeholder cdn.example.com; opraven kiosk (neexistující sloupce → 500, nečitelné nadpisy); Playwright B: RED (kiosk 500) → GREEN, obrázky na webu i v administraci, /_next/image neodpovídá 200 | (viz commit) |
| 2 sloučení PR | čeká | |
| 3 inventura | čeká | |
| 4 staging skripty | čeká | |
| 5 runbook | čeká | |
| Závěr | čeká | |

## Poznámky
- fix-pgb dříve mountoval konfiguraci z ../tixly-fix; nyní z tixly/audit/r2/pgb (spuštěn bez argumentu příkazu — výchozí CMD image).
- Simulátor GoPay byl systémem ukončen (paměť) → live sada bez něj padá na ECONNREFUSED; pro bloky testů ho spouštět a po bloku ukončit.
