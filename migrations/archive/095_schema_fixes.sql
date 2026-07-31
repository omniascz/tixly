-- =============================================================================
-- Migration 095: Schema fixes from audit 2026-04-08
-- Fixes: ISSUE-1 (platform schema ordering), ISSUE-2 (identity.clients),
--        ISSUE-4 (missing index sport.priority_windows.league_id),
--        ISSUE-6 (missing index reservations.bookings.order_id)
--
-- PREREQUISITE: Migration 048 (platform_schema) must have run before this.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- ISSUE-2 FIX: Create identity.clients table (referenced by migration 062)
-- Migration 062 adds a `source` column to this table but it was never created.
-- Minimal definition based on context (OAuth/social login clients).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS identity.clients (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  provider     VARCHAR(50) NOT NULL,          -- 'google', 'facebook', 'apple', 'email', etc.
  provider_id  TEXT        NOT NULL,          -- external provider's user ID
  email        TEXT,
  name         TEXT,
  source       VARCHAR(50) NOT NULL DEFAULT 'web',  -- already added by 062 if run after
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_identity_clients_provider UNIQUE (provider, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_identity_clients_user_id
  ON identity.clients(user_id);

CREATE INDEX IF NOT EXISTS idx_identity_clients_source
  ON identity.clients(source);

COMMENT ON TABLE identity.clients IS
  'OAuth/social login client records. One row per (user, provider) pair.';
COMMENT ON COLUMN identity.clients.source IS
  'Client acquisition channel: web, sms, direct, referral, import, api, admin_manual';

-- ---------------------------------------------------------------------------
-- ISSUE-4 FIX: Add missing index on sport.priority_windows.league_id
-- Needed for queries like "give me all priority windows for league X"
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_sport_priority_windows_league
  ON sport.priority_windows (league_id);

-- ---------------------------------------------------------------------------
-- ISSUE-6 FIX: Add missing index on reservations.bookings.order_id
-- Needed for looking up a booking by its linked order
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_reservations_bookings_order_id
  ON reservations.bookings (order_id)
  WHERE order_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- ISSUE-1 NOTE: platform schema ordering
--
-- Migrations 022 and 029 reference platform.promoters (FK) but platform
-- schema/promoters table is only created in 048.
--
-- If migrations run in numeric order and 048 has not run before 022/029,
-- those migrations will fail. The correct fix is to ensure 048 runs first,
-- OR to extract platform.promoters creation into migration 021.5 (or a new
-- 022_platform_bootstrap.sql before 022).
--
-- The statements below are provided as a bootstrap for environments where
-- 048 was not run before 022/029. They are safe to run if 048 already ran
-- (CREATE TABLE IF NOT EXISTS + CREATE SCHEMA IF NOT EXISTS).
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS platform;

CREATE TABLE IF NOT EXISTS platform.promoters (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT        NOT NULL UNIQUE,
  name            TEXT        NOT NULL,
  slug            TEXT        NOT NULL UNIQUE,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'active', 'suspended', 'closed')),
  tier            VARCHAR(20) NOT NULL DEFAULT 'starter'
                    CHECK (tier IN ('starter', 'growth', 'enterprise')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_promoters_email
  ON platform.promoters(email);

COMMENT ON TABLE platform.promoters IS
  'Bootstrap stub — full definition in 048_platform_schema.sql. Safe to run twice.';

COMMIT;
