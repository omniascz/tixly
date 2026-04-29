# Schema Audit — 2026-04-08

Audited **91 migration files** across `migrations/` (001–091, skipping the README).

---

## Summary

| Issue Type | Count | Severity |
|---|---|---|
| Schema created before it exists (FK ordering) | 1 | HIGH |
| ALTER TABLE on non-existent table | 1 | HIGH |
| Duplicate `CREATE SCHEMA` (idempotent) | Multiple | LOW (IF NOT EXISTS) |
| Duplicate `webhook_endpoints` table name | 1 | MEDIUM |
| Missing FK indexes | 3 | MEDIUM |
| Migration number gap (053–059) | 7 | LOW |
| venues.ticket_types shadows catalog concept | 1 | LOW/INFO |

---

## Issues Found

### ISSUE-1 — HIGH: `platform` schema used before it is created

**Migration 022** (`022_b2b_api_tables.sql`) creates tables in the `platform` schema and has **live FK constraints** to `platform.promoters`:

```sql
-- 022_b2b_api_tables.sql line 16
promoter_id UUID NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE
```

However, `platform` schema and `platform.promoters` table are **only created in migration 048** (`048_platform_schema.sql`).

Same problem affects:
- **029** (`029_white_label.sql`) — `platform.tenant_themes`, `platform.custom_domains`, `platform.email_sender_configs` all reference `platform.promoters(id)` as FK

**Fix:** Either move `048_platform_schema.sql` to run before `022`, or create a minimal `platform.promoters` stub in a new early migration. The fix migration below drops the FK constraints on `platform.api_keys`, `platform.webhook_endpoints`, and `platform.tenant_themes` / `platform.custom_domains` / `platform.email_sender_configs` until ordering is resolved, then re-adds them (assuming 048 runs before 095 fix).

---

### ISSUE-2 — HIGH: `identity.clients` table does not exist

**Migration 062** (`062_identity_clients_source.sql`) runs:

```sql
ALTER TABLE identity.clients
  ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'web';
CREATE INDEX IF NOT EXISTS idx_identity_clients_source ON identity.clients(source);
```

No migration creates `identity.clients`. The table is missing entirely. This migration will fail at runtime.

**Fix:** Either create `identity.clients` before 062, or drop migration 062 if `identity.clients` was removed from the schema.

---

### ISSUE-3 — MEDIUM: Duplicate `webhook_endpoints` table across schemas

Two different tables named `webhook_endpoints` exist in different schemas:

| Migration | Schema | Table | Purpose |
|---|---|---|---|
| 022 | `platform` | `platform.webhook_endpoints` | B2B API webhooks |
| 042 | `reservations` | `reservations.webhook_endpoints` | Reservations module webhooks |

These are distinct and **do not conflict** at the DB level (different schemas), but the FK in 042 (`endpoint_id REFERENCES reservations.webhook_endpoints`) and the FK in 022 (`endpoint_id REFERENCES platform.webhook_endpoints`) must never be confused in application code. The naming is ambiguous.

**Recommendation:** Rename to `platform.b2b_webhook_endpoints` and `reservations.reservation_webhook_endpoints` for clarity. No SQL fix needed if teams are aware.

---

### ISSUE-4 — MEDIUM: Missing FK index — `sport.priority_windows.league_id`

`sport.priority_windows` has a FK-style column `league_id UUID NOT NULL` but there is **no index on `league_id`**. The only index is:

```sql
CREATE INDEX idx_sport_priority_windows_event ON sport.priority_windows (event_id, priority_level);
```

Queries filtering by `league_id` (e.g., to find all priority windows for a league) will do full scans.

---

### ISSUE-5 — MEDIUM: Missing FK index — `sport.multi_game_packages.league_id`

`sport.multi_game_packages` has `league_id UUID NOT NULL` with index only on `(league_id, status)`. Missing standalone `league_id` is covered by the composite. **OK** — composite index can serve range scans. No fix needed.

---

### ISSUE-6 — MEDIUM: Missing FK index — `reservations.bookings.order_id`

`reservations.bookings` has an `order_id UUID` column (cross-schema soft reference, no FK constraint) with **no index**. Lookups by `order_id` to find a booking for an order will be sequential scans.

---

### ISSUE-7 — LOW: Migration number gap 053–059

Migrations jump from `052` to `060`. Seven numbers are missing. This is not a functional error but may indicate:
- Deleted/rolled-back migrations that left gaps
- Reserved numbers for a future batch

**Recommendation:** Document in the README which numbers were skipped and why.

---

### ISSUE-8 — INFO: `venues.ticket_types` (migration 046) vs `catalog.ticket_types` (migration 001)

Migration 046 creates a table `venues.ticket_types` for timed-entry venues (museum/gallery day tickets). This table is **in a different schema** from `catalog.ticket_types` (event ticketing). They serve different purposes, but the identical name can confuse developers. No conflict at DB level.

**Recommendation:** Consider renaming `venues.ticket_types` to `venues.entry_ticket_types` for clarity.

---

## Schema Inventory (all schemas)

| Schema | Created in | Tables |
|---|---|---|
| `identity` | 001 | users, user_devices, refresh_tokens, mfa_configs, verified_persons, user_verifications, bankid_auth_sessions, verification_attempts |
| `catalog` | 001 | venues, events, ticket_types, pricing_rules, seats |
| `orders` | 001 | orders, order_items, payment_events, abandoned_carts, cs_notes |
| `tickets` | 001 | tickets, ticket_transfers, scan_logs, access_tokens, access_token_log, stream_token_log, ticket_transfer_log, gift_transfer_log |
| `resale` | 001 | resale_listings, resale_watchlist |
| `audit` | 001 | audit_log |
| `loyalty` | 007 | accounts, transactions |
| `affiliate` | 008 | affiliates, links, clicks, conversions, payouts |
| `ambassador` | 009 | ambassadors, codes, code_usages, payouts |
| `blacklist` | 010 | blacklist_entries, appeals |
| `analytics` | 011 | funnel_events |
| `segmentation` | 012 | segments, export_jobs |
| `marketing` | 013 | re_engagement_campaigns, re_engagement_unsubscribes, promo_codes, promo_code_usages |
| `attribution` | 014 | touch_points, conversions |
| `verified_fan` | 016 | configs, registrations |
| `risk` | 023 | fraud_cases, fraud_reviews, fraud_rules, device_fingerprints, velocity_limits |
| `sport` | 024 | teams, leagues, event_config, season_ticket_holders, multi_game_packages, package_game_selections, priority_windows |
| `platform` | 022/029/048/060/061 | api_keys, api_key_audit_log, webhook_endpoints, webhook_deliveries, tenant_themes, custom_domains, email_sender_configs, promoters, fee_schedules, payout_settings, payouts, event_settlements, rolling_reserves, payout_events, staff_members, staff_roles, staff_permissions, staff_shifts |
| `conference` | 031–033 | conferences, days, tracks, sessions, speakers, session_speakers, multi_day_passes, pass_activations, badge_templates, badge_print_jobs, badge_overrides, floor_maps, booth_categories, booths, exhibitors, booth_assignments, exhibitor_staff, exhibitor_sessions |
| `cinema` | 034–035 | venues, auditoriums, films, screenings, screening_seats, programs, program_screenings, age_restriction_rules, age_verifications, film_releases, screening_tags, widget_configs |
| `reservations` | 036–042 | resources, availability_rules, availability_overrides, slots, bookings, booking_holds, service_categories, services, service_resources, service_addons, service_pricing_rules, service_reviews, packages, package_items, package_purchases, package_usage, package_credit_balances, branches, branch_hours, branch_closures, branch_settings, branch_staff, branch_service_availability, rules, rule_conditions, rule_actions, rule_evaluations, approval_requests, customer_profiles, customer_favorites, booking_receipts, waitlist_entries, customer_notes, webhook_endpoints, webhook_deliveries, webhook_event_log |
| `venues` | 043–047 | escape_venues, escape_rooms, escape_bookings, game_results, leaderboard_entries, sports_clubs, courts, court_bookings, membership_cards, guest_passes, ski_resorts, ski_pass_types, rfid_cards, ski_pass_activations, lift_scans, ski_school_sessions, cultural_venues, venue_zones, ticket_types, entry_slots, entry_bookings, zone_access, wellness_facilities, facility_zones, daily_tickets, wellness_bookings, daily_capacity, locker_reservations |
| `passes` | 049 | season_pass_types, season_passes, pass_usages, pass_tickets |
| `referral` | 090 | links, clicks, conversions, credit_wallet, credit_transactions |

---

## Fix Migration

See `migrations/095_schema_fixes.sql` for SQL fixes for ISSUE-1, ISSUE-2, ISSUE-4, ISSUE-6.
