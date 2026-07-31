-- 436_call_center
-- Telefonní objednávky (Call Center / Phone Orders).
-- Operátor zadá údaje zákazníka + vybraný typ vstupenky,
-- systém vygeneruje HMAC pay-by-link a pošle ho zákazníkovi.
-- Zákazník odkaz otevře, zaplatí → vznikne běžná orders.orders.

CREATE TABLE IF NOT EXISTS orders.phone_orders (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id         uuid        NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  event_id            uuid        NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  ticket_type_id      uuid        NOT NULL REFERENCES catalog.ticket_types(id),
  quantity            int         NOT NULL CHECK (quantity >= 1 AND quantity <= 50),
  total_amount        bigint      NOT NULL,
  customer_name       text        NOT NULL,
  customer_phone      text        NOT NULL,
  customer_email      text,
  notes               text,
  status              text        NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment', 'paid', 'cancelled', 'expired')),
  pay_link_token      text        NOT NULL,
  pay_link_expires_at timestamptz NOT NULL,
  order_id            uuid,
  created_by          uuid        REFERENCES identity.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_phone_orders_promoter
  ON orders.phone_orders (promoter_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_phone_orders_event
  ON orders.phone_orders (event_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_phone_orders_token
  ON orders.phone_orders (pay_link_token);

ALTER TABLE orders.phone_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY po_select_promoter ON orders.phone_orders
  FOR SELECT USING (
    promoter_id::text = current_setting('app.current_promoter_id', true)
    OR current_setting('app.role', true) = 'system'
  );

CREATE POLICY po_insert_promoter ON orders.phone_orders
  FOR INSERT WITH CHECK (
    promoter_id::text = current_setting('app.current_promoter_id', true)
  );

CREATE POLICY po_update_service ON orders.phone_orders
  FOR UPDATE USING (
    current_setting('app.role', true) = 'system'
    OR promoter_id::text = current_setting('app.current_promoter_id', true)
  );
