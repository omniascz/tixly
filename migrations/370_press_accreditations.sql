BEGIN;

-- Press/mediální akreditace
ALTER TABLE catalog.events ADD COLUMN IF NOT EXISTS press_seats_max INT NOT NULL DEFAULT 0;
ALTER TABLE catalog.events ADD COLUMN IF NOT EXISTS press_deadline TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS orders.press_accreditations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         UUID NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  promoter_id      UUID NOT NULL REFERENCES platform.promoters(id),
  journalist_name  TEXT NOT NULL,
  journalist_email TEXT NOT NULL,
  media_outlet     TEXT NOT NULL,
  purpose          TEXT,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','approved','rejected')),
  ticket_id        UUID REFERENCES tickets.tickets(id),
  rejection_reason TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_press_accr_event ON orders.press_accreditations(event_id, status);

COMMIT;
