# Kolo 13 — rozhodnutí po souborech (kolo 12: `git diff d0bbcb00 2a1c9102`)

Referenční stav UI = `d0bbcb00`. ZACHOVAT = jen logika bodu (číslo = bod ze seznamu ZACHOVAT), texty a vzhled zpět na d0bbcb00.
Kde oprava potřebuje hlášku: nejkratší česká věta ve stylu okolních hlášek d0bbcb00.

Commity kola 12: 2bcc40cf (test R12-1), 5ecf3ebb (2a), ffaf2c06 (2b), 4bbc9bd5 (2c), 5d345852 (2d), f93076ed (2e), 5085f79c (2f),
0e7838b6 (2g), 57be413f (2h), cd308e60 (2i), 266db06d (2j), f6976b8d (2k), 7d488780 (2l), eea05291 (2m), 19fc99fe (2n),
a6238c4e (test R12-2), 4902a427 (2o), 0b86cc46 (docs), 3595a0e8 (test/logy), f5004e0f / aab95fca (PROGRESS).

## Aplikace — server a knihovny

| Soubor | Commit R12 | Rozhodnutí | Bod |
|---|---|---|---|
| `src/lib/admin-auth.ts` | ffaf2c06 | **ZACHOVAT** `OPERATIONS_ONLY` (staff + box_office) v `runAsPromoterNonStaff` / `runAsActivePromoterNonStaff` | 3 |
| `src/lib/admin/nav.ts` | ffaf2c06 | **VRÁTIT** celé — položka Inscenace v menu, úzké menu pokladny (`OPERATIONS_ROLES`). Menu pokladny = d0bbcb00; pokladní routy (POS, rezervace, platba, tisk, skener) jsou `runAsActivePromoter`/`runAsPromoter`, cesta zůstává | — |
| `src/lib/theatre/blocks.ts` | 5d345852 | **ZACHOVAT** chybu `NO_SEATS` při 0 volných místech (transakce se vrátí); hláška zkrácena: „Ve výběru nejsou volná místa." | 5 |
| `src/lib/theatre/terms.ts` | 57be413f | **ZACHOVAT** `NO_SELLABLE_SEATS` (sedadlový ceník a 0 prodejných míst → ROLLBACK, termín nevznikne, tedy ani nejde zveřejnit); hláška zkrácena: „Sál nemá místa přiřazená do cenových zón."; **VRÁTIT** výběr `name` sálu | 4 |
| `src/app/api/admin/productions/[id]/terms/route.ts` | 57be413f | **ZACHOVAT** `NO_SELLABLE_SEATS: 422`; **VRÁTIT** českou hlášku `SALES_END_AFTER_EVENT_END` | 4 |
| `src/app/api/admin/pos/events/route.ts` | f6976b8d | **ZACHOVAT** `venueCity` | 9 |
| `src/app/api/admin/events/route.ts` | 4bbc9bd5 | **VRÁTIT** (JOIN sálu, město v seznamu akcí) | — |
| `src/types/admin.ts` | 4bbc9bd5 | **ZACHOVAT** `'cancelled'` v `ModerationStatus`; **VRÁTIT** `venueCity`/`venueName` | 7 |
| `src/app/api/admin/promo-codes/route.ts` | 0e7838b6 | **VRÁTIT** (`category_names`) | — |
| `src/app/api/admin/scanner/validate/route.ts` | 7d488780 | **VRÁTIT** (česká hláška `invalid_status`) | — |
| `src/app/api/admin/staff/route.ts`, `staff/[userId]/route.ts` | ffaf2c06 | **VRÁTIT** (pozvání role box_office) | — |
| `src/lib/ui/error-text.ts` | 5ecf3ebb | **VRÁTIT** (smazat) | — |

## Aplikace — obrazovky

| Soubor | Commit R12 | Rozhodnutí | Bod |
|---|---|---|---|
| `src/app/admin/scanner/page.tsx` | 7d488780, 4902a427 | **ZACHOVAT** jen logiku: výpadek sítě během ověření → kontrola proti staženému seznamu (jako offline režim d0bbcb00); bez seznamu (offline i výpadek) výsledek `error` s hláškou „OFFLINE: lístek nelze ověřit (není stažený seznam) — zkontroluj ho ručně." místo zeleného „Vstup povolen". **VRÁTIT** vše ostatní (texty, ScanState, zvuk, vibrace d0bbcb00 zpět, TOTP pole, auto-ověření z kamery, nadpisy) | 1 |
| `src/app/admin/scanner/ScanState.tsx` | 7d488780 | **VRÁTIT** (smazat) | — |
| `src/app/admin/scanner/guide/page.tsx` | 4902a427 | **VRÁTIT** | — |
| `src/app/admin/pos/page.tsx` | f6976b8d | **ZACHOVAT** tlačítko „Vytisknout / uložit jako PDF" otevře PDF vstupenek s QR (`/api/admin/orders/:id/print-labels`) místo `window.print()` souhrnu; z tiskového bloku pryč řádek „TOTP secret" (bod 2). **ZACHOVAT** město v položce představení (bod 9). **VRÁTIT** vše ostatní (nadpis, popisky, odkaz na rezervace, druhé tlačítko, texty) | 2, 9 |
| `src/app/admin/events/page.tsx` | 4bbc9bd5 | **ZACHOVAT** `case 'cancelled'` → „Zrušeno" (text existuje v d0bbcb00, karta inscenace `STATUS.cancelled`); **VRÁTIT** sloupec Místo, odkazy v řádku, texty klonování | 7 |
| `src/app/admin/events/[id]/zruseni/page.tsx` | 5085f79c | **ZACHOVAT** potvrzení před přesunem (e-mail všem kupcům) a před zrušením termínu — jednoduché `window.confirm`; **VRÁTIT** ConfirmDialog, errorText | 10 |
| `src/app/admin/events/[id]/firemni/page.tsx` | f93076ed | **VRÁTIT** celé — storno firemní objednávky má v d0bbcb00 okno prohlížeče (`window.prompt` s důvodem, Zrušit = nic se nestane), tj. potvrzení už existuje (bod 10 splněn beze změny); „Zaplaceno" zpět na okno prohlížeče | (10) |
| `src/app/admin/events/[id]/reporty/page.tsx` | 19fc99fe | **ZACHOVAT** chyba stažení se ukáže: „Soubor se nepodařilo stáhnout (HTTP …)."; **VRÁTIT** popisky tlačítek, errorText | 8 |
| `src/app/admin/events/[id]/blokace/page.tsx` | 5d345852 | **VRÁTIT** celé (chybu serveru `j.message` zobrazuje už d0bbcb00); potvrzení uvolnění, stavy česky pryč | — (5 na serveru) |
| `src/app/admin/venues/[venueId]/seating-chart/editor/page.tsx` | cd308e60 | **ZACHOVAT** odkaz „← Zpět na detail sálu" vede na `/admin/venues` (dřív `/admin/venues/:id` = 404; karta sálu je v knihovně míst); **VRÁTIT** texty, nadpis, výchozí název | 6 |
| `src/app/platform/venues/[id]/seating-chart/editor/VisualEditor.tsx` | cd308e60, 4902a427 | **VRÁTIT** (texty, upozornění na místa bez zóny, aria-label) | — |
| `src/app/admin/venues/page.tsx` | cd308e60 | **VRÁTIT** | — |
| `src/app/admin/events/[id]/kategorie/page.tsx` | 19fc99fe | **VRÁTIT** | — |
| `src/app/admin/events/[id]/rezervace/page.tsx` | f6976b8d | **VRÁTIT** (tisk po zaplacení rezervace, errorText) | — |
| `src/app/admin/productions/[id]/page.tsx`, `productions/page.tsx` | 266db06d | **VRÁTIT** (obsazení po řádcích, nahrání fotky, odkazy nástrojů termínu) | — |
| `src/app/admin/promo-codes/page.tsx` | 0e7838b6 | **VRÁTIT** | — |
| `src/app/admin/marketing/page.tsx` | ffaf2c06 | **VRÁTIT** | — |
| `src/app/admin/layout.tsx`, `components/admin/Sidebar.tsx`, `Topbar.tsx`, `PageHeader.tsx` | ffaf2c06 | **VRÁTIT** (mobilní menu, hlavička, h1) | — |
| `src/app/admin/staff/page.tsx`, `team/page.tsx` | ffaf2c06 | **VRÁTIT** | — |
| `src/components/admin/ConfirmDialog.tsx` | 5ecf3ebb | **VRÁTIT** (smazat) | — |
| `src/components/public/TopNav.tsx`, `src/app/[locale]/layout.tsx` | eea05291, 4902a427 | **VRÁTIT** (odkaz Program, patička Status) | — |
| `SeatPicker.tsx`, `SlotPickerClient.tsx`, `LotteryRedeemClient.tsx` | eea05291 | **VRÁTIT** („Pokračovat k objednávce") | — |

## Testy, dokumentace, logy

| Soubor | Rozhodnutí | Bod |
|---|---|---|
| `e2e/tests/golden-path-r12-ux-fixes.spec.ts` | **UPRAVIT** → `golden-path-r13-keep.spec.ts`: jen testy bodů 1–10 na původním UI; testy vráceného UX pryč | 11 |
| `e2e/tests/golden-path-r12-ux-walkthrough.spec.ts`, `e2e/tests/helpers/ux-meter.ts` | **VRÁTIT** (smazat — průchod vráceného UX) | — |
| `e2e/tests/golden-path-r8-theatre-tour.spec.ts` | **VRÁTIT** na d0bbcb00 + jen přijetí `window.confirm` u zrušení/přesunu (bod 10) | 10 |
| `e2e/tests/golden-path-buyer.spec.ts` | **VRÁTIT** | — |
| `docs/prirucka/*` | **UPRAVIT** na vrácené UI (krok 5) | — |
| `ROUND12_REPORT.md`, `PROGRESS_R12.md`, `logs/r12/*` | ponechat (historie kola 12) | — |
| nový `e2e/tests/golden-path-r13-screens.spec.ts` | screenshoty hlavních obrazovek d0bbcb00 vs výsledek (krok 4) | — |
