BEGIN;

-- Sezónní pas: flexibilní předplatné (na rozdíl od abonmá — kupující si vybírá akce sám)
CREATE TABLE IF NOT EXISTS catalog.season_pass_products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     UUID NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT,
  price_halire    INT NOT NULL CHECK (price_halire > 0),
  total_uses      INT NOT NULL CHECK (total_uses >= 1),
  valid_from      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until     TIMESTAMPTZ NOT NULL,
  max_per_buyer   INT NOT NULL DEFAULT 1,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS orders.season_passes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID NOT NULL REFERENCES catalog.season_pass_products(id),
  order_id        UUID REFERENCES orders.orders(id),
  holder_email    TEXT NOT NULL,
  holder_name     TEXT NOT NULL,
  uses_remaining  INT NOT NULL,
  valid_until     TIMESTAMPTZ NOT NULL,
  pass_token      TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS orders.season_pass_uses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pass_id         UUID NOT NULL REFERENCES orders.season_passes(id),
  event_id        UUID NOT NULL REFERENCES catalog.events(id),
  ticket_id       UUID REFERENCES tickets.tickets(id),
  used_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sp_uses_pass ON orders.season_pass_uses(pass_id);

COMMIT;
