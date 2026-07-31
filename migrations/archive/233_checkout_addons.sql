CREATE TABLE IF NOT EXISTS checkout_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id UUID NOT NULL,
  event_id UUID,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL CHECK (category IN ('parking','merch','insurance','upgrade','other')),
  price_halire INTEGER NOT NULL CHECK (price_halire >= 0),
  max_quantity INTEGER NOT NULL DEFAULT 1,
  stock_available INTEGER,
  image_url TEXT,
  available BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_addons_event ON checkout_addons(event_id, promoter_id) WHERE available = true;

CREATE TABLE IF NOT EXISTS order_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL,
  addon_id UUID NOT NULL,
  addon_name TEXT NOT NULL,
  category TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_halire INTEGER NOT NULL,
  subtotal_halire INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_order_addons_order ON order_addons(order_id);
CREATE INDEX idx_order_addons_addon ON order_addons(addon_id);
