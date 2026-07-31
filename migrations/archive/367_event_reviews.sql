BEGIN;

-- Automatické hodnocení po představení
CREATE TABLE IF NOT EXISTS marketing.event_reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  order_id        UUID REFERENCES orders.orders(id),
  reviewer_email  TEXT NOT NULL,
  reviewer_name   TEXT,
  rating          SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment         TEXT,
  is_public       BOOLEAN NOT NULL DEFAULT true,
  review_token    TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reviews_event ON marketing.event_reviews(event_id, is_public);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_order ON marketing.event_reviews(order_id)
  WHERE order_id IS NOT NULL;
ALTER TABLE catalog.events ADD COLUMN IF NOT EXISTS reviews_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE catalog.events ADD COLUMN IF NOT EXISTS review_send_hours_after INT NOT NULL DEFAULT 20;

COMMIT;
