-- Migration 418: Fyzické doručení vstupenek (PostTicket)
-- Buyer zvolí poštovní doručení v checkoutu → adresa → fulfillment queue pro admina.

ALTER TABLE orders.orders ADD COLUMN IF NOT EXISTS delivery_method text
  NOT NULL DEFAULT 'digital' CHECK (delivery_method IN ('digital','postal'));
ALTER TABLE orders.orders ADD COLUMN IF NOT EXISTS postal_fee_halire int NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS orders.postal_deliveries (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid        NOT NULL UNIQUE REFERENCES orders.orders(id) ON DELETE CASCADE,
  recipient_name  text        NOT NULL,
  address_line1   text        NOT NULL,
  address_line2   text,
  city            text        NOT NULL,
  postal_code     text        NOT NULL,
  country         text        NOT NULL DEFAULT 'CZ',
  dispatched_at   timestamptz,
  tracking_number text,
  carrier         text,
  status          text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','dispatched','delivered','returned')),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_postal_deliveries_status ON orders.postal_deliveries (status);

-- Platform setting: postal fee per country
CREATE TABLE IF NOT EXISTS platform.postal_fees (
  country         text        PRIMARY KEY,
  fee_halire      int         NOT NULL DEFAULT 9900, -- 99 Kč default
  carrier         text        NOT NULL DEFAULT 'Česká pošta',
  active          boolean     NOT NULL DEFAULT true
);

INSERT INTO platform.postal_fees (country, fee_halire, carrier) VALUES
  ('CZ', 9900, 'Česká pošta'),
  ('SK', 14900, 'Slovenská pošta')
ON CONFLICT (country) DO NOTHING;

-- RLS
ALTER TABLE orders.postal_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.postal_fees ENABLE ROW LEVEL SECURITY;

CREATE POLICY postal_deliveries_buyer ON orders.postal_deliveries FOR SELECT USING (
  current_setting('app.is_platform_admin', true) = 'true'
  OR EXISTS (
    SELECT 1 FROM orders.orders o WHERE o.id = order_id
      AND o.user_id::text = current_setting('app.user_id', true)
  )
);
CREATE POLICY postal_deliveries_insert ON orders.postal_deliveries FOR INSERT WITH CHECK (true);
CREATE POLICY postal_deliveries_admin ON orders.postal_deliveries FOR UPDATE USING (
  current_setting('app.is_platform_admin', true) = 'true'
);

CREATE POLICY postal_fees_select ON platform.postal_fees FOR SELECT USING (true);
CREATE POLICY postal_fees_write ON platform.postal_fees FOR ALL USING (
  current_setting('app.is_platform_admin', true) = 'true'
);
