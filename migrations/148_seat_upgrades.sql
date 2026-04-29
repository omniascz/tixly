-- =============================================================================
-- Migration 148: In-Venue Seat Upgrades
-- Feature #43: Fan upgrades seat from mobile after arriving at venue
--              Real-time seat-map integration, charges price difference
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS seat_upgrades;

-- Upgrade request: one per ticket, tracks the upgrade flow
CREATE TABLE IF NOT EXISTS seat_upgrades.upgrade_requests (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_ticket_id      UUID NOT NULL REFERENCES tickets.tickets(id),
  new_seat_id             TEXT NOT NULL,       -- target seat ID from seat-map
  new_ticket_type_id      UUID,
  user_id                 UUID NOT NULL,
  event_id                UUID NOT NULL REFERENCES catalog.events(id),
  original_price_hellers  INT NOT NULL,
  new_price_hellers       INT NOT NULL,
  upgrade_fee_hellers     INT NOT NULL,        -- price difference charged
  status                  TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'payment_initiated', 'completed', 'cancelled', 'expired')),
  payment_intent_id       TEXT,               -- Stripe PaymentIntent for the difference
  new_ticket_id           UUID,               -- assigned after completion
  expires_at              TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '10 minutes',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at            TIMESTAMPTZ
);

-- One active upgrade request per ticket at a time
CREATE UNIQUE INDEX idx_seat_upgrades_active_ticket
  ON seat_upgrades.upgrade_requests(original_ticket_id)
  WHERE status IN ('pending', 'payment_initiated');

CREATE INDEX idx_seat_upgrades_event ON seat_upgrades.upgrade_requests(event_id);
CREATE INDEX idx_seat_upgrades_user ON seat_upgrades.upgrade_requests(user_id);
