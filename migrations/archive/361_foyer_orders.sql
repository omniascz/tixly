-- 361_foyer_orders.sql
-- Foyer pre-order (nápoje, chlebíčky, dezerty objednané s lístkem)
-- catalog.foyer_menu_items: menu divadla per-event
-- orders.foyer_orders: objednávka foyeru navázaná na orders.orders s pickup QR tokenem

BEGIN;

CREATE TABLE IF NOT EXISTS catalog.foyer_menu_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  price_halire    INT NOT NULL CHECK (price_halire > 0),
  category        TEXT NOT NULL DEFAULT 'drink'
                    CHECK (category IN ('drink','food','dessert','other')),
  available_count INT,   -- NULL = neomezeno
  image_url       TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  order_index     INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_foyer_menu_event ON catalog.foyer_menu_items(event_id) WHERE is_active;

CREATE TABLE IF NOT EXISTS orders.foyer_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES orders.orders(id) ON DELETE CASCADE,
  event_id        UUID NOT NULL REFERENCES catalog.events(id),
  items           JSONB NOT NULL,   -- [{menuItemId, name, quantity, unitPriceHalire}]
  total_halire    INT NOT NULL CHECK (total_halire > 0),
  pickup_qr_token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(12),'hex'),
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','ready','collected')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_foyer_orders_event ON orders.foyer_orders(event_id, status);

COMMIT;
