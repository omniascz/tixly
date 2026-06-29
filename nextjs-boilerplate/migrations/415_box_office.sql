-- Migration 415: Box Office (pokladna na místě)
-- Prodej vstupenek za hotové/kartou přímo na místě konání.

CREATE TABLE IF NOT EXISTS orders.box_office_sessions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid        NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  cashier_user_id uuid        NOT NULL REFERENCES identity.users(id),
  opened_at       timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz,
  opening_cash_halire  int    NOT NULL DEFAULT 0,
  cash_in_halire  int         NOT NULL DEFAULT 0,
  card_in_halire  int         NOT NULL DEFAULT 0,
  tickets_sold    int         NOT NULL DEFAULT 0,
  status          text        NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  notes           text
);

CREATE INDEX IF NOT EXISTS idx_box_office_sessions_event ON orders.box_office_sessions (event_id);
CREATE INDEX IF NOT EXISTS idx_box_office_sessions_cashier ON orders.box_office_sessions (cashier_user_id);

CREATE TABLE IF NOT EXISTS orders.box_office_sales (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid        NOT NULL REFERENCES orders.box_office_sessions(id) ON DELETE CASCADE,
  order_id        uuid        REFERENCES orders.orders(id),
  ticket_type_id  uuid        REFERENCES catalog.ticket_types(id),
  ticket_type_name text       NOT NULL,
  quantity        int         NOT NULL DEFAULT 1,
  unit_price_halire int       NOT NULL,
  total_halire    int         NOT NULL,
  payment_type    text        NOT NULL DEFAULT 'cash' CHECK (payment_type IN ('cash','card','voucher')),
  cash_tendered_halire int,
  change_halire   int         NOT NULL DEFAULT 0,
  receipt_number  text        UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_box_office_sales_session ON orders.box_office_sales (session_id);

-- Track that an order came from box office
ALTER TABLE orders.orders ADD COLUMN IF NOT EXISTS is_box_office boolean NOT NULL DEFAULT false;
ALTER TABLE orders.orders ADD COLUMN IF NOT EXISTS box_office_session_id uuid REFERENCES orders.box_office_sessions(id);

-- RLS
ALTER TABLE orders.box_office_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders.box_office_sales ENABLE ROW LEVEL SECURITY;

-- Promoter members can manage their event's sessions
CREATE POLICY box_office_sessions_promoter ON orders.box_office_sessions FOR ALL USING (
  current_setting('app.is_platform_admin', true) = 'true'
  OR EXISTS (
    SELECT 1 FROM catalog.events e
      JOIN identity.promoter_members pm ON pm.promoter_id = e.promoter_id
     WHERE e.id = event_id
       AND pm.user_id::text = current_setting('app.user_id', true)
  )
);

CREATE POLICY box_office_sales_promoter ON orders.box_office_sales FOR ALL USING (
  current_setting('app.is_platform_admin', true) = 'true'
  OR EXISTS (
    SELECT 1 FROM orders.box_office_sessions s
      JOIN catalog.events e ON e.id = s.event_id
      JOIN identity.promoter_members pm ON pm.promoter_id = e.promoter_id
     WHERE s.id = session_id
       AND pm.user_id::text = current_setting('app.user_id', true)
  )
);
