CREATE TABLE IF NOT EXISTS fnb_menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id UUID NOT NULL,
  event_id UUID,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'food' CHECK (category IN ('food','beverage','combo','other')),
  price_halire INTEGER NOT NULL CHECK (price_halire >= 0),
  max_quantity_per_order INTEGER NOT NULL DEFAULT 10,
  stock_limit INTEGER,
  available BOOLEAN NOT NULL DEFAULT true,
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_fnb_menu_event ON fnb_menu_items(event_id, promoter_id) WHERE available = true;

CREATE TABLE IF NOT EXISTS fnb_preorders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL,
  event_id UUID NOT NULL,
  promoter_id UUID NOT NULL,
  user_id UUID,
  items JSONB NOT NULL DEFAULT '[]',
  total_halire INTEGER NOT NULL CHECK (total_halire >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','ready','picked_up','cancelled')),
  pickup_code TEXT NOT NULL UNIQUE,
  pickup_qr_data TEXT NOT NULL,
  pickup_window_start TIMESTAMPTZ,
  pickup_window_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_fnb_preorder_order ON fnb_preorders(order_id);
CREATE INDEX idx_fnb_preorder_event ON fnb_preorders(event_id, status);
CREATE INDEX idx_fnb_pickup_code ON fnb_preorders(pickup_code);
