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
