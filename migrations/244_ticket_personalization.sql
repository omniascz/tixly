-- Ticket Personalization — holder_name per ticket.
--
-- Některé akce (konference, multi-day festival, premium koncerty) vyžadují
-- jméno per vstupenku pro kontrolu u brány s ID. Promotér to nastaví per
-- ticket_type. Checkout pak vyžaduje holderNames[] s length = quantity.

BEGIN;

ALTER TABLE tickets.tickets
  ADD COLUMN IF NOT EXISTS holder_name TEXT;

ALTER TABLE catalog.ticket_types
  ADD COLUMN IF NOT EXISTS requires_personalization BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN tickets.tickets.holder_name IS
  'Jméno držitele vstupenky — pokud ticket_type.requires_personalization, vyplněno v checkoutu. Použito v PDF + scanner ID check.';
COMMENT ON COLUMN catalog.ticket_types.requires_personalization IS
  'Pokud TRUE, checkout vyžaduje holderNames[] v body (jméno per vstupenku) a scanner ověří match s předloženým ID.';

CREATE INDEX IF NOT EXISTS idx_tickets_holder_name
  ON tickets.tickets (holder_name)
  WHERE holder_name IS NOT NULL;

-- Order-level seznam jmen — checkout uloží, issuer čte a přiřadí 1-to-1 per ticket.
ALTER TABLE orders.orders
  ADD COLUMN IF NOT EXISTS holder_names TEXT[];

COMMENT ON COLUMN orders.orders.holder_names IS
  'Volitelný seznam jmen pro personalizované vstupenky. Length = quantity. Issuer přiřadí postupně.';

COMMIT;
