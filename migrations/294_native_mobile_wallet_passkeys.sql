-- 294_native_mobile_wallet_passkeys.sql
-- TM Parity Fáze 4 — Native mobile parity:
-- 1. Google Wallet pass tracking
-- 2. P2P ticket transfers (one-tap transfer)
-- 3. WebAuthn passkeys (biometric login on mobile)

BEGIN;

-- ============================================================
-- 1. Wallet pass issuance log (Apple + Google)
-- ============================================================
CREATE TABLE IF NOT EXISTS tickets.wallet_passes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       uuid NOT NULL REFERENCES tickets.tickets(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  platform        text NOT NULL CHECK (platform IN ('apple', 'google')),
  serial_number   text NOT NULL,
  issued_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  user_agent      text,
  UNIQUE (ticket_id, platform, serial_number)
);

CREATE INDEX IF NOT EXISTS idx_wallet_passes_ticket
  ON tickets.wallet_passes(ticket_id) WHERE revoked_at IS NULL;

COMMENT ON TABLE tickets.wallet_passes IS
  'Audit log issued Apple/Google Wallet passes. Pro pass updates / revoke.';

-- ============================================================
-- 2. P2P Transfer Invitations (TM-style one-tap transfer)
-- Existing tickets.ticket_transfers je audit log po dokončení;
-- transfer_invitations je pending state mezi from_user → to_email.
-- ============================================================
CREATE TABLE IF NOT EXISTS tickets.transfer_invitations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       uuid NOT NULL REFERENCES tickets.tickets(id) ON DELETE CASCADE,
  from_user_id    uuid NOT NULL REFERENCES identity.users(id) ON DELETE SET NULL,
  to_user_id      uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  to_email        text NOT NULL,
  to_phone        text,
  -- Recipient nemusí mít účet → invite token v URL
  invite_token    text UNIQUE NOT NULL,
  message         text,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'accepted', 'cancelled', 'expired')),
  expires_at      timestamptz NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  accepted_at     timestamptz,
  cancelled_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transfer_invitations_ticket
  ON tickets.transfer_invitations(ticket_id);
CREATE INDEX IF NOT EXISTS idx_transfer_invitations_recipient
  ON tickets.transfer_invitations(to_email, status);
CREATE INDEX IF NOT EXISTS idx_transfer_invitations_token
  ON tickets.transfer_invitations(invite_token) WHERE status = 'pending';

COMMENT ON TABLE tickets.transfer_invitations IS
  'TM-style one-tap P2P transfer. Recipient přijme přes invite_token URL. Po accept se zapíše do tickets.ticket_transfers.';

-- ============================================================
-- 3. WebAuthn Passkeys (FIDO2 — biometric login)
-- ============================================================
CREATE TABLE IF NOT EXISTS identity.webauthn_credentials (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  credential_id       bytea NOT NULL UNIQUE,
  public_key          bytea NOT NULL,
  counter             bigint NOT NULL DEFAULT 0,
  -- "Touch ID on iPhone 15", "Windows Hello on laptop"
  device_name         text,
  transports          text[],
  -- AAGUID identifies authenticator model (Apple, Yubico, Windows)
  aaguid              uuid,
  is_backup_eligible  boolean NOT NULL DEFAULT false,
  is_backup_state     boolean NOT NULL DEFAULT false,
  last_used_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webauthn_user
  ON identity.webauthn_credentials(user_id);

-- WebAuthn challenges (krátkodobé, vyžadované pro registration / authentication)
CREATE TABLE IF NOT EXISTS identity.webauthn_challenges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES identity.users(id) ON DELETE CASCADE,
  challenge       bytea NOT NULL,
  challenge_type  text NOT NULL CHECK (challenge_type IN ('registration', 'authentication')),
  expires_at      timestamptz NOT NULL DEFAULT (now() + INTERVAL '5 minutes'),
  consumed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expiry
  ON identity.webauthn_challenges(expires_at);

COMMENT ON TABLE identity.webauthn_credentials IS
  'FIDO2/WebAuthn passkeys. Mobile Touch ID, Face ID, Windows Hello, security keys.';

-- ============================================================
-- 4. Push tokens (rozšířeno pro APNs + FCM kromě VAPID web push)
-- ============================================================
CREATE TABLE IF NOT EXISTS identity.native_push_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  platform        text NOT NULL CHECK (platform IN ('apns', 'fcm')),
  token           text NOT NULL,
  app_version     text,
  device_id       text,
  last_active_at  timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, token)
);

CREATE INDEX IF NOT EXISTS idx_native_push_tokens_user
  ON identity.native_push_tokens(user_id, platform);

COMMENT ON TABLE identity.native_push_tokens IS
  'Native APNs (iOS) + FCM (Android) push tokens. Doplňuje existující VAPID web push.';

INSERT INTO public.schema_migrations (filename)
VALUES ('294_native_mobile_wallet_passkeys.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
