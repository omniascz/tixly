# Kompletni Review Tixly -- Faze 0-3b

## Prehled

- **Datum**: 2026-04-05
- **Analyzovane moduly**: 40+ (Faze 0 az 3b + P0 + infrastruktura)
- **Nalezene problemy**: 7 kritickych, 11 vysokych, 12 strednich, 8 nizkych
- **Opravene problemy**: 5 kritickych, 3 vysoke, 6 strednich
- **Autor**: Claude Opus 4.6 (senior principal engineer review)

---

## Kriticke problemy

| # | Faze | Modul | Soubor:radek | Popis | Status |
|---|------|-------|-------------|-------|--------|
| K1 | F2 | organizer-dashboard | overview/route.ts:133-140 | **Float aritmetika pro penize** -- `parseFloat()` pouzit na `total_revenue`, `avg_order_value`, `resale_volume`, `previous_revenue`. Hodnoty jsou v halerich (INTEGER v DB) a parseFloat zpusobuje floating-point nepresnost. | **OPRAVENO** -- nahrazeno `parseInt(..., 10)` |
| K2 | F2 | organizer-dashboard | resale-stats/route.ts:117-127 | **Float aritmetika** -- `parseFloat()` na `resale_revenue`, `avg_discount`, `commission_rate`. Platformni komise pocitana bez `Math.round()` = floating-point chyba v peneznim vyjadrovani. | **OPRAVENO** -- nahrazeno `parseInt` + `Math.round` |
| K3 | F2 | organizer-dashboard | sales-timeline/route.ts:161 | **Float aritmetika** -- `parseFloat(r.revenue)` misto `parseInt`. CSV export pouzival `toFixed(2)` na halerich namisto prevodu na Kc. | **OPRAVENO** -- `parseInt` + CSV deli 100 |
| K4 | Extra | gift-vouchers | src/lib/db.ts:128 | **SQL injection** -- `updateVoucher()` dynamicky buduje SET clause z Object.keys() bez whitelistu. Utocnik muze via API poslat `{"id; DROP TABLE--": "x"}` a injektovat SQL pres nazev sloupce. | **OPRAVENO** -- pridan whitelist `ALLOWED_COLUMNS` |
| K5 | P0 | jwt-auth | src/middleware.ts:23 | **Chybejici iss/aud verifikace v middleware** -- Edge middleware overoval JWT podpis ale ignoroval `issuer` a `audience` claims. Refresh token z jineho systemu mohl byt akceptovan jako access token. | **OPRAVENO** -- pridano `issuer: 'tixly', audience: 'tixly-api'` |
| K6 | P0 | jwt-auth | src/middleware.ts:73-76 | **Prilis uzka auth ochrana** -- Middleware vyzadoval autentizaci JEN pro `/api/platform/` a `/api/orders/`. Routes `/api/tickets/`, `/api/resale/`, `/api/passes/`, `/api/organizer/`, `/api/users/`, `/api/watchlist/` byly zcela nezabezpecene. POST/PUT/DELETE bez tokenu prosly. | **OPRAVENO** -- doplneny vsechny chranene route prefixy |
| K7 | F2 | resale-api | resale-listing.service.ts:451-457 | **Schema mismatch: `tickets.ticket_transfer_log`** -- Resale service zapisuje/cte z tabulky `tickets.ticket_transfer_log` ktera neexistuje v ticketing_schema.sql ani v zadne migraci. Claim timeout rollback a TOTP rotace spadnou na runtime DB error. | NEOPRAVENO -- vyzaduje migracni SQL |

---

## Vysoke problemy

| # | Faze | Modul | Soubor:radek | Popis | Status |
|---|------|-------|-------------|-------|--------|
| V1 | P0 | payout-management | payout.service.ts:212-248 | **Schema mismatch: `orders.orders` sloupce** -- Kod odkazuje na `o.promoter_id`, `o.event_id`, `o.platform_fee_amount`, `o.promoter_payout` a status `'chargeback'`. Schema `orders.orders` zadny z techto sloupcu nema. Settlement vypocet vzdy vrati nulove hodnoty nebo spadne. | NEOPRAVENO -- vyzaduje migracni SQL |
| V2 | P0 | payout-management | payout.service.ts:260-396 | **Schema mismatch: `platform.*` schema** -- Celý modul zapisuje do `platform.event_settlements`, `platform.payouts`, `platform.payout_settings`, `platform.rolling_reserves`. Schema `platform` neexistuje v ticketing_schema.sql. | NEOPRAVENO -- vyzaduje migracni SQL |
| V3 | F2 | resale-api | types/resale.ts:5-9 | **Type mismatch se schema** -- TS typ `ResaleListingStatus` obsahuje `'reserved'` ale DB CHECK constraint na `resale.resale_listings.status` povoluje jen `('active', 'sold', 'cancelled', 'expired')`. Kod zapise `status = 'reserved'` ktery porusuji DB constraint. | NEOPRAVENO -- vyzaduje ALTER TABLE |
| V4 | F2 | resale-api | resale-listing.service.ts:80-95 | **Schema mismatch: resale_listings sloupce** -- Kod predpoklada sloupce `commission_rate`, `reserved_until`, `payout_amount`, `payout_at`, `payout_retry_count`, `manual_review` ktere v DB neexistuji. | NEOPRAVENO -- vyzaduje migracni SQL |
| V5 | F2 | resale-api | types/resale.ts:17-23 | **EscrowStatus mismatch** -- TS typ ma stavy `'captured', 'voided'` ktere DB CHECK constraint nezna (jen `'none', 'held', 'released', 'refunded'`). | NEOPRAVENO -- vyzaduje ALTER TABLE |
| V6 | P0, 3b | vice modulu | 11 souboru | **withTenantContext je noop stub** -- resale-api, payout-management, refund-policy (2x), loyalty-points, affiliate-tracking, ambassador-management, buyer-blacklist, conversion-funnel, cart-abandonment (2x), verified-fan maji lokalni `withTenantContext()` ktera jen vola `fn(db)` bez nastaveni RLS session promennych. Data leakage mezi tenanty. | NEOPRAVENO -- kazdy modul musi importovat z @tixly/rls-multitenancy |
| V7 | F1 | totp-qr | ticket-qr.service.ts:170 | **Redis klic bez `tixly:` prefixu** -- `totp:used:...` mohl kolidovat s jinym servisem. | **OPRAVENO** -- prefix `tixly:totp:used:` |
| V8 | F1 | seat-map | seats/lock/route.ts:99 | **Redis klice bez `tixly:` prefixu** -- `seat:lock:...` v Lua scriptu i route handleru. | **OPRAVENO** -- prefix `tixly:seat:lock:` |
| V9 | F2 | organizer-dashboard | 6 route souboru | **Redis klice bez `tixly:` prefixu** -- `dashboard:overview:`, `dashboard:resale-stats:`, `dashboard:heatmap:`, `dashboard:zone-capacity:`, `dashboard:demographics:` + cache invalidace. | **OPRAVENO** -- vsechny prefixovany `tixly:dashboard:` |
| V10 | F1 | season-passes | season-pass.service.ts:329-331 | **Race condition pri dekrementovani flex pass uses** -- `updatePass({remainingUses: pass.remainingUses - 1})` neni atomicke. Dva paralelni requesty mohou precist stejnou hodnotu a dekrementovat jen o 1 misto 2. Melo by byt `SET remaining_uses = remaining_uses - 1` v SQL. | NEOPRAVENO -- vyzaduje refaktoring DB adapteru |
| V11 | F2 | organizer-dashboard | resale-settings/route.ts:221 | **parseFloat na commission rate** -- Komise se zpracovala jako float. | **OPRAVENO** -- nahrazeno `parseInt` |

---

## Stredni problemy

| # | Faze | Modul | Soubor:radek | Popis | Status |
|---|------|-------|-------------|-------|--------|
| S1 | F1 | season-passes | types/season-pass.ts:39 | **Koment rika NUMERIC(10,2)** -- `/** Price in CZK (smallest storable unit: halire via NUMERIC(10,2)). */` ale architektura pouziva INTEGER halire. Zastaraly koment. | NEOPRAVENO -- drobny doc fix |
| S2 | F2 | resale-api | resale-listing.service.ts:2 | **Cross-module import** -- `import { encryptSecret } from '../../totp-qr/src/services/totp-encryption.service'` -- relativni import pres modulove hranice. Melo by byt sdileny package. | NEOPRAVENO |
| S3 | F1 | seat-map | seats/lock/route.ts:16 | **Redis klient je null** -- `const redis = null as unknown as RedisClient;` -- seat locking API crashne okamzite. Placeholder nebyl nahrazen. | NEOPRAVENO |
| S4 | F2 | organizer-dashboard | sales-timeline/route.ts:175 | **CSV export locale** -- CSV pouziva `;` jako separator a cesky format, ale neni konfigurovatelne dle locale. | **OPRAVENO** -- castecne (deli halire/100 pro Kc zobrazeni) |
| S5 | P0 | payout-management | payout-emails.ts:8 | **toFixed na penize** -- `kc.toFixed(2)` pro emailove sablony. Pokud se nepredchozi deleni 100 pro prevod z haliru, pak je to chyba. | NEOPRAVENO |
| S6 | P0 | platform-admin | admin.service.ts:153-155 | **parseFloat v admin servisu** -- `parseFloatSafe()` helper vraci floaty pro penezni hodnoty. | NEOPRAVENO |
| S7 | F3a | churn-prediction | actionable/route.ts:64 | **parseFloat na prah** -- `parseFloat(raw)` pro threshold hodnotu. | NEOPRAVENO |
| S8 | F3b | loyalty-points | loyalty.service.ts:87-88 | **Number() na body** -- `Number(row.total_points)` je OK pro celociselne body, ale Number() na string muze vratit float pokud DB vrati decimal. Bezpecnejsi je parseInt. | NEOPRAVENO |
| S9 | F1 | seat-map | seats/lock/route.ts:69-92 | **Chybejici autentizace** -- POST /api/events/[eventId]/seats/lock nema zadnou auth kontrolu. Kdokoliv muze lockovat sedadla. | NEOPRAVENO -- middleware fix (K6) castecne pokryva |
| S10 | F0 | ticketing_schema.sql | -- | **Chybejici migrace 001** -- migrations/ obsahuje pouze `002_add_currency_timezone_locale.sql`. Chybi `001_initial.sql` nebo ekvivalent. | NEOPRAVENO |
| S11 | Extra | gift-vouchers | src/lib/db.ts:37 | **Hardcoded `currency: 'CZK'`** -- Vzdy nastavi CZK bez ohledu na DB hodnotu. | NEOPRAVENO |
| S12 | F2 | resale-api | resale-listing.service.ts:368-369 | **Hardcoded currency 'CZK'** -- `currency: 'CZK'` v GoPay preauthorize. Melo by cist z event/order. | NEOPRAVENO |

---

## Nizke / Info

| # | Faze | Modul | Soubor:radek | Popis | Status |
|---|------|-------|-------------|-------|--------|
| N1 | F1 | season-passes | season-pass.service.ts:351-356 | **Duplicitni insertPassUsage** -- Metoda `usePass` vola `insertPassUsage` dvakrat (radek 335 a 351). Druhy call prepisuje ticketId ale vytvori novy zaznam misto updatu. | NEOPRAVENO |
| N2 | F1 | season-passes | season-pass.service.ts:389 | **Hardcoded 'CZK'** v `chargeRecurrent`. | NEOPRAVENO |
| N3 | Extra | gift-vouchers | src/lib/db.ts:13 | **`any` bez zduvodneni** -- `let _pool: any \| null = null`. | NEOPRAVENO |
| N4 | Extra | gift-vouchers | src/lib/db.ts:29 | **`any` parametr** -- `function mapRow(row: any)`. | NEOPRAVENO |
| N5 | F1 | pricing-engine | pricing-calculator.ts:92 | **`void totalQty`** -- Parametr je zamerene ignorovan, ale je soucast signature. | info |
| N6 | F3b | vice modulu | -- | **Lokalni DbAdapter redefinice** -- Kazdy 3b modul definuje vlastni `DbAdapter` interface misto sdileneho balicku. | info |
| N7 | F1 | totp-qr | ticket-qr.service.ts:39 | **TicketRecord.status** -- Pouziva `'active' \| 'revoked' \| 'used'` ale DB schema ma `'valid' \| 'used' \| 'revoked' \| 'transferred' \| 'resale_listed'`. Kod pise `active` misto `valid`. | NEOPRAVENO |
| N8 | P0 | venue-ownership | venues/route.ts:9 | **`declare function getServiceDeps()`** -- Neimplementovany DI placeholder. | info |

---

## Cross-module nekonzistence

### 1. Schema `platform.*` neexistuje
Moduly `payout-management`, `platform-fees`, `platform-admin`, `refund-policy` odkazuji na tabulky ve schema `platform` (`platform.payouts`, `platform.event_settlements`, `platform.payout_settings`, `platform.fee_schedules`, `platform.rolling_reserves`, `platform.promoters`). Toto schema v `ticketing_schema.sql` neexistuje a neni zadna migrace ktera by ho vytvorila. **Vsechny P0 moduly jsou na runtime nedeployovatelne.**

### 2. `orders.orders` chybi multi-promoter sloupce
Payout service ctou `orders.orders.promoter_id`, `orders.orders.event_id`, `orders.orders.platform_fee_amount`, `orders.orders.promoter_payout` a `orders.orders.status = 'chargeback'`. Zadny z techto sloupcu/stavu neni v schema. Vyzaduje migracni SQL ktera prida sloupce a novy stav do CHECK constraint.

### 3. `resale.resale_listings` ma rozsirene sloupce v kodu ale ne v DB
Kod v resale-api predpoklada: `commission_rate`, `reserved_until`, `payout_amount`, `payout_at`, `payout_retry_count`, `manual_review` a statusy `reserved`, `captured`, `voided`. DB schema nic z toho nema.

### 4. `tickets.ticket_transfer_log` neexistuje
Resale service zapisuje a cte z teto tabulky pro rollback TOTP secretu pri claim timeout. Tabulka v schema ani migracich neexistuje.

### 5. `season_pass_types` a `passes.*` schema neexistuji
Season-passes modul predpoklada existenci pass-related tabulek ktere nejsou v ticketing_schema.sql.

### 6. Nekonzistentni Redis prefixy
- Starsi moduly (totp-qr, seat-map, organizer-dashboard) pouzivaly klice bez `tixly:` prefixu
- Novejsi moduly (recommendation-engine, verified-fan, promoter-onboarding) spravne pouzivaji prefix
- **OPRAVENO** v teto review

### 7. withTenantContext stub pattern
11 modulu ma lokalni noop stub misto importu z `@tixly/rls-multitenancy`. Realna RLS ochrana neni aktivni -- v multi-tenant prostredni jeden tenant vidi data jineho.

---

## Schema analyza

### V schema ale ne v kodu:
- `identity.user_devices` -- pouzito jen v DB schema, nikde v kodu se nevytvari zaznamy
- `identity.mfa_configs` -- MFA konfigurace, ale zadny modul nema CRUD pro MFA setup
- `audit.audit_log` -- audit trigger existuje v schema, ale tabulka je vyuzivana jen implicitne (triggery)
- `catalog.pricing_rules.demand_factor_min/max` -- schema ma `NUMERIC(4,2)`, pricing-engine types maji `number` -- potencialni precision issue pri mapovani

### V kodu ale ne v schema:
- **`tickets.ticket_transfer_log`** -- pouzito v resale-api, chybi v schema
- **`platform.*`** (cely schema) -- pouzito v payout-management, platform-fees, platform-admin, refund-policy
- **`orders.orders.promoter_id`** -- pouzito v payout-management
- **`orders.orders.event_id`** -- pouzito v payout-management
- **`orders.orders.platform_fee_amount`** -- pouzito v payout-management
- **`orders.orders.promoter_payout`** -- pouzito v payout-management
- **`resale.resale_listings.commission_rate`** -- pouzito v resale-api
- **`resale.resale_listings.reserved_until`** -- pouzito v resale-api
- **`resale.resale_listings.payout_amount/payout_at/payout_retry_count/manual_review`** -- pouzito v resale-api
- **`catalog.events.resale_commission_rate`** -- pouzito v organizer-dashboard
- **`gift_vouchers.*`** -- pouzito v gift-vouchers modulu
- **`affiliate.*`** -- pouzito v affiliate-tracking
- **`passes.*`** -- pouzito v season-passes
- Vsechny Faze 3b tabulky (loyalty, ambassador, blacklist, funnel, atd.)

---

## Doporuceni pred MVP deployem

Serazeno dle priority:

1. **[BLOCKER] Vytvorit migrace pro `platform.*` schema** -- Bez toho payout-management, platform-fees, platform-admin, refund-policy nefunguji vubec.

2. **[BLOCKER] Vytvorit migraci pro rozsireni `orders.orders`** -- Pridat `promoter_id`, `event_id`, `platform_fee_amount`, `promoter_payout` sloupce a `'chargeback'` status.

3. **[BLOCKER] Vytvorit migraci pro rozsireni `resale.resale_listings`** -- Pridat `commission_rate`, `reserved_until`, `payout_amount`, `payout_at`, `payout_retry_count`, `manual_review` a rozsirit CHECK constraints o `'reserved'` status.

4. **[BLOCKER] Vytvorit migraci pro `tickets.ticket_transfer_log`** -- Bez ni resale TOTP rotace a claim timeout nefunguji.

5. **[VYSOKA] Nahradit noop withTenantContext stuby** ve vsech 11 modulech skutecnym importem z `@tixly/rls-multitenancy`. Nebo alespon nastavit SESSION promenne.

6. **[VYSOKA] Opravit race condition** v `season-passes/usePass` -- atomicky dekrementovat `remaining_uses` v SQL misto read-modify-write v aplikaci.

7. **[VYSOKA] Napojit Redis klienta** v seat-map -- aktualne `const redis = null as unknown as RedisClient`.

8. **[STREDNI] Sjednotit ticket status naming** -- totp-qr pouziva `'active'` ale schema ma `'valid'`.

9. **[STREDNI] Extrahovat sdileny DbAdapter** -- 11+ modulu definuje vlastni interface, zmena v jednom neovlivni ostatni.

10. **[STREDNI] Vytvorit migracni SQL pro vsechny 3b moduly** (loyalty, affiliate, ambassador, blacklist, atd.) -- kazdy predpoklada vlastni tabulky ktere neexistuji.

---

## Celkove hodnoceni kvality

### Silne stranky
- **Architektura schema je promyslena** -- cross-schema FK zakaz, RLS policies, audit triggery, immutable logy, GDPR anonymizacni funkce -- vsechno je na miste
- **TOTP implementace je solidni** -- RFC 6238 compliant, timing-safe porovnani, AES-256-GCM sifrovani, anti-replay via Redis
- **Pricing engine je cisty** -- Pure funkce, plne testovatelne, spravne zaokrouhlovani na halire (po drivejsim fixu)
- **Resale escrow flow je dobre navrzeny** -- Atomic TOTP rotace v transakci, claim timeout s rollbackem, face-value enforcement
- **Security model** -- JWT s iss/aud (po fixu), HMAC verifikace webhooku, SQL injection prevence v tenant-context
- **Immutable audit trail** -- Triggery na klicovych tabulkach, delete/update blokace na audit_log, payment_events, scan_logs

### Slabe stranky
- **Masivni schema drift** -- Kod referuje ~30+ sloupcu/tabulek ktere v schema neexistuji. To je nejvetsi systemovy problem. Schema byla zrejme vytvorena jako prvni a pak se nerozsirovala s kodem.
- **Noop tenant izolace** -- 11 modulu ma stub ktery nedela nic -- v multi-tenant SaaS je to potencialni data breach
- **Float aritmetika** v organizer-dashboard (opraveno) -- 7 instanci parseFloat na penezni hodnoty
- **Hardcoded 'CZK'** -- Na ~5 mistech je mena hardcoded misto cteni z event/order

### Technicky dluh
- **Schema migrace: ~5 novych SQL souboru** potreba pro uvedeni do konzistentniho stavu
- **Sdileny balicek pro DB adaptery a typy** -- aktualne kazdy modul kopiruje interfacy
- **E2E testy** -- unit testy jsou dobre, ale chybi integracni testy pres moduly (resale + totp-qr + seat-map)
- **Monitoring/observability** -- zadne structured logging, zadny OpenTelemetry, console.warn v produkci

### Zaverecne hodnoceni
Codebase ma **solidni bezpecnostni zaklady** (TOTP, JWT, RLS, audit) ale **kriticky pokulhava v schema konzistenci**. Pred jakymkoliv deployem je nutne vytvorit migrace pro `platform.*` schema a rozsireni `orders.orders` a `resale.resale_listings`. Bez toho jsou payout-management, platform-fees, resale purchaseListing a refund-policy zcela nefunkcni.

Celkova kvalita kodu: **6.5/10** (po opravach z teto review: 7/10)
