BEGIN;

-- Automatická last-minute sleva
CREATE TABLE IF NOT EXISTS catalog.lastminute_rules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE UNIQUE,
  hours_before      INT NOT NULL DEFAULT 2 CHECK (hours_before BETWEEN 1 AND 72),
  min_occupancy_pct INT NOT NULL DEFAULT 60 CHECK (min_occupancy_pct BETWEEN 1 AND 99),
  discount_pct      INT NOT NULL DEFAULT 30 CHECK (discount_pct BETWEEN 5 AND 70),
  is_active         BOOLEAN NOT NULL DEFAULT true,
  triggered_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
