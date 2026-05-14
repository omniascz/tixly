-- PSD2 OAuth2 — refresh token storage + consent tracking.
--
-- Bank API providers:
--   - KB: https://api.kb.cz (OAuth2 Authorization Code Flow, AISP scope)
--   - ČSOB: https://api.csob.cz (OAuth2 + eIDAS QWAC cert)
--   - ČS (Erste): https://api.erstegroup.com
--
-- Consent typically expires 90/180 days — user musí re-authorize.

BEGIN;

ALTER TABLE platform.bank_credentials
  ADD COLUMN IF NOT EXISTS refresh_token_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS access_token_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS access_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consent_id TEXT,
  ADD COLUMN IF NOT EXISTS consent_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS oauth_state TEXT;          -- ephemeral state pro callback

CREATE INDEX IF NOT EXISTS idx_bank_creds_consent_expiring
  ON platform.bank_credentials (consent_expires_at)
  WHERE consent_expires_at IS NOT NULL AND active = TRUE;

COMMENT ON COLUMN platform.bank_credentials.refresh_token_encrypted IS
  'AES-256-GCM encrypted refresh token. Pro PSD2 banky které refresh token vystavují.';
COMMENT ON COLUMN platform.bank_credentials.consent_expires_at IS
  'Kdy končí PSD2 consent (typicky 90 dní). Před expirací promotér musí re-authorize.';

COMMIT;
