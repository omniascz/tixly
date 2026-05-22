-- 314_marketing_transit_combo.sql
-- DACH parity #10: MHD Kombi-Ticket (München Ticket MVV pattern).
-- Buyer koupí vstupenku → automaticky dostane jízdenku DPP/Lítačka platnou
-- v den akce (zóny dle promotér configu). Massive city moat — žádná CZ
-- ticketing platforma to nemá.
--
-- Production: DPP API přístup vyžaduje partnership smlouvu (měsíce lead time).
-- Pro mock režim: žádné DPP_API_KEY → SDK vrátí valid-looking QR s signature
-- který inspector může verifikovat lokálně.
--
-- Idempotent.

BEGIN;

-- Katalog transit partnerů (DPP, IDOS, Lítačka, regionální).
CREATE TABLE IF NOT EXISTS marketing.transit_partners (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE,        -- 'dpp', 'idos', 'mvv-munich'
  name            text NOT NULL,                -- 'Pražská integrovaná doprava'
  city            text,                         -- 'Praha'
  country         text NOT NULL DEFAULT 'CZ',
  -- Mock mode SDK target — pokud env DPP_API_KEY chybí, SDK vrací mock QR
  api_endpoint    text,
  -- Dostupné tarifní zóny (JSON pole stringů)
  available_zones jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Seed: DPP (Pražská integrovaná doprava) jako default pro CZ
INSERT INTO marketing.transit_partners (slug, name, city, country, available_zones)
VALUES (
  'dpp',
  'Pražská integrovaná doprava (DPP)',
  'Praha',
  'CZ',
  '["P", "0", "B", "1", "2", "3", "4", "5"]'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO marketing.transit_partners (slug, name, city, country, available_zones)
VALUES (
  'idos-brno',
  'IDS JMK Brno',
  'Brno',
  'CZ',
  '["100", "101", "200"]'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- Per-event transit combo config — promotér rozhoduje per akce.
CREATE TABLE IF NOT EXISTS catalog.event_transit_combo (
  event_id        uuid PRIMARY KEY REFERENCES catalog.events(id) ON DELETE CASCADE,
  partner_id      uuid NOT NULL REFERENCES marketing.transit_partners(id),
  -- Které zóny zahrnuté v ticketu (subset partner.available_zones)
  zones           jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Validity window — pro DPP typicky den akce 0:00–06:00 následujícího
  valid_from_offset_hours int NOT NULL DEFAULT 0,    -- 0 = od půlnoci
  valid_until_offset_hours int NOT NULL DEFAULT 30,  -- 30 = 6:00 následujícího dne
  -- Promotér platí fixní paušál transit partner-ovi per ticket
  partner_fee_halire int NOT NULL DEFAULT 0,
  enabled         boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Per-order transit pass — jeden ticket-as-jízdenka per objednávka
CREATE TABLE IF NOT EXISTS orders.transit_passes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid NOT NULL UNIQUE REFERENCES orders.orders(id) ON DELETE CASCADE,
  partner_id        uuid NOT NULL REFERENCES marketing.transit_partners(id),
  zones             jsonb NOT NULL,                 -- snapshot z event_transit_combo
  valid_from        timestamptz NOT NULL,
  valid_until       timestamptz NOT NULL,
  -- Signature pro inspector validation (HMAC over order_id + zones + valid_until)
  validation_signature text NOT NULL,
  -- QR payload "tixly-mhd:{partner_slug}:{order_id}:{sig}"
  qr_payload        text NOT NULL,
  is_mock           boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transit_passes_order ON orders.transit_passes(order_id);
CREATE INDEX IF NOT EXISTS idx_transit_passes_partner ON orders.transit_passes(partner_id);

-- RLS jen na orders.transit_passes (buyer vidí jen vlastní)
ALTER TABLE orders.transit_passes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'orders' AND tablename = 'transit_passes'
      AND policyname = 'transit_passes_buyer_owns'
  ) THEN
    EXECUTE $POL$
      CREATE POLICY transit_passes_buyer_owns ON orders.transit_passes
        FOR ALL TO tixly_app
        USING (
          order_id IN (
            SELECT id FROM orders.orders
            WHERE user_id = current_setting('app.current_user_id', true)::uuid
          )
          OR current_setting('app.platform_admin', true) = 'true'
        )
    $POL$;
  END IF;
END $$;

COMMIT;
