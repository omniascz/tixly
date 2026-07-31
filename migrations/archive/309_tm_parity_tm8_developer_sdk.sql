-- 309_tm_parity_tm8_developer_sdk.sql
-- TM Parity Fáze TM8 — finální 5 features (P2):
-- 11. Secure Entry SDK (partner ticket rendering schema)
-- 12. Presence API/SDK (identity SDK)
-- 13. Testing Harness (sandbox)
-- 14. Inventory Status API
-- 15. Demografická data kupujících

BEGIN;

-- ============================================================
-- 11. Secure Entry — partner SDK token issuance
-- ============================================================
-- Když partner (3rd party app) prodal lístek přes Tixly Partner API,
-- náš server vystaví "secure entry token" který klientská app vloží do
-- Secure Entry SDK pro rendering rotujícího barcode na partner UI.
CREATE TABLE IF NOT EXISTS b2b.secure_entry_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES b2b.oauth_clients(id) ON DELETE CASCADE,
  ticket_id       uuid NOT NULL REFERENCES tickets.tickets(id) ON DELETE CASCADE,
  -- Partner account ID — předáno při fulfillment
  partner_account_id text NOT NULL,
  token_hash      text NOT NULL UNIQUE,
  -- TTL — token je krátkodobý, klient si refresh za 5 min
  expires_at      timestamptz NOT NULL DEFAULT (now() + INTERVAL '5 minutes'),
  issued_count    integer NOT NULL DEFAULT 1,
  last_refreshed_at timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_secure_entry_active
  ON b2b.secure_entry_tokens(client_id, expires_at) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_secure_entry_ticket
  ON b2b.secure_entry_tokens(ticket_id);

COMMENT ON TABLE b2b.secure_entry_tokens IS
  'TM Secure Entry SDK parita. Partner app gets short-lived token, embeds into SDK pro render SafeTix.';

-- ============================================================
-- 12. Presence — identity SDK pro 3rd party apps
-- ============================================================
-- Když user "Sign in with Tixly" v 3rd party app, vznikne presence session.
-- Session info: kdo je user, jakého má promotéra, profile + ticket access.
CREATE TABLE IF NOT EXISTS identity.presence_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES b2b.oauth_clients(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  session_token_hash text NOT NULL UNIQUE,
  -- Co SDK pošle nazpět partnerovi
  exposed_fields  text[] NOT NULL DEFAULT ARRAY['user_id', 'email', 'first_name', 'last_name'],
  -- Optional partner device binding
  device_fingerprint text,
  user_agent      text,
  ip_hash         text,
  expires_at      timestamptz NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
  last_active_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_presence_active
  ON identity.presence_sessions(user_id, client_id) WHERE revoked_at IS NULL;

-- ============================================================
-- 13. Testing Harness — sandbox environment
-- ============================================================
-- Partner přepne client na test mode, requests jdou proti sandbox data.
-- Test data jsou fake events + fake users s deterministic IDs.
ALTER TABLE b2b.oauth_clients
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'live'
    CHECK (environment IN ('live', 'sandbox'));

ALTER TABLE b2b.api_keys
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'live'
    CHECK (environment IN ('live', 'sandbox'));

-- Sandbox test fixtures (master data, shared between all clients)
CREATE TABLE IF NOT EXISTS b2b.sandbox_fixtures (
  id              text PRIMARY KEY,            -- 'test_event_1', 'test_user_1'
  fixture_type    text NOT NULL CHECK (fixture_type IN ('event', 'user', 'ticket_type', 'order')),
  data            jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Seed sandbox fixtures
INSERT INTO b2b.sandbox_fixtures (id, fixture_type, data) VALUES
  ('test_event_concert_1', 'event', '{"title":"Test Koncert (sandbox)","date_start":"2099-12-31T20:00:00Z","venue":"Test Hall","currency":"CZK","ticket_types":[{"name":"GA","price":50000},{"name":"VIP","price":150000}]}'::jsonb),
  ('test_event_theater_1', 'event', '{"title":"Test Theater (sandbox)","date_start":"2099-06-15T19:30:00Z","venue":"Test Theater","currency":"CZK","ticket_types":[{"name":"Standard","price":35000}]}'::jsonb),
  ('test_user_buyer_1', 'user', '{"email":"sandbox-buyer@tixly.cz","first_name":"Test","last_name":"Buyer","phone":"+420000000001"}'::jsonb),
  ('test_user_promoter_1', 'user', '{"email":"sandbox-promoter@tixly.cz","first_name":"Sandbox","last_name":"Promoter","is_promoter":true}'::jsonb)
ON CONFLICT DO NOTHING;

COMMENT ON TABLE b2b.sandbox_fixtures IS
  'Testing Harness — fake data pro sandbox environment. Partner si testuje integraci bez živých dat.';

-- ============================================================
-- 14. Inventory Status API (real-time stock snapshot)
-- ============================================================
-- Žádné nové tabulky — endpoint pouze čte z ticket_types.remaining_qty.
-- Ale přidáme materializovaný view pro fast aggregate:
CREATE MATERIALIZED VIEW IF NOT EXISTS catalog.mv_event_inventory_status AS
SELECT
  e.id AS event_id,
  e.promoter_id,
  e.status AS event_status,
  COUNT(tt.id) AS ticket_type_count,
  SUM(tt.total_qty) AS total_capacity,
  SUM(tt.remaining_qty) AS total_remaining,
  SUM(tt.total_qty - tt.remaining_qty) AS total_sold,
  MIN(tt.base_price) AS min_price,
  MAX(tt.base_price) AS max_price,
  CASE
    WHEN SUM(tt.remaining_qty) = 0 THEN 'sold_out'
    WHEN SUM(tt.remaining_qty)::numeric / NULLIF(SUM(tt.total_qty), 0) < 0.10 THEN 'almost_sold_out'
    WHEN SUM(tt.remaining_qty)::numeric / NULLIF(SUM(tt.total_qty), 0) < 0.25 THEN 'selling_fast'
    ELSE 'available'
  END AS availability_status,
  now() AS snapshot_at
FROM catalog.events e
LEFT JOIN catalog.ticket_types tt ON tt.event_id = e.id AND tt.visibility = 'public'
WHERE e.status = 'published' AND e.date_start >= now()
GROUP BY e.id, e.promoter_id, e.status;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_status_event
  ON catalog.mv_event_inventory_status(event_id);
CREATE INDEX IF NOT EXISTS idx_inventory_status_promoter
  ON catalog.mv_event_inventory_status(promoter_id, availability_status);

COMMENT ON MATERIALIZED VIEW catalog.mv_event_inventory_status IS
  'Inventory Status API source. REFRESH MATERIALIZED VIEW CONCURRENTLY á 1 minuta přes cron.';

-- ============================================================
-- 15. Demografická data kupujících
-- ============================================================
ALTER TABLE identity.users
  ADD COLUMN IF NOT EXISTS birth_year integer,
  ADD COLUMN IF NOT EXISTS gender text CHECK (gender IN (NULL, 'male', 'female', 'other', 'prefer_not_to_say')),
  ADD COLUMN IF NOT EXISTS country_code text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS postal_code text;

-- Aggregate view pro per-event demografii
CREATE OR REPLACE VIEW analytics.vw_event_demographics AS
SELECT
  o.event_id,
  COUNT(*) AS buyer_count,
  -- Age groups
  COUNT(*) FILTER (WHERE u.birth_year BETWEEN EXTRACT(YEAR FROM now())::int - 24 AND EXTRACT(YEAR FROM now())::int - 18) AS age_18_24,
  COUNT(*) FILTER (WHERE u.birth_year BETWEEN EXTRACT(YEAR FROM now())::int - 34 AND EXTRACT(YEAR FROM now())::int - 25) AS age_25_34,
  COUNT(*) FILTER (WHERE u.birth_year BETWEEN EXTRACT(YEAR FROM now())::int - 44 AND EXTRACT(YEAR FROM now())::int - 35) AS age_35_44,
  COUNT(*) FILTER (WHERE u.birth_year BETWEEN EXTRACT(YEAR FROM now())::int - 54 AND EXTRACT(YEAR FROM now())::int - 45) AS age_45_54,
  COUNT(*) FILTER (WHERE u.birth_year IS NOT NULL AND u.birth_year < EXTRACT(YEAR FROM now())::int - 54) AS age_55_plus,
  -- Gender
  COUNT(*) FILTER (WHERE u.gender = 'male') AS gender_male,
  COUNT(*) FILTER (WHERE u.gender = 'female') AS gender_female,
  COUNT(*) FILTER (WHERE u.gender = 'other') AS gender_other,
  -- Geo
  jsonb_object_agg(
    COALESCE(u.country_code, 'unknown'),
    cnt
  ) FILTER (WHERE u.country_code IS NOT NULL OR true) AS by_country
FROM orders.orders o
JOIN identity.users u ON u.id = o.user_id
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS cnt
    FROM orders.orders o2
    JOIN identity.users u2 ON u2.id = o2.user_id
   WHERE o2.event_id = o.event_id AND u2.country_code = u.country_code
) c ON true
WHERE o.status = 'paid'
GROUP BY o.event_id;

INSERT INTO public.schema_migrations (filename)
VALUES ('309_tm_parity_tm8_developer_sdk.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
