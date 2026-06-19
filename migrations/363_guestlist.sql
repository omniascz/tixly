BEGIN;

-- Guestlist: zdarma vstupenky pro hosty (VIP, novináři, partneři)
CREATE TABLE IF NOT EXISTS orders.guestlist_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  promoter_id     UUID NOT NULL REFERENCES platform.promoters(id),
  guest_name      TEXT NOT NULL,
  guest_email     TEXT NOT NULL,
  notes           TEXT,
  invited_by      TEXT,
  ticket_id       UUID REFERENCES tickets.tickets(id),
  status          TEXT NOT NULL DEFAULT 'invited'
                    CHECK (status IN ('invited','confirmed','attended','no_show','cancelled')),
  checked_in_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_guestlist_event ON orders.guestlist_entries(event_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_guestlist_event_email ON orders.guestlist_entries(event_id, guest_email);

COMMIT;
