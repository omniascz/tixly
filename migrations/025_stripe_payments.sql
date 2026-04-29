-- =============================================================================
-- Migration 025: Stripe Payments
--
-- Přidává Stripe-specifická pole do orders.orders a orders.payment_events.
-- Zachovává zpětnou kompatibilitu s GoPay (DEFAULT 'gopay').
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- orders.orders — nová pole pro multi-provider platby
-- ---------------------------------------------------------------------------

ALTER TABLE orders.orders
  ADD COLUMN IF NOT EXISTS payment_provider TEXT
    CHECK (payment_provider IN ('gopay', 'stripe', 'przelewy24', 'free'))
    DEFAULT 'gopay',

  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT UNIQUE,  -- nullable

  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;               -- nullable, pro returning customers

COMMENT ON COLUMN orders.orders.payment_provider IS
  'Platební provider použitý pro tuto objednávku. Výchozí gopay pro zpětnou kompatibilitu.';

COMMENT ON COLUMN orders.orders.stripe_payment_intent_id IS
  'Stripe PaymentIntent ID (pi_...). Unikátní per objednávka. NULL pro ne-Stripe platby.';

COMMENT ON COLUMN orders.orders.stripe_customer_id IS
  'Stripe Customer ID (cus_...). Volitelné — ukládá se pro returning customers.';

-- ---------------------------------------------------------------------------
-- orders.payment_events — provider + Stripe idempotency
-- ---------------------------------------------------------------------------

ALTER TABLE orders.payment_events
  ADD COLUMN IF NOT EXISTS payment_provider TEXT NOT NULL DEFAULT 'gopay',

  ADD COLUMN IF NOT EXISTS stripe_event_id TEXT;  -- nullable, Stripe garantuje unique event IDs

COMMENT ON COLUMN orders.payment_events.payment_provider IS
  'Provider který vygeneroval tento event. NOT NULL pro audit trail.';

COMMENT ON COLUMN orders.payment_events.stripe_event_id IS
  'Stripe webhook event ID (evt_...). Slouží k idempotency — duplicitní eventy se přeskočí.';

-- Index pro rychlé idempotency lookup
CREATE INDEX IF NOT EXISTS idx_payment_events_stripe_event_id
  ON orders.payment_events (stripe_event_id)
  WHERE stripe_event_id IS NOT NULL;

-- Index pro vyhledávání podle payment_provider
CREATE INDEX IF NOT EXISTS idx_orders_payment_provider
  ON orders.orders (payment_provider);

COMMIT;
