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
| 2 sály a editor plánku | HOTOVO — mig 501 (venue_places, typ místa/zóna na sedadlech, seat_chart_id), sdílené schéma plánku (duplicity → 422), generátor + editor (typy míst, zóny s legendou, přečíslování, kopie řady, podklad průhlednost/měřítko/posun), kopie plánku do termínu (zóna→typ vstupenky, typy, oprava acc), převzetí u neprodaného termínu; unit 9/9, live RED 4 → GREEN 4/4; vizuál v kroku 9 | (viz commit) |
| 3 blokace míst | HOTOVO — mig 502 (seat_blocks + seat_block_seats, hold_kind block), založení z výběru/sekce, uvolnění, comps na jména, prodej na pokladně z blokace, přehled + plánek s barvami, souběh; RED 6 → GREEN 6/6 | (viz commit) |
| 4 slevové kategorie | HOTOVO — mig 503 (price_categories + ceny po zónách, kategorie na položkách/vstupenkách, promo omezení na kategorie), výchozí šablona jedním krokem, cena vždy na serveru (/api/checkout/seats), doprovod ZTP/P, limit kategorie, promo z ceny kategorie (kategorie/zóny/vlastník), PDF + e-mail s kategorií, skener „Ověřit průkaz: …“, UI kupce (kategorie u místa) + admin ceník; RED 4/5 → GREEN 6/6 (+ RED 0 Kč bez vstupenek); live celé 74/74 (22 skip jen Neon) | (viz commit) |
| 5 rezervace s platbou na pokladně | čeká | |
| 6 firemní objednávky na fakturu | čeká | |
| 7 zrušení a přesun (C-14) | čeká | |
| 8 reporty | čeká | |
| 9 E2E scénář turné | čeká | |
| Závěr | čeká | |

## Rozhodnutí použito / opraveno / nově
- Krok 0: POUŽITO platform.fee_schedules + PATCH /api/platform/promoters/[id] (feePctBps 0) + cron payouts-auto-settle (0 zachová); OPRAVENO lib/accounting/commission.ts (NO_FEES → no-op).
- Krok 1: POUŽITO catalog.productions + events.production_id + admin seznam inscenací, copyLayoutToEventSeats; ROZŠÍŘENO productions o kartu (mig 500), admin/productions (POST karta); NOVĚ admin/productions/[id] (GET/PATCH), [id]/terms (POST), lib/theatre/{terms,production-card,public-program}, api/public/productions/[id], api/public/program, stránky [locale]/inscenace/[id], [locale]/program, admin/productions/[id]; OPRAVENO veřejné čtení catalog.venues (web ukazoval „Online" místo sálu), build od nuly bral jen 4xx migrace (.github/scripts/build-db-from-migrations.sh), NOVĚ generovaný test ochrany rout (tests/route-guard-inventory.test.ts).
- Krok 2: POUŽITO catalog.venues (= sál), venue_seating_charts, event_seats, VisualEditor (výběr/posun/mazání/podklad PDF); OPRAVENO promotérská ukládací routa plánku (jiný tvar než editor → nešlo uložit), copyLayoutToEventSeats (seat.acc, duplicitní kopie, pomalý insert po jednom); NOVĚ catalog.venue_places + venues.place_id (mig 501), lib/seating/{generator,layout-schema}, TheatreTools.tsx, api/admin/venue-places[/id/halls], api/admin/events/[id]/seats/refresh, VenueLibrary.tsx, ceny podle zón při 1. termínu.
- Krok 4: POUŽITO marketing.promo_codes + promo_code_usages, ticket_types (= zóny), seat hold, createPayment/gateway policy/cutoff/order limity, demo-issuer, pdf-renderer, order-completed, scanner validate; OPRAVENO JOIN order_items u míst (víc položek jednoho typu → špatná položka/cena na vstupence) v order-completed, send-order-tickets, buyer ticket-pdf, print-labels; demo-issuer bral sedadla bez vazby na položku; stávající /api/checkout nekontroluje vlastníka promo kódu (nová cesta ano); NOVĚ catalog.price_categories + price_category_prices (mig 503), lib/theatre/{categories,category-schema,promo}, api/checkout/seats, api/admin/events/[id]/categories[/categoryId/prices], api/admin/price-categories, api/public/events/[id]/seat-prices, stránka [locale]/events/[id]/seats/kategorie, admin/events/[id]/kategorie, banner skeneru. Vizuál UI v kroku 9.
- Krok 3: POUŽITO držení na event_seats (status blocked, hold_label), holds/issue vzor pro comps, POS sale; OPRAVENO POS sale bral i místo ve stavu held (cizí košík / držení pořadatele); NOVĚ catalog.seat_blocks + seat_block_seats (mig 502), lib/theatre/blocks.ts, api/admin/events/[id]/blocks[/blockId/release|comps], api/admin/pos/events/[eventId]/seats, stránka admin/events/[id]/blokace, POS výběr z blokace. Pozn.: stávající holdy nesnižují remaining_qty (blokace ano, konzistentně).

## Poznámky
- Infrastruktura jako v kole 7: fix-pg :55632, fix-pgb :56633, fix-mail :51225/:58225, fix-redis :56679, fake-gopay :3998.
