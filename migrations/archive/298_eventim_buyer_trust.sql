-- 298_eventim_buyer_trust.sql
-- Eventim Parity Fáze E2 — Buyer trust:
-- 1. Custom checkout fields (Eventim "doplňkové otázky")
-- 2. Channel-based pricing (online vs box_office vs partner)
-- 3. Public price preview (kalkulačka pro fanoušky)
--
-- Waitlist máme komplet už od migrace 015 — SKIP

BEGIN;

-- ============================================================
-- 1. Custom checkout fields (per event)
-- ============================================================
CREATE TABLE IF NOT EXISTS catalog.event_custom_fields (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  field_key       text NOT NULL,             -- 'how_did_you_hear', 'dietary_pref'
  label           text NOT NULL,             -- "Jak ses o akci dozvěděl?"
  help_text       text,
  field_type      text NOT NULL CHECK (field_type IN
                    ('text', 'textarea', 'select', 'multiselect',
                     'checkbox', 'radio', 'email', 'phone', 'date', 'number')),
  options         jsonb,                     -- pro select/multiselect/radio
  required        boolean NOT NULL DEFAULT false,
  -- Per-order vs per-ticket
  scope           text NOT NULL DEFAULT 'order' CHECK (scope IN ('order', 'ticket')),
  display_order   integer NOT NULL DEFAULT 100,
  visible_from    timestamptz,               -- ramping in/out
  visible_until   timestamptz,
  validation_regex text,                     -- volitelný server-side validation
  max_length      integer,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_event_custom_fields_event
  ON catalog.event_custom_fields(event_id, display_order);

COMMENT ON TABLE catalog.event_custom_fields IS
  'Per-event checkout questions. Promotér si nakliká vlastní pole (dietní preference, kde slyšel o akci, ...).';

-- Odpovědi (per order nebo per ticket podle scope)
CREATE TABLE IF NOT EXISTS orders.order_custom_field_responses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES orders.orders(id) ON DELETE CASCADE,
  ticket_id       uuid REFERENCES tickets.tickets(id) ON DELETE CASCADE,
  field_id        uuid NOT NULL REFERENCES catalog.event_custom_fields(id) ON DELETE CASCADE,
  value_text      text,
  value_jsonb     jsonb,                     -- pro multiselect / checkbox arrays
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, ticket_id, field_id)
);

CREATE INDEX IF NOT EXISTS idx_order_custom_field_responses_order
  ON orders.order_custom_field_responses(order_id);
CREATE INDEX IF NOT EXISTS idx_order_custom_field_responses_field
  ON orders.order_custom_field_responses(field_id);

-- ============================================================
-- 2. Sales Channels + Channel-based pricing
-- ============================================================
CREATE TABLE IF NOT EXISTS catalog.sales_channels (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     uuid REFERENCES platform.promoters(id) ON DELETE CASCADE,
  -- NULL = global channel, jinak per promotér custom kanál
  channel_key     text NOT NULL,             -- 'online', 'box_office', 'partner_xxx', 'kiosk', 'embed'
  display_name    text NOT NULL,
  description     text,
  is_default      boolean NOT NULL DEFAULT false,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Partial unique indexes místo expression unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_channels_global
  ON catalog.sales_channels(channel_key) WHERE promoter_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_channels_promoter
  ON catalog.sales_channels(promoter_id, channel_key) WHERE promoter_id IS NOT NULL;

-- Seed default global channels
INSERT INTO catalog.sales_channels (promoter_id, channel_key, display_name, is_default)
VALUES
  (NULL, 'online', 'Online (web)', true),
  (NULL, 'box_office', 'Pokladna (POS)', false),
  (NULL, 'partner', 'Partnerská distribuce', false),
  (NULL, 'kiosk', 'Samoobslužný kiosk', false),
  (NULL, 'embed', 'Embed widget (3rd party web)', false),
  (NULL, 'phone', 'Telefonní rezervace', false)
ON CONFLICT DO NOTHING;

-- Per ticket_type × channel price override
CREATE TABLE IF NOT EXISTS catalog.ticket_type_channel_prices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_type_id  uuid NOT NULL REFERENCES catalog.ticket_types(id) ON DELETE CASCADE,
  channel_key     text NOT NULL,
  price_override  integer NOT NULL,          -- v haléřích
  fee_pct_override numeric(5,2),             -- volitelný čas fee override
  effective_from  timestamptz,
  effective_until timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ticket_type_id, channel_key)
);

CREATE INDEX IF NOT EXISTS idx_ttcp_channel
  ON catalog.ticket_type_channel_prices(ticket_type_id, channel_key);

COMMENT ON TABLE catalog.ticket_type_channel_prices IS
  'Channel-specific price overrides. Box office obvykle nižší (no online fee), partner zase vyšší.';

-- ============================================================
-- 3. Public price preview cache (volitelně, pro O(1) calculator)
-- ============================================================
-- Veřejný preview všech cen + fees pro daný event/ticket_type/channel.
-- Recomputed při změně cen, fees, promotérova fee policy.
-- Tady jen pomocná view — actual computation v lib/pricing.
CREATE OR REPLACE VIEW catalog.vw_public_price_preview AS
SELECT
  tt.id AS ticket_type_id,
  tt.event_id,
  tt.name AS ticket_type_name,
  tt.base_price AS online_price,
  COALESCE(
    (SELECT price_override FROM catalog.ticket_type_channel_prices
      WHERE ticket_type_id = tt.id AND channel_key = 'box_office'
        AND (effective_from IS NULL OR effective_from <= now())
        AND (effective_until IS NULL OR effective_until > now())
      LIMIT 1),
    tt.base_price
  ) AS box_office_price,
  COALESCE(
    (SELECT price_override FROM catalog.ticket_type_channel_prices
      WHERE ticket_type_id = tt.id AND channel_key = 'partner'
        AND (effective_from IS NULL OR effective_from <= now())
        AND (effective_until IS NULL OR effective_until > now())
      LIMIT 1),
    tt.base_price
  ) AS partner_price,
  tt.remaining_qty,
  tt.visibility
FROM catalog.ticket_types tt;

COMMENT ON VIEW catalog.vw_public_price_preview IS
  'Public price preview per ticket type × channel. Drives the price calculator.';

INSERT INTO public.schema_migrations (filename)
VALUES ('298_eventim_buyer_trust.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
