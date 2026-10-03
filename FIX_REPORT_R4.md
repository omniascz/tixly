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
| upgrade-options 500 (R3 bod 4) | dotazy na neexistující `seat_maps`, `seat_map_entries`, `seat_assignments`, `price_halire` | skutečné schéma: event_seats, base_price; jen dražší veřejné typy s kapacitou + volná sedadla | fix-r4-upgrade-options | 500 → 2/2 | f732a24 |
| bezplatný upgrade nemění kapacitu (R3 bod 4) | změna typu lístku bez úpravy `remaining_qty` | cíl −1, zdroj +1 v systémové části upgradu | fix-r4-free-upgrade-capacity | kapacita beze změny → 1/1 | 34e7711 |
| mobil `GET /api/v1/buyer/orders` (R3 bod 4) | routa neexistovala, appka dostávala 404 | nová routa pod RLS kupce, tvar dle `OrderSummary` | fix-r4-mobile-buyer-orders | 404 → 2/2 | 092c6469 |
| QR tištěné vstupenky prodejce (R3 bod 4) | pseudo-matice z `TXP:<uuid>`; TXP1 pod rotating_24h odmítnut (totp_required) | podepsaný statický TXP2 (vstupenka + akce), skener ověří podpis proti akci z DB a pod static_allowed/rotating_24h nahradí TOTP; skutečný QR; klienti znají TXP2 | fix-r4-printed-qr (+ unit 9/9) | 3 fail → 3/3 | 6a7bdf7d |
| mobile-promoter typecheck (R3 bod 5) | bez node_modules se nedal ověřit | závislosti nainstalovány (lockfile beze změny), `tsc --noEmit` | — | 0 chyb (vč. změn kol 3–4) | db6e8542 |

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

## Krok 4 — CI a provoz (workflow + skripty; `act` není k dispozici → actionlint 1.7.12 + shellcheck, kroky spuštěny lokálně ekvivalentně)
| Workflow | Před | Po | Ověření | Commit |
|---|---|---|---|---|
| `ci.yml` | nikdy neběžel (spouštěč main/develop, výchozí větev master); matice 30 neexistujících adresářů; migrace s `\|\| true` | push/PR main, master, fix/** → install, typecheck, lint (baseline), unit, live proti DB z migrací (PgBouncer transaction, Mailpit, Redis, fake-gopay) pod tixly_app | tsc bez .next/types 0; unit 54/54 (517); live proti čisté DB ze skriptu 57 ✓ / 19 skip (Neon) / 0 ✗; actionlint 0 | 4fb049ed |
| lint | `npm run lint` 1049 chyb → nemohl nic hlídat | `scripts/lint-baseline.mjs` + `eslint-baseline.json` (1041); padá jen na nárůstu; 5 chyb přidaných kolem 4 opraveno | sonda: nový soubor s chybou → exit 1, bez něj → 0 | 525998ac |
| `schema-drift-guard.yml` | 3/3 fail „need NEON_API_KEY“; filtr na neexistující `nextjs-boilerplate/migrations/**`; pathspec vynechával 22 souborů `src/lib/*.ts` | `--url` proti DB z migrací, baseline 48 míst, bez secretu | sonda: dotaz na neexistující sloupec → exit 1, bez ní → 0 | eecb95e3 |
| `rls-gate.yml` | 50× „success“, ale `exit 0` při chybějícím DATABASE_URL (nic nekontroloval); snapshot 631 policies vs 850 z migrací (248 rozdílů) | push/PR: gate pod tixly_app proti DB z migrací; noc/deploy: chybějící secret = exit 1; snapshot přegenerován | DROP POLICY → exit 1; čistá DB → exit 0; starý snapshot → exit 1 (248) | fe4e3d7b |
| `db-backup.yml` | 19/19 fail: `E: Package 'awscli' has no installation candidate` (ubuntu-24.04), pak Slack „Specify secrets.SLACK_WEBHOOK_URL“ | bez apt awscli (CLI v2 předinstalované), psql 17 z PGDG, kontrola secretů jmenovitě, smoke test před uploadem, Slack jen s webhookem | lokálně: prázdné secrets → exit 1 se jmény; dump→AES→restore list OK; špatný klíč → bad decrypt. Neověřeno: S3 upload, PGDG apt na runneru | 6cdce801 |
| `security.yml` (mimo zadání, jen stav) | 19/19 fail: gitleaks „leaks found: 25“; matice audituje neexistující `totp-qr`, `jwt-auth`, `resale-api`, `rls-multitenancy` | beze změny | — | — |
| `deploy.yml` (mimo zadání, jen stav) | 0 běhů: spouštěč main/develop, výchozí větev master | beze změny | — | — |

**Akce vlastníka (Settings → Secrets and variables → Actions → Repository secrets):**
- záloha: `DATABASE_URL` (sslmode=require, role s právem číst vše), `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET`, `AWS_REGION`, `BACKUP_ENCRYPTION_KEY`; volitelně `SLACK_WEBHOOK_URL`
- noční RLS gate produkce: `DATABASE_URL` (role **tixly_app**) a `NEON_API_KEY` (project-scoped, jen noční sken); dokud nejsou, noční běh **selže** (záměrně)
- `deploy.yml` se nespustí, dokud se spouštěč neshoduje s výchozí větví `master`

## Závěr — sady po jednom (izolovaná DB z migrací, PgBouncer, fake-gopay, Mailpit, Redis; tixly_app)
| Sada | Výsledek | Log |
|---|---|---|
| typecheck | CI varianta (čistý checkout, bez `.next/types`) exit 0; lokálně 1 předexistující chyba jen v generovaném `.next/types/app/api/rfid/scan` (export `generateRfidDeviceKey` z route souboru; build ji ignoruje `ignoreBuildErrors`) | logs/r4/z_tsc*.txt |
| unit | 54/54 souborů, 517 ✓ / 4 skip | logs/r4/z_unit.txt |
| live | 57 ✓ / 19 skip (soubory jen na Neon klonu, bez lokální dráhy) / 0 ✗; i proti čisté DB ze CI skriptu stejně | logs/r4/z_live.txt, 4_live_ci_check.txt |
| build | exit 0 | logs/r2/build_last.txt |
| audity 01–12 | 01 26/0 · 02 36/0 · 03 23/0 · 04 14/0 · 05 8/0 · 06 21/0 · 07 6/0 · 07b 0 zapsaných řádků v 5 pokusech · 08 2/0 (154 rout × 3 aktéři, 0 úniků, 0× 5xx) · 09 12/0 · 10 7/0 · 11 8/0 · 12 5/0 (PASS/FAIL) | logs/r4/z_audit_*.txt, audit/logs/r2_e2e_*.out |
| HTTP | anonymní `POST /api/oauth/authorize` → 401 (i s parametry / formulářem); `GET /api/v1/buyer/orders` bez identity → 401 | — |
| vizuál | tisk prodejce: 2 skutečné QR, dekódované ZE SCREENSHOTU = TXP2; vložení do skeneru (akce za 1 h, rotating_24h) → „Vstup povolen“, vstupenka `used` | logs/r4/z_visual_*.png |

`tixly/`: `git -C ../tixly status --porcelain | wc -l` = 110. Překryv se soubory měněnými ve větvích fix/*: 4 — `admin/scanner/page.tsx` (round3, round4), `api/internal/order-completed/route.ts` (round3), `api/subscriptions/checkout/route.test.ts` (round2, round3), `middleware.ts` (critical, round2–4). Migrace 479 kolidují (řeší se při slučování).
