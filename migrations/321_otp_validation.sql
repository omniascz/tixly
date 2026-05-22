-- 321_otp_validation.sql
-- CZ priority #3 (ROI 7/10): OTP SMS validation v checkout pro anti-bot
-- a anti-scalp ochranu top eventů (Karel Gott reissue, Helena Vondráčková
-- farewell tour, festivalové announcements). IT Legge 232/2016 to vyžaduje
-- mandatory; CZ voluntary per-event toggle.
--
-- Idempotent.

BEGIN;

-- Per-event toggle (promotér nastaví pro top eventy)
ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS requires_otp_validation boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN catalog.events.requires_otp_validation IS
  'Pokud true, buyer musí ověřit telefon SMS OTP před checkout submitem. '
  'Anti-bot ochrana pro top eventy s vysokou poptávkou.';

-- OTP code storage (TTL 10 min)
CREATE TABLE IF NOT EXISTS marketing.otp_codes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164   text NOT NULL,
  code_hash    text NOT NULL,        -- bcrypt nebo SHA-256 hash (ne plain code)
  event_id     uuid REFERENCES catalog.events(id) ON DELETE CASCADE,
  attempts     integer NOT NULL DEFAULT 0,
  verified_at  timestamptz,
  expires_at   timestamptz NOT NULL DEFAULT now() + INTERVAL '10 minutes',
  token        text,                  -- generated po verify, used jako otpToken v checkout
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_otp_codes_phone
  ON marketing.otp_codes(phone_e164, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_otp_codes_token
  ON marketing.otp_codes(token) WHERE token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_otp_codes_expires
  ON marketing.otp_codes(expires_at);

-- Rate limiting (max 3 OTP requests per phone per 10 min)
CREATE OR REPLACE FUNCTION marketing.check_otp_rate_limit(p_phone text) RETURNS boolean AS $$
DECLARE recent_count integer;
BEGIN
  SELECT COUNT(*) INTO recent_count FROM marketing.otp_codes
   WHERE phone_e164 = p_phone AND created_at > NOW() - INTERVAL '10 minutes';
  RETURN recent_count < 3;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION marketing.check_otp_rate_limit IS
  'Returns true pokud phone má < 3 OTP requests v posledních 10 min';

COMMIT;
