-- Migration 388: Comp ticket support — reason category + comp_type on orders
-- Guestlist already issues 0-price orders; this adds reason tracking + comp_type
-- for proper accounting (press, vip, artist, sponsor, staff, other).

ALTER TABLE orders.orders
  ADD COLUMN IF NOT EXISTS comp_type VARCHAR(20)
    CHECK (comp_type IN ('press', 'vip', 'artist', 'sponsor', 'staff', 'other')),
  ADD COLUMN IF NOT EXISTS comp_notes TEXT;

COMMENT ON COLUMN orders.orders.comp_type IS
  'NULL = paid order; non-NULL = complimentary (press/vip/artist/sponsor/staff/other)';
COMMENT ON COLUMN orders.orders.comp_notes IS
  'Volný text k comp objednávce (jméno média, důvod VIP, ap.)';

CREATE INDEX IF NOT EXISTS orders_comp_type_event_idx
  ON orders.orders (event_id, comp_type)
  WHERE comp_type IS NOT NULL;
