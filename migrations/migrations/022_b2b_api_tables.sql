-- =============================================================================
-- MIGRACE 022: B2B API — API klíče, webhooky, audit log
-- Datum: 2026-04-06
-- Důvod: Task #58 — B2B API implementace
--   Tabulky pro API key management, rate limit tracking,
--   webhook endpointy a doručovací frontu.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. platform.api_keys — API klíče pro B2B partnery
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.api_keys (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     UUID          NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  name            VARCHAR(200)  NOT NULL,
  key_prefix      VARCHAR(20)   NOT NULL,          -- 'tick_live_Ab3xYz' — pro UI zobrazení
  key_hash        TEXT          NOT NULL UNIQUE,   -- SHA-256 raw klíče (nikdy plaintext)
  scopes          TEXT[]        NOT NULL DEFAULT '{}',
  environment     TEXT          NOT NULL DEFAULT 'test'
                    CHECK (environment IN ('live', 'test')),
  tier            TEXT          NOT NULL DEFAULT 'free'
                    CHECK (tier IN ('free', 'standard', 'premium')),
  ip_whitelist    TEXT[],                          -- NULL = bez omezení IP
  last_used_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,                     -- NULL = nikdy
  status          TEXT          NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'revoked', 'expired')),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  revoked_at      TIMESTAMPTZ,
  revoked_reason  TEXT
);

COMMENT ON TABLE platform.api_keys IS
  'API klíče pro B2B integrátory (POS systémy, partneři, agenti).
   Raw klíč se ukládá pouze při generování — poté jen SHA-256 hash.
   Formát klíče: tick_live_<20 znaků base64url> nebo tick_test_<20 znaků>.';

COMMENT ON COLUMN platform.api_keys.key_prefix IS
  'Prvních 6 znaků náhodné části — zobrazuje se v UI pro identifikaci klíče.
   Příklad: tick_live_Ab3xYz... Nikdy neobsahuje celý klíč.';

COMMENT ON COLUMN platform.api_keys.scopes IS
  'Pole oprávnění. Dostupné scopes:
   read:events, write:events, write:orders, read:orders,
   read:reports, manage:webhooks, read:tickets, admin:keys.';

CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash
  ON platform.api_keys(key_hash);

CREATE INDEX IF NOT EXISTS idx_api_keys_promoter_status
  ON platform.api_keys(promoter_id, status);

CREATE INDEX IF NOT EXISTS idx_api_keys_active
  ON platform.api_keys(key_hash, status, expires_at)
  WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- 2. platform.api_key_audit_log — audit každého použití klíče
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.api_key_audit_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id  UUID        NOT NULL REFERENCES platform.api_keys(id) ON DELETE CASCADE,
  event       TEXT        NOT NULL
    CHECK (event IN (
      'created',
      'used',
      'revoked',
      'rate_limit_hit',
      'ip_blocked',
      'scope_denied',
      'expired'
    )),
  ip_address  TEXT,       -- IPv4/IPv6 jako text (GDPR: raw IP — zvážit hashing v budoucnu)
  user_agent  TEXT,
  endpoint    TEXT,       -- '/api/v1/orders'
  http_method TEXT,       -- 'GET', 'POST', ...
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE platform.api_key_audit_log IS
  'Immutable audit log každého použití API klíče.
   Slouží pro billing, abuse detekci a compliance.';

CREATE INDEX IF NOT EXISTS idx_api_key_audit_log_key_id
  ON platform.api_key_audit_log(api_key_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_key_audit_log_event
  ON platform.api_key_audit_log(event, created_at DESC)
  WHERE event IN ('rate_limit_hit', 'ip_blocked', 'scope_denied');

-- ---------------------------------------------------------------------------
-- 3. platform.webhook_endpoints — URL endpointy příjemců webhooků
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.webhook_endpoints (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id      UUID        NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  url              TEXT        NOT NULL,
  description      TEXT,
  events           TEXT[]      NOT NULL DEFAULT '{}',
  signing_secret   TEXT        NOT NULL,   -- HMAC-SHA256 tajný klíč (AES-256-GCM šifrovaný)
  status           TEXT        NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'disabled', 'auto_disabled')),
  failure_count    INTEGER     NOT NULL DEFAULT 0,
  last_success_at  TIMESTAMPTZ,
  last_failure_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE platform.webhook_endpoints IS
  'Webhook endpointy pro doručování eventů B2B partnerům.
   signing_secret je AES-256-GCM šifrovaný — dešifruje se jen při podpisu.
   Po 50 neúspěších se endpoint auto_disabled.';

COMMENT ON COLUMN platform.webhook_endpoints.events IS
  'Subscribované event typy. Příklad: {order.paid, ticket.scanned}.
   Prázdné pole = všechny eventy promotéra.';

CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_promoter
  ON platform.webhook_endpoints(promoter_id, status);

CREATE TRIGGER trg_webhook_endpoints_updated_at
  BEFORE UPDATE ON platform.webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. platform.webhook_deliveries — fronta doručování
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.webhook_deliveries (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id      UUID        NOT NULL REFERENCES platform.webhook_endpoints(id) ON DELETE CASCADE,
  event_type       TEXT        NOT NULL,
  payload          JSONB       NOT NULL,
  attempt_count    INTEGER     NOT NULL DEFAULT 0,
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status           TEXT        NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'delivered', 'failed', 'abandoned')),
  last_http_status INTEGER,
  last_error       TEXT,
  delivered_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE platform.webhook_deliveries IS
  'Fronta doručování webhooků. At-least-once delivery s exponential backoff.
   Retry plán: 0s → 1min → 5min → 30min → 2h → abandoned.
   Worker dotazuje WHERE status IN (pending, failed) AND next_attempt_at <= NOW().';

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_queue
  ON platform.webhook_deliveries(next_attempt_at, status)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint
  ON platform.webhook_deliveries(endpoint_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 5. Ověření
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'platform' AND table_name = 'api_keys'
  ), 'CHYBA: platform.api_keys neexistuje';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'platform' AND table_name = 'webhook_endpoints'
  ), 'CHYBA: platform.webhook_endpoints neexistuje';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'platform' AND table_name = 'webhook_deliveries'
  ), 'CHYBA: platform.webhook_deliveries neexistuje';

  RAISE NOTICE 'Migrace 022 úspěšně ověřena — B2B API tabulky přidány.';
END;
$$;

COMMIT;
