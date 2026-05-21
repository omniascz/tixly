-- 295_safetix_nfc_wallet_push.sql
-- TM Parity Fáze 5 — SafeTix-grade:
-- 1. NFC tap-to-enter (signed short-lived payloads)
-- 2. Apple Wallet push updates (APNs registration per pass)
-- 3. Device binding (first-view fingerprint lock)
-- 4. Anti-fraud scan audit

BEGIN;

-- ============================================================
-- 1. NFC Taps Log (audit signed NFC payloads)
-- ============================================================
CREATE TABLE IF NOT EXISTS tickets.nfc_taps (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       uuid NOT NULL REFERENCES tickets.tickets(id) ON DELETE CASCADE,
  payload_id      uuid NOT NULL,              -- jti claim z NFC JWT
  issued_at       timestamptz NOT NULL,
  expires_at      timestamptz NOT NULL,
  consumed_at     timestamptz,
  scanned_by_user_id uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  gate_id         uuid,
  device_id       text,
  result          text CHECK (result IN ('admitted', 'expired', 'replay', 'invalid_signature', 'wrong_promoter')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nfc_taps_ticket
  ON tickets.nfc_taps(ticket_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_nfc_taps_payload
  ON tickets.nfc_taps(payload_id);

COMMENT ON TABLE tickets.nfc_taps IS
  'Audit log NFC tap events. Replay protection přes UNIQUE payload_id.';

-- ============================================================
-- 2. Apple Wallet push subscriptions
-- ============================================================
-- Když uživatel přidá .pkpass do Apple Wallet, Apple zavolá náš
-- webservice URL a zaregistruje device push token. Pak můžeme pushnout
-- update přes APNs když se změní seat / cancellation / gate.
CREATE TABLE IF NOT EXISTS tickets.wallet_push_subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       uuid NOT NULL REFERENCES tickets.tickets(id) ON DELETE CASCADE,
  serial_number   text NOT NULL,              -- ticket_id v pkpass
  pass_type_id    text NOT NULL,              -- "pass.cz.tixly.event"
  device_library_id text NOT NULL,            -- Apple device library identifier
  push_token      text NOT NULL,
  registered_at   timestamptz NOT NULL DEFAULT now(),
  unregistered_at timestamptz,
  UNIQUE (device_library_id, pass_type_id, serial_number)
);

CREATE INDEX IF NOT EXISTS idx_wallet_push_active
  ON tickets.wallet_push_subscriptions(ticket_id) WHERE unregistered_at IS NULL;

-- Pending wallet updates (queue pro background push)
CREATE TABLE IF NOT EXISTS tickets.wallet_push_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       uuid NOT NULL REFERENCES tickets.tickets(id) ON DELETE CASCADE,
  reason          text NOT NULL,              -- 'seat_changed' | 'gate_changed' | 'cancelled' | 'venue_changed' | 'reminder'
  payload         jsonb NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  attempts        integer NOT NULL DEFAULT 0,
  scheduled_for   timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_push_jobs_pending
  ON tickets.wallet_push_jobs(scheduled_for) WHERE status = 'pending';

COMMENT ON TABLE tickets.wallet_push_jobs IS
  'Queue Apple Wallet push updates. Cron processor čte WHERE status=pending AND scheduled_for <= now().';

-- ============================================================
-- 3. Device Binding (first-view fingerprint lock)
-- ============================================================
-- Tickets už mají device_binding_id sloupec. Tady přidáme audit table
-- s fingerprint history (pro fraud detection a unbind requests).
CREATE TABLE IF NOT EXISTS tickets.device_binding_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       uuid NOT NULL REFERENCES tickets.tickets(id) ON DELETE CASCADE,
  device_fingerprint text NOT NULL,
  action          text NOT NULL CHECK (action IN ('bound', 'unbound', 'attempted_bind_different')),
  ip_hash         text,
  user_agent      text,
  bound_by_user_id uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_binding_log_ticket
  ON tickets.device_binding_log(ticket_id, created_at DESC);

-- Pass updates log (pro buyer "tvůj pass byl aktualizován" notifikace)
CREATE TABLE IF NOT EXISTS tickets.pass_updates_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       uuid NOT NULL REFERENCES tickets.tickets(id) ON DELETE CASCADE,
  field_changed   text NOT NULL,              -- 'seat', 'gate', 'event_date', 'cancelled'
  old_value       text,
  new_value       text,
  changed_by_user_id uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  pass_pushed_at  timestamptz,                -- kdy Apple/Google ack přišlo
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pass_updates_ticket
  ON tickets.pass_updates_log(ticket_id, created_at DESC);

INSERT INTO public.schema_migrations (filename)
VALUES ('295_safetix_nfc_wallet_push.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
