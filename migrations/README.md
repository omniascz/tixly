# Tixly — Databázové migrace

Pořadí spuštění je důležité. Každá migrace závisí na předchozích.

## Jak spustit

```bash
# Lokální prostředí (Docker Compose)
psql postgresql://tixly:secret@localhost:5432/tixly < ticketing_schema.sql

# Poté per-modul základní schémata (P0)
psql ... < platform-promoters/migrations/001_platform_schema.sql
psql ... < jwt-auth/migrations/001_refresh_tokens.sql
psql ... < rls-multitenancy/migrations/001_rls_policies.sql
psql ... < rls-multitenancy/migrations/002_add_promoter_columns.sql
psql ... < platform-fees/migrations/001_order_fee_columns.sql
psql ... < platform-fees/migrations/002_default_fee_schedule.sql
psql ... < payout-management/migrations/001_payout_extensions.sql
psql ... < platform-admin/migrations/001_admin_tables.sql
psql ... < venue-ownership/migrations/001_venue_ownership.sql
psql ... < promoter-onboarding/migrations/001_onboarding_tables.sql
psql ... < refund-policy/migrations/001_refund_policy.sql

# Hlavní sekvenční migrace
for f in migrations/00*.sql; do psql ... < "$f"; done
```

## Hlavní sekvenční migrace (`migrations/`)

| # | Soubor | Popis | Závislosti |
|---|--------|-------|-----------|
| 002 | `002_add_currency_timezone_locale.sql` | Přidá currency+timezone na events, locale na orders | ticketing_schema.sql |
| 003 | `003_orders_extensions.sql` | `orders.orders.event_id` + status `'chargeback'` | 002, rls-multitenancy/002 |
| 004 | `004_resale_extensions.sql` | `resale.resale_listings`: commission_rate, reserved_until, payout sloupce, status `reserved`, escrow `captured`/`voided` | ticketing_schema.sql |
| 005 | `005_ticket_transfer_log.sql` | `tickets.ticket_transfer_log` — TOTP rollback log pro resale | ticketing_schema.sql |
| 006 | `006_catalog_extensions.sql` | `catalog.events.resale_commission_rate`, `promoter_id`; `catalog.ticket_types.resale_allowed` | ticketing_schema.sql |
| 007 | `007_faze3b_loyalty.sql` | Schema `loyalty`: accounts, transactions | — |
| 008 | `008_faze3b_affiliate.sql` | Schema `affiliate`: affiliates, links, clicks, conversions, payouts | — |
| 009 | `009_faze3b_ambassador.sql` | Schema `ambassador`: ambassadors, codes, code_usages, payouts | — |
| 010 | `010_faze3b_blacklist.sql` | Schema `blacklist`: blacklist_entries, appeals | — |
| 011 | `011_faze3b_analytics.sql` | Schema `analytics`: funnel_events | — |
| 012 | `012_faze3b_segmentation.sql` | Schema `segmentation`: segments, export_jobs | — |
| 013 | `013_faze3b_marketing.sql` | Schema `marketing`: re_engagement_campaigns, re_engagement_unsubscribes | — |
| 014 | `014_faze3b_attribution.sql` | Schema `attribution`: touch_points, conversions | — |
| 015 | `015_faze3b_cart_abandonment.sql` | `orders.abandoned_carts` (rozšíření orders schématu) | ticketing_schema.sql |
| 016 | `016_faze3b_verified_fan.sql` | Schema `verified_fan`: configs, registrations | — |

## Celková schema mapa po aplikaci všech migrací

```
identity.*      — users, user_devices, refresh_tokens, mfa_configs
catalog.*       — venues, events (+promoter_id, +resale_commission_rate),
                  ticket_types (+resale_allowed), pricing_rules, seats
orders.*        — orders (+event_id, +promoter_id, +platform_fee_amount, +chargeback),
                  order_items (+platform_fee_amount), payment_events,
                  abandoned_carts [NEW]
tickets.*       — tickets, ticket_transfers, scan_logs,
                  ticket_transfer_log [NEW]
resale.*        — resale_listings (+commission_rate, +reserved_until, +payout_*,
                  +manual_review, status+reserved, escrow+captured/voided),
                  resale_watchlist
audit.*         — audit_log
platform.*      — promoters, promoter_members, fee_schedules, payouts,
                  payout_settings, rolling_reserves, event_settlements,
                  payout_events, admin_actions, stats_cache, admin_notifications
loyalty.*       — accounts, transactions [NEW]
affiliate.*     — affiliates, links, clicks, conversions, payouts [NEW]
ambassador.*    — ambassadors, codes, code_usages, payouts [NEW]
blacklist.*     — blacklist_entries, appeals [NEW]
analytics.*     — funnel_events [NEW]
segmentation.*  — segments, export_jobs [NEW]
marketing.*     — re_engagement_campaigns, re_engagement_unsubscribes [NEW]
attribution.*   — touch_points, conversions [NEW]
verified_fan.*  — configs, registrations [NEW]
```

## Zbývající tech debt (nie migrace)

- `season-passes`: tabulky v `season-passes/migrations/001_season_passes.sql` — zkontrolovat konzistenci
- `gift-vouchers`: tabulky v `gift_vouchers` schema — bez migrace v `/migrations/`
- `withTenantContext`: 11 modulů má noop stub — nahradit `@tixly/rls-multitenancy` před production deployem

---

## 🚀 POŘADÍ NASAZENÍ — nenasazené migrace (stav 2026-08-04)

Nic z toho **není na produkci**. Pořadí je závazné.

| # | soubor | co dělá | pozn. |
|---|---|---|---|
| 0a | `000_baseline_20260730.sql` | celé schéma (81 schémat, 600 tabulek, 596 policies) | ⚠️ viz `\restrict` níže |
| 0b | `000_baseline_globals.sql` | role `tixly_app`, granty, default privileges | POVINNĚ až po 0a |
| 450 | `450_tickets_dedup_unique.sql` | unique index na lístcích | |
| 451 | `451_orders_payment_provider_pos.sql` | rozšíření CHECK na `payment_provider` | |
| 452 | `452_tracking_events_provider_tiktok.sql` | rozšíření CHECK na `provider` | |
| 453 | `453_users_select_scoped.sql` | `p_users_select` → 3 policies podle vztahu (self / promotér / buyer) | ✅ **ODBLOKOVÁNO** — výkon vyřešen `SECURITY DEFINER` (18,6 s → 62 ms na provozních cestách), FINDINGS §48; správnost §42 |
| 454 | `454_rls_cast_nullif_fix.sql` | 4 policies: přímý cast GUC → `app_current_user_id()` | opravuje 22P02/500, RED→GREEN doloženo, FINDINGS §39 |
| 455 | `455_rls_namedrift_identity.sql` | 20 policies: `app.promoter_id`/`app.user_id` → `app_*()` helpery | jen jména IDENTITY; příznaky oprávnění ZÁMĚRNĚ neřeší, FINDINGS §44 |
| 456 | `456_drop_base64url_defaults.sql` | zrušit `DEFAULT encode(…,'base64url')` na 3 tokenech | nasadit SPOLU s kódem, který token dodává, FINDINGS §62 |
| 458 | `458_party_split_rls_service_branch.sql` | `party_split_*` dostane servisní větev + `WITH CHECK` | RED→GREEN 7/7 pod `tixly_app` vč. izolace, FINDINGS §80 |
| 457 | `457_orders_payment_provider_channels.sql` | CHECK `payment_provider` + `mollie`, `paypal`, `b2b_credit`, `box_office`, `walkin`, `partner_pos` | kanály se ROZLIŠUJÍ (reporting), `mock-*` ZÁMĚRNĚ ne — to je oprava kódu, FINDINGS §67 |
| 460 | `460_ticket_alerts_service_branch.sql` | `ticket_alerts_select` dostane `app_is_service()` | anonymní hlídací pes; tvar `IS NULL` ZAMÍTNUT měřením (otevřel by tabulku všem), FINDINGS §103–104 |
| 461 | `461_mechanical_rls.sql` | RLS + `p_*_scope` na 19 tabulek s přímým tenant sloupcem | GENEROVANÁ (`scripts/gen-461-mechanical-rls.mjs`) — needituj ručně; izolace RED→GREEN na 6 reprezentantech, 0 rozbitých testů, FINDINGS §106 |
| 462 | `462_shared_catalog_and_eudi_rls.sql` | `films`/`sport_teams` (čtení sdílené, zápis vlastní) + `eudi_verifications` servisní | nasadit SPOLU s opravou `admin/films/[id]` a `admin/sport-teams/[id]` — bez ní by aplikace a policy říkaly různé věci, FINDINGS §108 |
| 463 | `463_b2b_service_branch.sql` | b2b trojice dostane `app_is_platform_admin() OR app_is_service()` | ⚠️ nasadit SPOLU s obalením 6 b2b rout — `admin/b2b` používalo holé `requirePlatformAdmin`, které GUC NENASTAVUJE, a migrace by správu účtů zavřela; FINDINGS §111 |
| 464 | `464_b2b_orders_correlate_invoice_orders.sql` | `dunning_log` + `order_reservations` korelují na `b2b_orders.invoice_orders`, ne na `orders.orders` | opravuje mrtvou větev (promotér neviděl vlastní dunning log); RED→GREEN přímým SQL, FINDINGS §124 |
| 465 | `465_artists_event_id_nullable.sql` | `lineups.artists.event_id` NOT NULL → NULLABLE | promotér-level katalog umělců bez akce; RED→GREEN + izolace změřena, policies se to nedotýká, FINDINGS §137 |
| 466 | `466_rolling_reserves_policy.sql` | `platform.rolling_reserves` ma RLS bez policies (tichy deny) → doplnit scope | snapshot PŘEGENEROVÁN včetně 466 i 467 (631 policies), gate prošel; FINDINGS §142 |
| 467 | `467_writable_policies_r30.sql` | 4 tabulky mely policy jen `FOR SELECT` → zápisové větve (R-30) | nasadit SPOLU s obalením `lib/payouts/executor.ts` — bez něj policy neplatí a zápis dál tiše vrací 0; FINDINGS §147 |
| 468 | `468_payouts_status_processing.sql` | `payouts_status_check` + `'processing'` | mezistav `approved → processing → paid`, executor ho píše 3×; enum se tu ROZŠIŘUJE (na rozdíl od D4, kde šlo o popis operace, ne stav); FINDINGS §148 |

### ⚠️ „capacity backfill" — v pořadí NENÍ a nemá být

V deploy-orderu se dlouho vedl „capacity backfill". **Žádná taková migrace
neexistuje a nikdy nevznikla.** Šlo o `capacity_remaining` → `remaining_qty`,
což byl **rename ve WRITE cestě**, ne datový backfill (REMEDIATION §6: „UPDATE
dekrement INVENTÁŘE, třída jako oversell"). V DB je rename **hotový** —
`000_baseline` obsahuje `remaining_qty` (21×) a `capacity_remaining` **ani
jednou**.

🔴 **Nedodělaná je druhá polovina: 5 souborů kódu pořád čte `capacity_remaining`**,
včetně dekrementu inventáře v `checkout/party-split/[token]/route.ts:233`
(`SET capacity_remaining = capacity_remaining - 1`). Ty dotazy dnes padají na
`42703`. Je to práce v kódu, ne migrace — do pořadí nasazení tedy nepatří.

### ⚠️ Baseline nelze pustit přes SQL driver

`000_baseline_20260730.sql` nese 2 psql meta-příkazy (`\restrict` /
`\unrestrict`, ř. 5 a 44985). Přes `node-pg` vrátí `42601` a **neaplikuje se
vůbec**. Runner musí být `psql`, nebo je odfiltrovat —
`nextjs-boilerplate/scripts/baseline-clone.mjs` to dělá.

### 🔒 Ruční krok (Vercel)

Produkční `DATABASE_URL` **musí** používat roli `tixly_app`, ne `neondb_owner`.
`tixly_app` je jediná role s `BYPASSRLS = false`; pod ownerem je všech 596
policies inertních. Heslo se z `pg_roles` vyčíst nedá — generuje se a ukládá
do env: `ALTER ROLE tixly_app WITH PASSWORD '<z env>';`

### 🔴 Blokuje nasazení nezávisle na migracích

`base64url` v `encode()` přibyl až v **PostgreSQL 19** (commit `e1d91718`),
která **zatím nevyšla** → výraz nefunguje na žádné existující verzi.
Tři sloupce ho mají v `DEFAULT` (`marketing.ticket_alerts.token`,
`orders.ticket_transfers.transfer_token`,
`orders.party_split_sessions.share_token`) a aplikace token nedodává.
Viz FINDINGS §35.

---

## 🚦 POŘADÍ NASAZENÍ (závazné)

1. **RLS gate v CI musí existovat a být self-checknutý** — `rls-verify.mjs`
   + `rls-snapshot.json` + `.github/workflows/rls-gate.yml`
2. **Teprve pak** se smí nasazovat stav bez `BUNDLE_340-348_prod.sql`

Důvod: BUNDLE byl dosud jediné, co drift RLS vracelo zpět — pouštěl se
opakovaně a přepisoval, co se rozešlo. Baseline se aplikuje **jednou**, takže
ta samoopravná vlastnost mizí. Odstranit BUNDLE dřív, než gate funguje, by
znamenalo zůstat bez obojího.

**Stav BUNDLE:** už NENÍ v deploy cestě — leží v `migrations/archive/` a
v žádném workflow se nepouští (ověřeno grepem: jediné zmínky jsou
`FINDINGS_SCHEMA_REALITY.md` a poznámka v `db/DEPLOY-RUNBOOK.md:68`, že
340–348 jsou na produkci nasazené z dřívějška). Krok 2 je tedy splněný —
podmínkou zůstává krok 1.

**Po každé migraci, která mění RLS, se musí přegenerovat snapshot:**
```bash
node scripts/rls-verify.mjs --snapshot --url="<klon s baseline+453..455>"
git add nextjs-boilerplate/rls-snapshot.json
```
