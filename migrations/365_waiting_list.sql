BEGIN;

-- Čekací listina pro vyprodaná představení
CREATE TABLE IF NOT EXISTS orders.waiting_list (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  ticket_type_id  UUID REFERENCES catalog.ticket_types(id),
  email           TEXT NOT NULL,
  name            TEXT NOT NULL,
  position        INT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'waiting'
                    CHECK (status IN ('waiting','offered','converted','expired','cancelled')),
  offered_at      TIMESTAMPTZ,
  offer_expires_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_waitlist_event ON orders.waiting_list(event_id, status, position);
CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_event_email ON orders.waiting_list(event_id, email)
  WHERE status NOT IN ('converted','cancelled');

COMMIT;
