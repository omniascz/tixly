-- =============================================================================
-- Migration 158: Passkey / Passwordless Login
-- Feature #45: WebAuthn credentials (Face ID, Touch ID, hardware keys)
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.passkey_credentials (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL,
  credential_id       TEXT NOT NULL UNIQUE,    -- base64url-encoded credential ID from WebAuthn
  public_key_cose     TEXT NOT NULL,           -- COSE-encoded public key (base64url)
  sign_count          BIGINT NOT NULL DEFAULT 0,
  device_type         TEXT NOT NULL DEFAULT 'unknown' CHECK (device_type IN ('platform', 'cross-platform', 'unknown')),
  aaguid              TEXT,                    -- authenticator AAGUID (identifies device model)
  friendly_name       TEXT,                    -- user-set label e.g. "iPhone", "YubiKey"
  backed_up           BOOLEAN NOT NULL DEFAULT false,
  transports          TEXT[] NOT NULL DEFAULT '{}',  -- ['internal','hybrid','usb','nfc','ble']
  last_used_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Challenge store: short-lived nonces for registration and authentication
CREATE TABLE IF NOT EXISTS auth.passkey_challenges (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID,                    -- NULL for registration before user known
  challenge           TEXT NOT NULL UNIQUE,    -- base64url random bytes
  type                TEXT NOT NULL CHECK (type IN ('registration', 'authentication')),
  expires_at          TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '5 minutes',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_passkey_credentials_user ON auth.passkey_credentials(user_id);
CREATE INDEX idx_passkey_challenges_expires ON auth.passkey_challenges(expires_at);
