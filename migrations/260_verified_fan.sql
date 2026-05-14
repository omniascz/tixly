-- Verified Fan — Ticketmaster-style pre-registration před onsale.
--
-- Flow:
--   1. Promotér zapne verified_fan_enabled na events
--   2. Před onsale: buyer apply (verified_fan_requests, status='pending')
--   3. Promotér schvaluje (manual nebo auto-rules) → status='approved' +
--      vygeneruje unique presale_code (single-use)
--   4. Presale window: jen approved fans s codem můžou koupit
--   5. Code se markne 'used' po prvním nákupu
--
-- Anti-bot: code je per-user, nelze sdílet (skener loguje original_owner při
-- check-in pro audit).

BEGIN;

ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS verified_fan_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS verified_fan_presale_starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_fan_presale_ends_at TIMESTAMPTZ;

CREATE TABLE marketing.verified_fan_requests (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID         NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  event_id        UUID         NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  status          TEXT         NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'used')),
  presale_code    TEXT UNIQUE,
  approved_at     TIMESTAMPTZ,
  rejected_reason TEXT,
  used_order_id   UUID,
  used_at         TIMESTAMPTZ,
  fan_motivation  TEXT,                -- "Proč chci jít" volné pole
  email_domain    TEXT,                -- pro auto-rules
  user_age_days   INTEGER,             -- věk účtu — anti-fresh-account
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_verified_fan_request UNIQUE (user_id, event_id)
);

CREATE INDEX idx_verified_fan_event_status
  ON marketing.verified_fan_requests (event_id, status, created_at DESC);

CREATE INDEX idx_verified_fan_code
  ON marketing.verified_fan_requests (presale_code)
  WHERE presale_code IS NOT NULL;

COMMENT ON TABLE marketing.verified_fan_requests IS
  'Pre-registration před onsale. Po schválení dostane fan presale_code (single-use).';

COMMIT;
