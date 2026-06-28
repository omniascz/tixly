-- Migration 393: Publish API + White-label tenants
-- Publish API: external ticketing systems push events INTO Tixly distribution network
-- White-label: other ticketing companies use Tixly as a backend (open ticketing service)

-- ─── Publish API — external event sources ────────────────────────────────────

ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS source_system      TEXT,   -- NULL = tixly-native; 'external' = via Publish API
  ADD COLUMN IF NOT EXISTS source_event_id   TEXT,   -- ID in the source system
  ADD COLUMN IF NOT EXISTS source_callback_url TEXT;  -- webhook URL to notify source of sold tickets

-- Enforce uniqueness: one external ID per source system
CREATE UNIQUE INDEX IF NOT EXISTS events_source_idx
  ON catalog.events (source_system, source_event_id)
  WHERE source_system IS NOT NULL;

-- Extend B2B api_keys with publish scope support (scope column is TEXT[] already)
-- New scope values: 'publish:write', 'publish:read'
-- No schema change needed — just new scope values in existing column.

-- Track sold notifications sent back to source systems
CREATE TABLE IF NOT EXISTS platform.publish_sold_notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_id        UUID NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  order_id        UUID NOT NULL,
  source_system   TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  callback_url    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | sent | failed
  sent_at         TIMESTAMPTZ,
  attempt_count   SMALLINT NOT NULL DEFAULT 0,
  last_error      TEXT,
  payload         JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS publish_sold_notif_status_idx
  ON platform.publish_sold_notifications (status, created_at)
  WHERE status IN ('pending', 'failed');

-- ─── White-label tenants ─────────────────────────────────────────────────────
-- Another ticketing company that uses Tixly as their backend infrastructure.
-- They bring their own brand; Tixly provides payment, scanning, ticket generation.

CREATE TABLE IF NOT EXISTS platform.whitelabel_tenants (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  name                 TEXT NOT NULL,
  slug                 TEXT NOT NULL UNIQUE,     -- URL-safe identifier
  domain               TEXT UNIQUE,              -- custom domain for CORS allowlist
  api_key_hash         TEXT NOT NULL UNIQUE,     -- SHA-256 of raw WL key
  key_prefix           TEXT NOT NULL,            -- first 12 chars displayed in UI
  brand_color          TEXT DEFAULT '#1a1a2e',   -- primary hex color
  logo_url             TEXT,
  support_email        TEXT,
  support_url          TEXT,
  callback_url         TEXT,                     -- webhook for order state changes
  allowed_promoter_ids UUID[] DEFAULT ARRAY[]::UUID[],  -- empty = ALL promoters visible
  service_fee_bps      INTEGER DEFAULT 0,        -- extra fee on top of platform fee (basis points)
  is_active            BOOLEAN NOT NULL DEFAULT TRUE
);

-- RLS: only platform admin can manage tenants
ALTER TABLE platform.whitelabel_tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY wl_tenants_admin ON platform.whitelabel_tenants
  FOR ALL TO authenticated
  USING ((SELECT is_platform_admin FROM identity.users WHERE id = auth.uid()));
