-- 323_charity_allocations.sql
-- CZ priority #9 (ROI 5/10): Tickets for Good — promotér daruje
-- unsold/donated tickety registrované charitě.
--
-- Inspirováno UK Tickets for Good (AXS partnership 02/2026):
-- charity vyplní formulář, dostane batch tickets pro své beneficiaries,
-- redeem přes claim_token na buyer-like flow. Promotér má tax write-off
-- evidenci (allocation log).
--
-- Idempotent.

BEGIN;

CREATE SCHEMA IF NOT EXISTS charity;

-- Registrovaná charita platformou (per země — CZ: Linka bezpečí,
-- Paměť národa, Nadace VIA, Konto Bariéry...). Approval ručně admin.
CREATE TABLE IF NOT EXISTS charity.partners (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  ico             text,                       -- IČO charity (registrace MSp)
  contact_email   text NOT NULL,
  contact_phone   text,
  description     text,
  website_url     text,
  approved        boolean NOT NULL DEFAULT false,
  approved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT charity_partners_ico_unique UNIQUE (ico)
);

CREATE INDEX IF NOT EXISTS idx_charity_partners_approved
  ON charity.partners(approved) WHERE approved = true;

-- Allocation = batch ticketů od promotéra → charity.
-- Charity dostane jednorázový claim_token + dashboard se seznamem
-- ticket-by-ticket claim_token URL pro distribuci beneficiaries.
CREATE TABLE IF NOT EXISTS charity.allocations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     uuid NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  charity_id      uuid NOT NULL REFERENCES charity.partners(id) ON DELETE RESTRICT,
  event_id        uuid NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  ticket_type_id  uuid REFERENCES catalog.ticket_types(id) ON DELETE SET NULL,
  quantity        integer NOT NULL,
  tax_write_off_value_halire bigint NOT NULL DEFAULT 0,  -- pro promoter daňový doklad
  message         text,
  created_by_user_id uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT charity_allocations_quantity_check
    CHECK (quantity >= 1 AND quantity <= 500)
);

CREATE INDEX IF NOT EXISTS idx_charity_allocations_charity
  ON charity.allocations(charity_id);
CREATE INDEX IF NOT EXISTS idx_charity_allocations_event
  ON charity.allocations(event_id);

-- Per-ticket claim slot. Charita dostane URL /charity/claim/<token>
-- pro každý slot, distribuuje beneficiaries. Po claim se vytvoří
-- normální order + ticket s payment_provider='charity' a total_amount=0.
CREATE TABLE IF NOT EXISTS charity.claim_slots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_id   uuid NOT NULL REFERENCES charity.allocations(id) ON DELETE CASCADE,
  claim_token     text NOT NULL UNIQUE,
  status          text NOT NULL DEFAULT 'available',
  claimed_by_email text,
  claimed_by_name text,
  order_id        uuid REFERENCES orders.orders(id) ON DELETE SET NULL,
  claimed_at      timestamptz,
  expires_at      timestamptz NOT NULL DEFAULT now() + INTERVAL '90 days',
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT charity_claim_slots_status_check
    CHECK (status IN ('available', 'claimed', 'expired', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_charity_claim_slots_allocation
  ON charity.claim_slots(allocation_id);
CREATE INDEX IF NOT EXISTS idx_charity_claim_slots_token
  ON charity.claim_slots(claim_token) WHERE status = 'available';

-- Rozšíření orders.orders constraint pro 'charity' provider — bez money flow.
ALTER TABLE orders.orders DROP CONSTRAINT IF EXISTS orders_payment_provider_check;
ALTER TABLE orders.orders ADD CONSTRAINT orders_payment_provider_check
  CHECK (payment_provider IN (
    'mock', 'gopay', 'comgate', 'stripe', 'wero', 'przelewy24',
    'bank_transfer', 'twisto', 'skippay', 'pluxee', 'sodexo',
    'benefit_plus', 'edenred', 'voucher', 'charity'
  ));

COMMENT ON TABLE charity.partners IS
  'Registrované charitativní organizace. Approval admin manuálně po ICO check.';
COMMENT ON TABLE charity.allocations IS
  'Batch tickety od promotéra na charitu. tax_write_off_value_halire pro promoter daň.';
COMMENT ON TABLE charity.claim_slots IS
  'Per-ticket claim slot s URL tokenem. Charity rozdistribuuje beneficiaries.';

COMMIT;
