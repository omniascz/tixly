-- =============================================================================
-- Migration 142: RFID Wristbands
-- Feature #31: Festival RFID fulfillment, contactless entry, cashless payments
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS rfid;

-- Wristband: one per attendee/ticket, issued at festival entry
CREATE TABLE IF NOT EXISTS rfid.rfid_wristbands (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            UUID NOT NULL REFERENCES catalog.events(id),
  ticket_id           UUID NOT NULL UNIQUE REFERENCES tickets.tickets(id),
  uid                 TEXT NOT NULL UNIQUE,   -- RFID hardware UID (hex string)
  status              TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'active', 'suspended', 'blocked')),
  balance_hellers     INT NOT NULL DEFAULT 0 CHECK (balance_hellers >= 0),
  issued_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at        TIMESTAMPTZ,
  last_tap_at         TIMESTAMPTZ
);

-- RFID tap log: entry scans and cashless payment taps
CREATE TABLE IF NOT EXISTS rfid.rfid_taps (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wristband_id        UUID NOT NULL REFERENCES rfid.rfid_wristbands(id),
  tap_type            TEXT NOT NULL CHECK (tap_type IN ('entry', 'payment', 'top_up', 'balance_check')),
  amount_hellers      INT NOT NULL DEFAULT 0, -- 0 for entry/balance_check; negative for payment; positive for top_up
  balance_after_hellers INT NOT NULL,
  terminal_id         TEXT NOT NULL,          -- Reader ID (scanner or cashless terminal)
  location_label      TEXT,                   -- 'gate-A', 'bar-3', 'merch-tent', etc.
  status              TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'denied', 'error')),
  deny_reason         TEXT,
  tapped_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Top-up log: wristband credit loads (card, cash, voucher)
CREATE TABLE IF NOT EXISTS rfid.rfid_top_ups (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wristband_id        UUID NOT NULL REFERENCES rfid.rfid_wristbands(id),
  amount_hellers      INT NOT NULL CHECK (amount_hellers > 0),
  payment_method      TEXT NOT NULL CHECK (payment_method IN ('card', 'cash', 'voucher', 'promo')),
  external_payment_id TEXT,                   -- Stripe/GoPay tx ID for card top-ups
  processed_by        UUID,                   -- Staff user UUID
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_rfid_wristbands_event ON rfid.rfid_wristbands(event_id);
CREATE INDEX idx_rfid_wristbands_uid ON rfid.rfid_wristbands(uid);
CREATE INDEX idx_rfid_taps_wristband ON rfid.rfid_taps(wristband_id);
CREATE INDEX idx_rfid_taps_tapped_at ON rfid.rfid_taps(tapped_at);
CREATE INDEX idx_rfid_top_ups_wristband ON rfid.rfid_top_ups(wristband_id);
