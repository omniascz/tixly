# Kolo 12 — provozní příručka a UX průchod administrací (divadelní agentura)

Větev `fix/round12-ux-2026-10-06` z `d0bbcb00` → PR do `integrate/2026-10-04`. Výstupy a screenshoty `logs/r12/`.
Prostředí: lokální demo agentura (`scripts/staging/create.sh --local`, DB `r12demo`), aplikace pod `tixly_app`, simulátor GoPay,
Mailpit. Žádné spojení na produkci.

## 1. UX průchod (Playwright, 1440 px a 390 px)

Stejný průchod (`e2e/tests/golden-path-r12-ux-walkthrough.spec.ts`) na původním kódu (d0bbcb00, čistý klon) a po opravách,
vždy na čisté demo DB. Kliknutí počítá jen klepnutí/výběry z /admin (bez psaní do polí).
Data: `logs/r12/before/ux-results.json`, `logs/r12/after/ux-results.json`.

| Úloha | Kliknutí před → po | Hlavní zaseknutí (před) | Opraveno |
|---|---|---|---|
| 1 Inscenace s fotkou a obsazením | 4 → 5 | Inscenace nejsou v menu (jen Vše → Produkce a reprízy); fotka jen jako odkaz; obsazení jako volný text | ano (+1 klik = řádek obsazení) |
| 2 Místo a sál, generátor, obkreslení | 12 → 12 | „Zpět" z editoru vede na 404; editor anglicky (Select/Undo/Uložit layout) | ano |
| 3 Termín, ceník, kategorie, zveřejnění | 14 → 12 | termín v sále bez míst v zónách se zveřejnil „V prodeji (0 míst)"; nástroje termínu 3 kliky hluboko | ano |
| 4 Blokace firma/tisk, uvolnění | 27 → 27 | blokace celé sekce bez volných míst se založila s 0 místy bez varování; uvolnění bez potvrzení | ano |
| 5 Firemní objednávka, zaplaceno | 11 → 11 | „Zaplaceno" přes okno prohlížeče (prompt „Reference platby (VS / ID transakce)"); místa neřazená | ano |
| 6 Promo kód na kategorii | 6 → 5 | Marketing nemá odkaz na promo kódy (jen přes Vše); kategorie kódem | ano |
| 7 Přesun a zrušení termínu | 8 → 8 | přesun (e-mail všem kupcům) bez potvrzení; zrušený termín v seznamu jako „Prodej" | ano |
| 8 Reporty, seznam pro uvaděčky | 7 → 6 | cesta přes Vše → Produkce; nepovedené stažení nic neřekne | ano |
| Kupec (mobil): program ve městě, místa, platba | 10 → 12 | na webu není odkaz na program podle měst (kupec hledal přes vyhledávání) | ano (+2 = Program a filtr města) |
| Kupec: rezervace | 3 → 3 | — | — |
| Pokladna: najít rezervaci, zaplatit, tisk | 8 → 6 | z Pokladny nevede cesta k rezervacím; 3× „Racek" bez města; po zaplacení chybí tisk vstupenek | ano |
| Pokladna: prodej na místě, tisk | 7 → 7 | 3× „Racek" bez města; tisk = souhrn s TOTP tajemstvím, bez QR | ano |
| Vstup (mobil): Ověřit průkaz / Jiný termín / Už použito | 7 → 11 | levé menu zabírá 240 px z 390; malé stavy, žádný zvuk/vibrace; výpadek sítě = zelené „vpuštěno" bez ověření | ano (+1 Menu, +3 nepovinná klepnutí na zavření panelu) |

Před: 10 zaseknutí + 1 prompt automaticky, 37 anglických a 6 technických textů; ruční posouzení screenshotů přidalo
tisk s TOTP, skener bez zvuku a výpadek sítě. Po: 0 zaseknutí, 0 zablokovaných úloh; automaticky jen „Role" (české slovo,
falešný nález).

## 2. Opravy (test-first: `e2e/tests/golden-path-r12-ux-fixes.spec.ts` F1–F12 RED 12/12 → GREEN 12/12)

| Commit | Oprava |
|---|---|
| 5ecf3ebb | sdílené potvrzovací okno s důsledky (místo confirm/prompt) a chyby API česky (co se stalo, co udělat) |
| ffaf2c06 | navigace: Inscenace v menu, Promo kódy z Marketingu, mobilní menu tlačítkem; role Pokladna česky a na serveru omezená jako Vstup (dřív přístup správce) |
| 4bbc9bd5 | seznam akcí: město a sál, „Zrušeno", jen denní akce česky |
| 5d345852 | blokace: bez volných míst se nezaloží prázdná (422 s návodem), uvolnění s potvrzením |
| f93076ed | firemní objednávka: zaplacení/zrušení v potvrzovacím okně, místa číselně |
| 5085f79c | přesun termínu: potvrzení „pošle e-mail všem kupcům" |
| 0e7838b6 | promo kódy: potvrzení vytvoření, kategorie názvem, chyby česky |
| 57be413f | termín v sále bez míst v cenových zónách se nezaloží (dřív „v prodeji, 0 míst") |
| cd308e60 | editor plánku česky, Zpět do knihovny míst (dřív 404), upozornění na místa bez zóny |
| 266db06d | inscenace: obsazení po řádcích, nahrání fotky souborem, přímé odkazy Blokace/Rezervace/Firemní/Reporty/Zrušení a přesun |
| f6976b8d | pokladna: česky, představení s městem, Rezervace k vyzvednutí, tisk vstupenek s QR (bez TOTP), tisk po zaplacení rezervace |
| 7d488780 | skener: velké barevné stavy, zvuk a vibrace (i Jiný termín), výpadek sítě bez seznamu = oranžové „Ověřte ručně" |
| eea05291 | web: odkaz Program (podle měst), „Pokračovat k objednávce" |
| 19fc99fe | slevové kategorie: kód z názvu; reporty: chyba stažení se zobrazí |
| 4902a427 | zbylé texty: skener „ticket ID", patička „Status", popisek plátna editoru (F8/F11/F12 RED 3 → GREEN); popis commitu se v shellu zkrátil — úplný popis je v následujícím commitu |
| a6238c4e | testy oprav, průchod před/po, turné a nákup na nové texty |

Box office: jedno pole pro kód, jméno, e-mail i telefon bylo už v původním kódu (stránka Rezervace na pokladně) — oprava
spočívala v cestě k němu z Pokladny. Nahrání fotky ověřeno jen po hlášku 503 (lokálně chybí `BLOB_READ_WRITE_TOKEN`).

## 3. Příručky

`docs/prirucka/` — `README.md`, `pro-agenturu.md` (8 úloh), `pro-pokladnu.md`, `pro-vstup.md` (výpadek internetu, odmítnutá
vstupenka); obrázky `docs/prirucka/img/` z průchodu po opravách. Popisky tlačítek a hlášek ověřeny proti kódu.

## 4. Lokální sada (finální kód 4902a427, DB `r12a` od nuly z migrací)

| Část | Výsledek |
|---|---|
| Typecheck | 0 chyb |
| Lint (baseline) | žádná nová chyba (979 vs baseline 1008) |
| Unit | 707 prošlo (13 skip); v prvním běhu na 0b86cc46 jednou vypršel `fix-r11-network-timeouts › GET /api/health/redis` (limit 20 s včetně načtení modulu pod zátěží), samostatně 3× zelený a celá sada znovu 707/707 |
| Live (simulátor GoPay, PgBouncer) | 83/83 souborů, 359 testů (21 souborů skip jen Neon) |
| Build | OK; build bez sítě s pojistkou OK (čistý klon na 4902a427) |
| Health | `/api/health/ready` 200, `/api/health/redis` 200, `/sitemap.xml` 200 |
| Audity | 01 26/0 · 02 36/0 · 03 23/0 · 04 14/0 · 05 8/0 · 06 21/0 · 07 6/0 · **07b 0 zápisů** · **08 166 rout × 3 aktéři, 0 úniků, 0× 5xx** · 09 12/0 · 10 7/0 · 11 8/0 · 12 5/0 |
| Divadelní turné | 10/10 (`logs/r12/tour`) |
| Testy oprav F1–F12 | 12/12; UX průchod po opravách 11/11 |

Logy: `logs/r12/4_*` (běh na 0b86cc46), `logs/r12/5_*` (RED/GREEN zbylých textů, turné, tsc/lint/unit), `logs/r12/6_*`
(live, audity, build bez sítě na finálním kódu).
