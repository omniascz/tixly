-- Migration 420: Post-purchase seat upgrade
-- Buyer může upgradovat sedadlo po zaplacení (doplatek za lepší místo).

CREATE TABLE IF NOT EXISTS orders.seat_upgrades (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  original_order_id   uuid        NOT NULL REFERENCES orders.orders(id) ON DELETE CASCADE,
  original_ticket_id  uuid        NOT NULL REFERENCES tickets.tickets(id),
  original_seat_id    uuid        REFERENCES catalog.seats(id),
  new_seat_id         uuid        REFERENCES catalog.seats(id),
  new_ticket_type_id  uuid        REFERENCES catalog.ticket_types(id),
  upgrade_fee_halire  int         NOT NULL CHECK (upgrade_fee_halire >= 0),
  payment_id          text,
  payment_provider    text,
  status              text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','paid','cancelled')),
  initiated_at        timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz
);

CREATE INDEX IF NOT EXISTS idx_seat_upgrades_order ON orders.seat_upgrades (original_order_id);

-- RLS
ALTER TABLE orders.seat_upgrades ENABLE ROW LEVEL SECURITY;
CREATE POLICY seat_upgrades_buyer ON orders.seat_upgrades FOR SELECT USING (
  current_setting('app.is_platform_admin', true) = 'true'
  OR EXISTS (
    SELECT 1 FROM orders.orders o WHERE o.id = original_order_id
      AND o.user_id::text = current_setting('app.user_id', true)
  )
);
CREATE POLICY seat_upgrades_insert ON orders.seat_upgrades FOR INSERT WITH CHECK (true);
CREATE POLICY seat_upgrades_update ON orders.seat_upgrades FOR UPDATE USING (true);
