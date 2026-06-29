-- Migration 416: Post-purchase ticket transfer (předání vstupenky)
-- Buyer může po zaplacení předat vstupenku příteli bez nového platebního procesu.

CREATE TABLE IF NOT EXISTS orders.ticket_transfers (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       uuid        NOT NULL REFERENCES tickets.tickets(id) ON DELETE CASCADE,
  order_id        uuid        NOT NULL REFERENCES orders.orders(id) ON DELETE CASCADE,
  from_user_id    uuid        NOT NULL REFERENCES identity.users(id),
  to_email        text        NOT NULL,
  to_name         text,
  transfer_token  text        NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'base64url'),
  message         text,
  status          text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','claimed','cancelled','expired')),
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '72 hours',
  claimed_at      timestamptz,
  claimed_user_id uuid        REFERENCES identity.users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_transfers_ticket ON orders.ticket_transfers (ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_transfers_token ON orders.ticket_transfers (transfer_token);
CREATE INDEX IF NOT EXISTS idx_ticket_transfers_from_user ON orders.ticket_transfers (from_user_id);

-- Track transfer on ticket itself
ALTER TABLE tickets.tickets ADD COLUMN IF NOT EXISTS transferred_to_user_id uuid REFERENCES identity.users(id);
ALTER TABLE tickets.tickets ADD COLUMN IF NOT EXISTS transfer_status text
  CHECK (transfer_status IS NULL OR transfer_status IN ('pending_transfer','transferred'));

-- RLS: sender sees own transfers; recipient can read by token (public)
ALTER TABLE orders.ticket_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY ticket_transfers_sender ON orders.ticket_transfers FOR SELECT USING (
  from_user_id::text = current_setting('app.user_id', true)
  OR current_setting('app.is_platform_admin', true) = 'true'
);
CREATE POLICY ticket_transfers_insert ON orders.ticket_transfers FOR INSERT WITH CHECK (
  from_user_id::text = current_setting('app.user_id', true)
);
CREATE POLICY ticket_transfers_update ON orders.ticket_transfers FOR UPDATE USING (true);
