# Kolo 13 — vrácení UX z kola 12, zachovány jen opravy chyb a bezpečnosti

Větev `fix/round13-revert-ux-2026-10-06` z `2a1c9102` (integrate po kole 12) → PR do `integrate/2026-10-04`.
Referenční UI `d0bbcb00`. Historie nepřepsána — vráceno novými commity. Výstupy `logs/r13/`, rozhodnutí po souborech
`logs/r13/rozhodnuti.md` (commit 04c62800, před úpravami).

## 1. Zachováno (body 1–11)

| Bod | Co | Kde (logika) | Commit |
|---|---|---|---|
| 1 | Skener: výpadek sítě během ověření → kontrola proti staženému offline seznamu; bez seznamu (i offline režim) výsledek „Chyba" s hláškou „OFFLINE: lístek nelze ověřit (není stažený seznam) — zkontroluj ho ručně." místo zeleného „Vstup povolen" | `app/admin/scanner/page.tsx` (`offlineCheck`) | b230caa9 |
| 2 | Pokladna: tlačítko „Vytisknout / uložit jako PDF" otevře PDF vstupenek s QR (`/api/admin/orders/:id/print-labels`) místo `window.print()` souhrnu; z tiskového bloku pryč „TOTP secret" | `app/admin/pos/page.tsx` | b230caa9 |
| 3 | Role Pokladna (box_office) má na serveru stejné omezení jako staff ve všech `*NonStaff` routách (dřív přístup správce) | `lib/admin-auth.ts` | ffaf2c06 (ponecháno) |
| 4 | Termín v sále bez míst v cenových zónách se nezaloží (tedy ani nezveřejní): 422 „Sál nemá místa přiřazená do cenových zón." | `lib/theatre/terms.ts`, `api/admin/productions/[id]/terms` | b230caa9 |
| 5 | Blokace bez volných míst se nezaloží prázdná: 422 „Ve výběru nejsou volná místa." | `lib/theatre/blocks.ts` | b230caa9 |
| 6 | „← Zpět na detail sálu" z editoru plánku vede na `/admin/venues` (dřív `/admin/venues/:id` = 404) | `admin/venues/[venueId]/seating-chart/editor/page.tsx` | b230caa9 |
| 7 | Zrušený termín v seznamu akcí „Zrušeno" (text z d0bbcb00, karta inscenace) místo „Prodej" | `admin/events/page.tsx`, `types/admin.ts` | b230caa9 |
| 8 | Nepovedené stažení reportu: „Soubor se nepodařilo stáhnout (HTTP …)." | `admin/events/[id]/reporty/page.tsx` | b230caa9 |
| 9 | Pokladna: v seznamu představení město („Racek — Brno (27. 10. 2026)") | `admin/pos/page.tsx`, `api/admin/pos/events` | b230caa9 (API z f6976b8d ponecháno) |
| 10 | Okno prohlížeče (`window.confirm`) před přesunem termínu („Přesunout termín? Všem kupcům odejde e-mail s novým datem.") a před zrušením termínu („Zrušit termín? Vstupenky přestanou platit a kupcům se vrátí peníze."); storno firemní objednávky (okno s důvodem) a vrácení peněz u objednávky (dialog) mají potvrzení už v d0bbcb00 — beze změny | `admin/events/[id]/zruseni/page.tsx` | b230caa9 |
| 11 | Testy bodů 1–10 na původním UI: `e2e/tests/golden-path-r13-keep.spec.ts` (nahrazuje F1–F12) — výsledek 10/10; na d0bbcb00 padají všechny kromě storna firemní objednávky (potvrzení tam už je) | `logs/r13/2_keep_run3.txt`, `6_keep_final.txt`, `2_keep_red_d0bbcb00*.txt` | c7e7a3f3 |

## 2. Vráceno na d0bbcb00

Texty a překlady (administrace, editor plánku „Seating editor / Uložit layout", skener „Scanner / Validovat lístek",
pokladna „Pokladna (POS) / Vystavit lístek", „zbylé anglické texty", patička „Status", „Pokračovat na pokladnu");
menu a navigace (Inscenace v menu, promo kódy z Marketingu, přímé odkazy nástrojů termínu z karty inscenace, mobilní menu
tlačítkem, úzké menu pokladny, odkaz pokladna → rezervace, odkaz Program na webu, hlavička Administrace / role, h1);
potvrzovací okna mimo bod 10 (uvolnění blokace, ConfirmDialog), formulář místo okna prohlížeče u „Zaplaceno";
nahrávání fotky souborem a obsazení po řádcích; zvuk, vibrace a nový vzhled stavů skeneru (ScanState), auto-ověření
z kamery, TOTP pole v rozbalovací části; tisk po zaplacení rezervace; město v seznamu akcí; české hlášky API (errorText,
skener, termín); pozvání role Pokladna; kód kategorie z názvu; ostatní vizuální úpravy. Smazány ConfirmDialog, ScanState,
error-text, UX průchod kola 12 a ux-meter. Commit b230caa9 (aplikace), c7e7a3f3 (testy).

## 3. Zbývající rozdíly v UI proti d0bbcb00

`git diff d0bbcb00 HEAD -- nextjs-boilerplate/src` (`logs/r13/3_diff_ui_vs_d0bbcb00.patch`) obsahuje jen:

| Soubor | Rozdíl | Bod |
|---|---|---|
| `app/admin/scanner/page.tsx` | `offlineCheck` pro offline i pád sítě; bez seznamu `error` + nová hláška | 1 |
| `app/admin/pos/page.tsx` | `handlePrint` otevře print-labels; řádek TOTP pryč; `venueCity` v položce | 2, 9 |
| `lib/admin-auth.ts` | `OPERATIONS_ONLY` | 3 |
| `lib/theatre/terms.ts`, `api/admin/productions/[id]/terms/route.ts` | `NO_SELLABLE_SEATS` | 4 |
| `lib/theatre/blocks.ts` | `NO_SEATS` při 0 volných | 5 |
| `app/admin/venues/[venueId]/seating-chart/editor/page.tsx` | href Zpět | 6 |
| `app/admin/events/page.tsx`, `types/admin.ts` | `cancelled` → „Zrušeno" | 7 |
| `app/admin/events/[id]/reporty/page.tsx` | návrat chyby z `download` | 8 |
| `api/admin/pos/events/route.ts` | `venueCity` | 9 |
| `app/admin/events/[id]/zruseni/page.tsx` | `window.confirm` u přesunu a zrušení | 10 |

Screenshoty (`golden-path-r13-screens.spec.ts`, d0bbcb00 z čistého klonu vs výsledek, stejná DB `r13demo`, 22 obrazovek:
menu administrace desktop/mobil, akce, inscenace a termíny, termín, editor plánku, blokace, firemní, promo kódy, reporty,
zrušení/přesun, pokladna desktop/mobil, skener desktop/mobil, sály, web úvod/akce/místa desktop/mobil): **19 pixelově
shodných**, rozdíl jen `02-akce-seznam` (bod 7 — štítek „Zrušeno" a posun sloupce o jeho šířku) a `11-pokladna` 1440/390
(bod 9 — město). Body 1, 2, 10 se projeví až po akci (pokrývá `golden-path-r13-keep`). `logs/r13/4_screens_compare.txt`,
`logs/r13/screens/{d0bbcb00,r13,diff}`.

Výjimka dostupnosti: **nepoužita** — po vrácení mají všechny funkce kol 8–11 cestu jako v d0bbcb00 (Vše → Produkce a
reprízy; Akce → Upravit → Vstupenky → Blokace míst / Slevové kategorie / Rezervace na pokladně / Firemní objednávky /
Zrušení a přesun / Divadelní reporty; Vše → Promo kódy; Sály → Editor plánku). Poznámka: menu pokladny je jako v
d0bbcb00 (plné); položky, které server pokladně kvůli bodu 3 odmítne (finance, nastavení, tým…), skončí chybou přístupu.
Pokladní routy (POS, rezervace, platba, tisk, skener) jsou `runAsActivePromoter`/`runAsPromoter` a fungují.

## 4. Lokální sada (kód b230caa9 = HEAD v aplikaci; DB `r13a` od nuly z migrací)

| Část | Výsledek |
|---|---|
| Typecheck | 0 chyb |
| Lint (baseline) | žádná nová chyba |
| Unit | 707 prošlo (13 skip) |
| Live (simulátor GoPay, PgBouncer) | 83/83 souborů, 359 testů (21 souborů skip jen Neon) |
| Build | OK (varování OpenTelemetry/Sentry jako v kolech 11–12); build bez sítě s pojistkou OK (čistý klon na aea72c85) |
| Health | `/api/health/ready` 200, `/api/health/redis` 200, `/sitemap.xml` 200 |
| Audity | 01 26/0 · 02 36/0 · 03 23/0 · 04 14/0 · 05 8/0 · 06 21/0 · 07 6/0 · **07b 0 zápisů** · **08 166 rout × 3 aktéři, 0 úniků, 0× 5xx** · 09 12/0 · 10 7/0 · 11 8/0 · 12 5/0 |
| Divadelní turné | 10/10 (`logs/r13/tour`) |
| Zachované opravy (body 1–10) | 10/10 (`logs/r13/6_keep_final.txt`) |

## 5. Příručky

`docs/prirucka/` přepsány na původní UI (aea72c85): popisky ověřeny proti kódu, obrázky z průchodu na výsledku kola 13
(`logs/r13/walk` — průchod kola 12 spuštěn jen dočasně, do repa nevrácen) a skener z `logs/r13/screens`.
