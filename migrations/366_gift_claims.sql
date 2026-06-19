BEGIN;

-- Dárkové vstupenky: kupující pošle příjemci magic link k výběru termínu
CREATE TABLE IF NOT EXISTS orders.gift_claims (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES orders.orders(id) ON DELETE CASCADE,
  claim_token     TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  recipient_email TEXT NOT NULL,
  recipient_name  TEXT NOT NULL,
  gift_message    TEXT,
  production_id   UUID REFERENCES catalog.productions(id),
  event_id        UUID REFERENCES catalog.events(id),
  ticket_type_id  UUID REFERENCES catalog.ticket_types(id),
  claimed_at      TIMESTAMPTZ,
  claimed_event_id UUID REFERENCES catalog.events(id),
  claimed_ticket_id UUID REFERENCES tickets.tickets(id),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + interval '1 year',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gift_claims_token ON orders.gift_claims(claim_token);

COMMIT;
