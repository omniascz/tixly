-- =============================================================================
-- Migration 026: Identity Verification — BankID integration
-- Tixly · 2026-04-06
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS identity;

-- -----------------------------------------------------------------------------
-- identity.verified_persons
-- One record per real-world person (deduplicated by bank_id_sub).
-- PII stored encrypted (AES-256-GCM). bank_id_sub is the stable BankID sub claim.
-- -----------------------------------------------------------------------------
CREATE TABLE identity.verified_persons (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Stable sub claim from BankID — unique per real person
  bank_id_sub         TEXT        NOT NULL UNIQUE,

  -- Issuer claim from BankID (bank / aggregator URL)
  bank_id_iss         TEXT        NOT NULL,

  -- eIDAS Level of Assurance: 'loa2' (Substantial) | 'loa3' (High)
  acr                 TEXT        NOT NULL,

  -- PII encrypted with AES-256-GCM.
  -- Column format: base64( iv[12 bytes] || ciphertext || authTag[16 bytes] )
  first_name_enc      TEXT        NOT NULL,
  last_name_enc       TEXT        NOT NULL,
  birthdate_enc       TEXT        NOT NULL,   -- encrypted YYYY-MM-DD string
  idcard_expiry_enc   TEXT,                   -- nullable: person may have no id card on file

  -- Operational metadata
  verified_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ,            -- NULL = no expiry; otherwise re-verify date
  is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- identity.user_verifications
-- Links a platform user_id to a verified_person record.
-- Supports GDPR soft-unlink via unlinked_at.
-- -----------------------------------------------------------------------------
CREATE TABLE identity.user_verifications (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL,   -- references identity.users.id (cross-schema, no FK)
  verified_person_id    UUID        NOT NULL REFERENCES identity.verified_persons(id),
  linked_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unlinked_at           TIMESTAMPTZ,            -- soft-unlink (GDPR right to erasure)

  -- One active verification record per user
  CONSTRAINT uq_user_verification_active UNIQUE (user_id)
);

-- -----------------------------------------------------------------------------
-- identity.bankid_auth_sessions
-- PKCE + CSRF state backup in DB (primary store is Redis, TTL 10 min).
-- code_verifier stored encrypted (same encryptPii helper).
-- -----------------------------------------------------------------------------
CREATE TABLE identity.bankid_auth_sessions (
  state           TEXT        PRIMARY KEY,    -- CSRF token (32-byte base64url)
  user_id         UUID        NOT NULL,
  code_verifier   TEXT        NOT NULL,       -- PKCE verifier stored encrypted
  redirect_after  TEXT,                       -- destination after successful verification
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL        -- NOW() + 10 min
);

-- -----------------------------------------------------------------------------
-- identity.verification_attempts
-- Audit log of all verification attempts (initiated, success, failed, …).
-- -----------------------------------------------------------------------------
CREATE TABLE identity.verification_attempts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL,
  provider        TEXT        NOT NULL DEFAULT 'bankid',
  outcome         TEXT        NOT NULL CHECK (outcome IN (
                                  'initiated', 'success', 'failed', 'expired', 'cancelled'
                              )),
  failure_reason  TEXT,
  ip_address      INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- Indexes
-- =============================================================================

CREATE INDEX idx_user_verifications_user_id
  ON identity.user_verifications (user_id);

CREATE INDEX idx_verification_attempts_user_id_outcome
  ON identity.verification_attempts (user_id, outcome);

CREATE INDEX idx_bankid_auth_sessions_expires_at
  ON identity.bankid_auth_sessions (expires_at);

-- =============================================================================
-- Auto-update updated_at on verified_persons
-- =============================================================================

CREATE OR REPLACE FUNCTION identity.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_verified_persons_updated_at
  BEFORE UPDATE ON identity.verified_persons
  FOR EACH ROW EXECUTE FUNCTION identity.set_updated_at();
