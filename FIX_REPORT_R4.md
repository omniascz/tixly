# FIX_REPORT_R4 — kolo 4 oprav Tixly (průběžně)

Větev `fix/round4-2026-10-03` (worktree `../tixly-fix`), základ `e5789d7`.
Prostředí: izolovaná DB z migrací, PgBouncer transaction mode, fake-gopay, Mailpit, Redis; vše pod `tixly_app`.

## Nálezy
| Nález | Příčina | Oprava | Test | RED → GREEN | Commit |
|---|---|---|---|---|---|
| S2 upgrade únik (audit 08 I1) | GET v servisním kontextu bez kontroly vlastníka; POST 403 NOT_OWNER prozrazoval existenci, vlastnictví i přes ownerEmail | vlastnictví pod RLS kupce, cizí → 404 bez dat, bez identity 401; POST jen ověřená identita | fix-r4-s2-upgrade-leak | cizí kupec 200 s daty → 3/3 | 7b481c1 |
| 5xx calendar.ics (audit 08 I2) | `pg` vrací timestamptz jako Date, `iso.replace` → 500 pro všechny vč. vlastníka; neplatné UUID → 22P02 | datum přes `toISOString`, kontrola UUID → 404; UID = otisk, ne ID objednávky (capability hosta zachována) | fix-r4-5xx-ics-kiosk | 500 → 200/403/404 | 03f6c93 |
| 5xx kiosk (audit 08 I2) | dotaz na neexistující `capacity`, `is_active`, `sort_order` → 500 vždy | `total_qty`, jen veřejné typy, řazení podle ceny | fix-r4-5xx-ics-kiosk | 500 → 200/422/404 | 03f6c93 |

| 25 rout bez identity (R3 bod 3) | middleware předával `x-user-id` jen u vyjmenovaných prefixů; jinde přihlášený dostal 401 | ověřená identita u všech `/api` cest, povinnost přihlášení dál prefix/handler | fix-r4-identity-all-api | 3 fail (40 kombinací, cookie, handler 401) → 5/5 | 724005c |
| scanner/school-group bez ověření (inventura) | odbavení školní skupiny bez jakékoli autentizace | jen aktivní pořadatel rezervace; cizí = jako neexistující token | fix-r4-school-group-scan | 2 fail (anonym i cizí admitted s daty) → 3/3 | 980442e |
| mock-qes bez produkční pojistky (inventura) | routa zapisuje podpis přímo; výchozí QES = mock; obcházela pojistku webhooku z kola 2 | 403 MOCK_DISABLED v produkci (ALLOW_MOCK_PAYMENTS=1 jen demo) | fix-r4-mock-qes-prod | GET 200 s PDF a e-mailem → 403, žádost pending | 3097c7b |
| qes_signing_requests R-58 (při 2c) | policy čte `app.bypass_rls`; QES pod tixly_app nefunguje | migrace 489: admin/servis/vlastní pořadatel | fix-r4-qes-policy | 2 fail (servis 0 řádků, 404) → 2/2; od nuly OK, 2× OK | 06bfdbf |
| přeprodej přes `ownerEmail` (inventura) | vlastnictví podle e-mailu z těla; anonym vystavil cizí vstupenku za 1 Kč a stáhl cizí inzerát | ověřená identita, nebo host s UUID své objednávky (capability stránky potvrzení); tlačítko posílá orderId | fix-r4-resale-owner-email | 2 fail (201 za 1 Kč, 200 stažení) → 4/4 | 3676a27 |
| pamětní vstupenka `?token=` cokoli (inventura) | `hasQueryToken = !!queryToken` — token se neověřoval ani nevydával | vlastník nebo HMAC token této vstupenky; ověření před dotazem; e-mail nese token | fix-r4-memory-token | 3 fail (?token=x → data) → 3/3 | 7203bc8 |
| konfigurace před přihlášením (wallet/apple, mobile/payment-intent) | kontrola env před `runAsUser` → anonym 503 | kontrola uvnitř `runAsUser` | fix-r4-auth-before-config | anonym 503 → 401 (přihlášený 503) | 7d600b7 |
| B2B kredit jen podle kódu účtu (verify + checkout) | checkout strhl kredit firmy bez ověření kupujícího; verify vracel zůstatek komukoli s kódem | jen přihlášený člen účtu (joined/admin); verify 401/403; checkout pre-check + debit FOR UPDATE | fix-r4-b2b-credit-auth | 2 fail (zůstatek 200, nákup na firmu 200) → 4/4 | 1bdd439 |
| seat-upgrade-notify (R3 bod 4) | čte `catalog.seats` (sedadla sálu) a `seat_upgrades.order_id/notified_at` — neexistují; e-mail jen logoval | `event_seats`, lepší volné místo téhož typu a sektoru, skutečný e-mail, log v nové tabulce (migrace 490) | fix-r4-seat-upgrade-notify | 500 → 2/2; od nuly OK, 2× OK | 9524f6e |
| RLS politiky `true` (R3 bod 4) | 19 politik s `true`: 7 zápisových dovolovalo cizí řádek; čtení ukazovalo koncepty akcí a neaktivní pořadatele (bankovní účet, KYC) | migrace 491: zápis servis/vlastník, čtení jen publikované/aktivní; 10 veřejných ponecháno s důvodem; routy alert/upgrade servisně | fix-r4-true-policies | 2 fail (4× cizí INSERT, koncept/pending vidět) → 3/3 | 3fa3b71 |
| převzetí převodu vstupenky (odhaleno při 3b) | UPDATE vlastníka v kontextu příjemce → 0 řádků, přesto 200 claimed | `asSystemInTx` po ověření, podmínka owner_id = odesílatel, jinak 409 a převod pending | fix-r4-transfer-claim | 2 fail (vlastník beze změny, tiché claimed) → 2/2 | 4fea477 |
| veřejný e-mail organizátora (R3 bod 4) | pozvánka do skupiny vracela e-mail a ID organizátora, náhled převodu e-mail odesílatele, dárek e-mail dárce bez jména | jen jméno, UI fallback na obecný text | fix-r4-public-contacts | 3 fail → 3/3 | 133dfc2 |
| restwert abonentky (R3 bod 4) | politika pouští kupce na vlastní řádek, sloupce nehlídá → kupec si navýšil kredit/platnost | migrace 492: guard chráněných sloupců (vzor 486) | fix-r4-holders-guard | kredit 9 999 999 povolen → 42501 (2/2) | d235d8d |
| výměna mění celou objednávku (R3 bod 4) | `UPDATE orders.event_id` pro celou objednávku → ostatní vstupenky na novém termínu; typ lístku původní akce | jediná vstupenka: přepnout objednávku + typ; více: přesun do nové objednávky výměny (cena 0) | fix-r4-exchange-single-ticket | obě vstupenky přesunuty → 2/2 | caad0e0 |
<!-- /nalezy -->

**Krok 1 — audit 08 po opravách:** I1 PASS (154 GET rout × 3 cizí aktéři, 0 úniků), I2 PASS (0 odpovědí 5xx). `logs/r4/1c_r2_e2e_08.out`.


## Krok 2 — tabulka všech API rout (`logs/r4/2_routes.tsv`, klasifikátor `audit/r4/classify-routes.mjs`)

696 souborů rout, 984 kombinací routa+metoda. Počty podle typu volajícího:

| Typ volajícího | Počet |
|---|---|
| pořadatel | 481 |
| kupec | 121 |
| admin | 91 |
| servis | 62 |
| veřejná (GET) | 50 |
| veřejná | 39 |
| veřejná (zápis hosta) | 35 |
| partner | 31 |
| veřejná (capability) | 30 |
| veřejná (auth) | 29 |
| vypnuto (demo) | 5 |
| brána (webhook) | 5 |
| prodejce | 4 |
| veřejná (OAuth) | 1 |

Neveřejné (pořadatel, admin, kupec, servis, partner, prodejce) = **790**. Generovaný test `fix-r4-routes-anon`
(produkční režim, skutečný middleware): **789 × 401/403**, 1 v harnessu nespustitelná (`POST /api/oauth/authorize`,
`cookies()` z next/headers) — ověřena HTTP v závěru. RED před opravami: 42 jiných statusů
(`logs/r4/2b_routes_anon_RED.txt`). Commit tabulky a testu: bea7c5d.

Opravené routy v kroku 2: 25 rout bez identity (middleware), `scanner/school-group`, `mock-qes`, `buyer/resale/list` + `cancel`,
`tickets/[id]/memory`, `buyer/cross-passes/[id]/wallet/apple`, `mobile/payment-intent`, `b2b/verify`, `checkout` (B2B kredit),
`qes_signing_requests` (migrace 489).

## Krok 3b — politiky s podmínkou `true`

| Tabulka | Politika | Příkaz | Podmínka | Rozhodnutí |
|---|---|---|---|---|
| `audit.audit_log` | append_audit_log | INSERT | WITH CHECK true | ponecháno — append-only audit |
| `catalog.cinema_screens` | read_cinema_screens | SELECT | true | ponecháno — veřejné údaje sálu |
| `catalog.event_travel_packages` | event_travel_packages_select | SELECT | true | 491: jen publikované akce + vlastník |
| `catalog.seat_view_photos` | svp_select_all | SELECT | true | ponecháno — veřejné fotky výhledu |
| `catalog.seats` | read_seats | SELECT | true | ponecháno — fyzický plánek sálu |
| `catalog.superfan_experiences` | superfan_exp_public_read | SELECT | true | 491: jen publikované akce + vlastník |
| `catalog.travel_hotel_rooms` | travel_hotel_rooms_select | SELECT | true | ponecháno — veřejný katalog pokojů |
| `catalog.travel_hotels` | travel_hotels_select | SELECT | true | ponecháno — veřejný katalog hotelů |
| `catalog.venue_seating_charts` | read_venue_seating_charts | SELECT | true | ponecháno — plánek sálu |
| `marketing.ticket_alerts` | ticket_alerts_insert | INSERT | WITH CHECK true | 491: servis/admin |
| `marketing.ticket_alerts` | ticket_alerts_update | UPDATE | true | 491: servis/admin |
| `orders.postal_deliveries` | postal_deliveries_insert | INSERT | WITH CHECK true | 491: servis/admin |
| `orders.seat_upgrades` | seat_upgrades_insert | INSERT | WITH CHECK true | 491: servis/admin |
| `orders.seat_upgrades` | seat_upgrades_update | UPDATE | true | 491: servis/admin |
| `orders.ticket_transfers` | ticket_transfers_update | UPDATE | true | 491: servis/admin/odesílatel/příjemce |
| `orders.travel_bookings` | travel_bookings_insert | INSERT | WITH CHECK true | 491: servis/admin |
| `platform.carbon_offset_settings` | carbon_offset_settings_public_select | SELECT | true | ponecháno — globální nastavení |
| `platform.postal_fees` | postal_fees_select | SELECT | true | ponecháno — ceník |
| `platform.promoters` | p_promoters_read | SELECT | true | 491: jen aktivní + vlastní/člen |
