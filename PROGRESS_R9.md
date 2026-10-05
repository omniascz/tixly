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
| 2 sloučení PR | HOTOVO — PR #3 (8aadf388), #4 (0f3e2186), #5 (f391fcc2) do integrate; sada na integrate: migrace 59/0, RLS/drift OK, tsc 0, lint bez nové, unit 655 (po LF checkoutu 2 souborů), live přes PgBouncer 80/80, build OK, audity 01–11 OK, **12 FAIL** → nalezena a opravena chyba kapacity (fe7fa8d3); turné na integrate NEPROBĚHLO — simulátor GoPay a server ukončil systém kvůli nedostatku paměti | (viz commit) |
| 3 inventura | HOTOVO — GO-LIVE-INVENTORY.md (206 env proměnných, e-mail, GitHub secrets, crony, DB role, doména/CSRF/webhooky); klíčová tvrzení ověřena v kódu | (viz commit) |
| 4 staging skripty | HOTOVO — create.sh (Neon samostatný projekt / --local), seed-demo.sql, vercel-preview.env.example, smoke.sh, pojistka staging-guard (instrumentation + DB pooly + GoPay/ComGate); shellcheck 0; dry-run vč. odmítnutí produkce; create.sh --local proti lokálnímu Postgresu OK (2 místa, 2 inscenace, 4 termíny, 400 míst, 20 kategorií, 24 blokovaných; tixly_app NOBYPASSRLS; idempotentní); boot test: staging s produkční DB (falešný host) odmítne, izolovaný naběhne | (viz commit) |
| 5 runbook | HOTOVO — GO-LIVE-RUNBOOK.md (preflight, záloha + ověření obnovy, migrace, nasazení, smoke, rollback, 48 h); scripts/prod/preflight.sql (READ ONLY) a pending-migrations.sh ověřeny lokálně (očekávané hodnoty, 500–506 chybějící při simulaci); záloha+obnova ověřena lokálně; deploy.yml: migrace PŘED deployem + VERCEL_ORG_ID/PROJECT_ID | (viz commit) |
| Závěr | ROUND9_REPORT.md; turné na integrate a audit 12 po opravě čekají na restart serveru/simulátoru (ukončil je systém kvůli paměti) | (viz commit) |

## Poznámky
- fix-pgb dříve mountoval konfiguraci z ../tixly-fix; nyní z tixly/audit/r2/pgb (spuštěn bez argumentu příkazu — výchozí CMD image).
- Simulátor GoPay byl systémem ukončen (paměť) → live sada bez něj padá na ECONNREFUSED; pro bloky testů ho spouštět a po bloku ukončit.
