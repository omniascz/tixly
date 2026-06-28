-- Migration 394: Party Pay (skupinová platba) + Live Sales Dashboard
-- Unique differentiators with no equivalent in TM / Eventbrite / EVENTIM.

-- ─── Party Pay — skupinová platba ────────────────────────────────────────────
-- Organizer reserves N tickets; friends pay their own slot via share link.
-- Each slot becomes an independent order only after payment completes.

CREATE TABLE IF NOT EXISTS orders.party_split_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_id           UUID NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  ticket_type_id     UUID NOT NULL REFERENCES catalog.ticket_types(id),
  organizer_user_id  UUID REFERENCES identity.users(id) ON DELETE SET NULL,
  organizer_email    TEXT NOT NULL,
  organizer_name     TEXT,
  total_slots        SMALLINT NOT NULL CHECK (total_slots BETWEEN 2 AND 20),
  per_slot_amount    INTEGER NOT NULL,    -- halíře per person
  currency           TEXT NOT NULL DEFAULT 'CZK',
  share_token        TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(18), 'base64url'),
  status             TEXT NOT NULL DEFAULT 'open',  -- open | complete | expired | cancelled
  expires_at         TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '48 hours',
  completed_at       TIMESTAMPTZ,
  -- Organizer's own slot — they pay immediately or via same flow
  organizer_order_id UUID REFERENCES orders.orders(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS party_split_token_idx  ON orders.party_split_sessions (share_token);
CREATE INDEX IF NOT EXISTS party_split_event_idx  ON orders.party_split_sessions (event_id);

CREATE TABLE IF NOT EXISTS orders.party_split_slots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL REFERENCES orders.party_split_sessions(id) ON DELETE CASCADE,
  slot_index   SMALLINT NOT NULL,          -- 0 = organizer, 1..N = friends
  payer_email  TEXT,
  payer_name   TEXT,
  order_id     UUID REFERENCES orders.orders(id) ON DELETE SET NULL,
  reserved_at  TIMESTAMPTZ,               -- when payer claimed this slot
  paid_at      TIMESTAMPTZ,
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending | reserved | paid | expired
  UNIQUE (session_id, slot_index)
);

ALTER TABLE orders.party_split_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders.party_split_slots    ENABLE ROW LEVEL SECURITY;

CREATE POLICY party_split_sessions_owner ON orders.party_split_sessions
  FOR ALL TO authenticated
  USING (organizer_user_id = auth.uid());

CREATE POLICY party_split_sessions_public_read ON orders.party_split_sessions
  FOR SELECT TO authenticated
  USING (status = 'open');  -- members read via share_token (service ctx)

CREATE POLICY party_split_slots_session ON orders.party_split_slots
  FOR SELECT TO authenticated
  USING (
    session_id IN (
      SELECT id FROM orders.party_split_sessions WHERE organizer_user_id = auth.uid()
    )
  );

-- ─── Live Dashboard — prodejní statistiky ────────────────────────────────────
-- Materializovaná hourly snapshots pro trend grafy (bez full table scan na každý request)

CREATE TABLE IF NOT EXISTS analytics.event_sales_snapshots (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  captured_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_id       UUID NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  tickets_sold   INTEGER NOT NULL DEFAULT 0,
  revenue_total  BIGINT NOT NULL DEFAULT 0,   -- halíře
  unique_buyers  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (event_id, date_trunc('hour', captured_at))
);

CREATE INDEX IF NOT EXISTS event_sales_snap_event_idx
  ON analytics.event_sales_snapshots (event_id, captured_at DESC);

-- ─── Audience geographic distribution ────────────────────────────────────────
-- Postal code → count stored per event; populated from orders.orders.billing_postal_code
-- or from user profile. Updated by cron or checkout trigger.

ALTER TABLE orders.orders
  ADD COLUMN IF NOT EXISTS billing_postal_code TEXT,
  ADD COLUMN IF NOT EXISTS billing_country_code TEXT;  -- ISO 3166-1 alpha-2

-- Aggregated geo cache (rebuilt nightly by cron)
CREATE TABLE IF NOT EXISTS analytics.audience_geo (
  event_id      UUID NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  country_code  TEXT NOT NULL,
  postal_code   TEXT NOT NULL,
  buyer_count   INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, country_code, postal_code)
);

CREATE INDEX IF NOT EXISTS audience_geo_event_idx ON analytics.audience_geo (event_id);
