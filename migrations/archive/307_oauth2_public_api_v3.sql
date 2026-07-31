-- 307_oauth2_public_api_v3.sql
-- Eventbrite Parity Fáze EB3 — Public REST API + OAuth 2.0:
-- 1. OAuth 2.0 clients (3rd party apps registrované promotéry/master adminem)
-- 2. Authorization codes (krátkodobé, exchange za access_token)
-- 3. Access tokens + refresh tokens
-- 4. API rate limit log (per-client)
-- 5. Webhook subscriptions per client

BEGIN;

-- ============================================================
-- 1. OAuth 2.0 Clients
-- ============================================================
CREATE TABLE IF NOT EXISTS b2b.oauth_clients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Owner: promotér registruje vlastní app NEBO master admin platform-wide
  owner_promoter_id uuid REFERENCES platform.promoters(id) ON DELETE CASCADE,
  owner_user_id   uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  -- App identity
  client_id       text NOT NULL UNIQUE,        -- veřejný (např. "tixly_app_abc123")
  client_secret_hash text NOT NULL,             -- SHA-256 hash, nikdy plain
  app_name        text NOT NULL,
  app_description text,
  app_homepage_url text,
  app_logo_url    text,
  -- OAuth config
  redirect_uris   text[] NOT NULL,              -- whitelist callback URLs
  allowed_scopes  text[] NOT NULL DEFAULT ARRAY['read_events', 'read_orders'],
  grant_types     text[] NOT NULL DEFAULT ARRAY['authorization_code', 'refresh_token'],
  -- Lifecycle
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- Rate limit per client (overridable)
  rate_limit_per_hour integer NOT NULL DEFAULT 1000
);

CREATE INDEX IF NOT EXISTS idx_oauth_clients_owner
  ON b2b.oauth_clients(owner_promoter_id);

COMMENT ON TABLE b2b.oauth_clients IS
  '3rd party apps registered against Tixly API. Promotér nebo platform admin owns.';

-- ============================================================
-- 2. Authorization Codes (krátkodobé)
-- ============================================================
CREATE TABLE IF NOT EXISTS b2b.oauth_authorization_codes (
  code            text PRIMARY KEY,             -- random opaque
  client_id       uuid NOT NULL REFERENCES b2b.oauth_clients(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  promoter_id     uuid REFERENCES platform.promoters(id) ON DELETE CASCADE,
  redirect_uri    text NOT NULL,                -- verifikace v /token
  scopes          text[] NOT NULL,
  code_challenge  text,                         -- PKCE S256
  code_challenge_method text CHECK (code_challenge_method IN (NULL, 'plain', 'S256')),
  expires_at      timestamptz NOT NULL DEFAULT (now() + INTERVAL '10 minutes'),
  consumed_at     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_oauth_codes_expiry
  ON b2b.oauth_authorization_codes(expires_at) WHERE consumed_at IS NULL;

-- ============================================================
-- 3. Access Tokens
-- ============================================================
CREATE TABLE IF NOT EXISTS b2b.oauth_access_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash      text NOT NULL UNIQUE,         -- SHA-256, plain je v "tk_..." formátu
  client_id       uuid NOT NULL REFERENCES b2b.oauth_clients(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES identity.users(id) ON DELETE CASCADE,
  promoter_id     uuid REFERENCES platform.promoters(id) ON DELETE CASCADE,
  scopes          text[] NOT NULL,
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  last_used_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_active
  ON b2b.oauth_access_tokens(client_id, expires_at) WHERE revoked_at IS NULL;

-- ============================================================
-- 4. Refresh Tokens
-- ============================================================
CREATE TABLE IF NOT EXISTS b2b.oauth_refresh_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash      text NOT NULL UNIQUE,
  access_token_id uuid REFERENCES b2b.oauth_access_tokens(id) ON DELETE CASCADE,
  client_id       uuid NOT NULL REFERENCES b2b.oauth_clients(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  promoter_id     uuid REFERENCES platform.promoters(id) ON DELETE CASCADE,
  scopes          text[] NOT NULL,
  expires_at      timestamptz NOT NULL DEFAULT (now() + INTERVAL '90 days'),
  revoked_at      timestamptz,
  rotated_to_id   uuid REFERENCES b2b.oauth_refresh_tokens(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oauth_refresh_active
  ON b2b.oauth_refresh_tokens(client_id) WHERE revoked_at IS NULL;

-- ============================================================
-- 5. API Rate Limit Log (per-client sliding window)
-- ============================================================
CREATE TABLE IF NOT EXISTS b2b.api_rate_limit_log (
  id              bigserial PRIMARY KEY,
  client_id       uuid REFERENCES b2b.oauth_clients(id) ON DELETE CASCADE,
  api_key_id      uuid REFERENCES b2b.api_keys(id) ON DELETE CASCADE,
  endpoint        text NOT NULL,
  method          text NOT NULL,
  response_status integer,
  duration_ms     integer,
  -- Identifier (jeden z client_id / api_key_id musí být NOT NULL)
  CHECK (client_id IS NOT NULL OR api_key_id IS NOT NULL),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_log_client_time
  ON b2b.api_rate_limit_log(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rate_limit_log_apikey_time
  ON b2b.api_rate_limit_log(api_key_id, created_at DESC);

COMMENT ON TABLE b2b.api_rate_limit_log IS
  'Sliding-window rate limit per (client_id OR api_key_id). Cleanup cron drží 24h window.';

-- ============================================================
-- 6. Webhook Subscriptions (Eventbrite-style per-app webhooks)
-- ============================================================
CREATE TABLE IF NOT EXISTS b2b.webhook_subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid REFERENCES b2b.oauth_clients(id) ON DELETE CASCADE,
  api_key_id      uuid REFERENCES b2b.api_keys(id) ON DELETE CASCADE,
  url             text NOT NULL,
  -- Co se subscribe: event_types
  event_types     text[] NOT NULL,              -- ['order.created', 'event.published', 'attendee.checked_in']
  -- Pro signed payloady
  signing_secret_hash text NOT NULL,
  status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'paused', 'failed')),
  -- Health
  last_delivery_at timestamptz,
  last_delivery_status integer,
  consecutive_failures integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (client_id IS NOT NULL OR api_key_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_webhook_subs_active
  ON b2b.webhook_subscriptions(status) WHERE status = 'active';

-- Webhook delivery log
CREATE TABLE IF NOT EXISTS b2b.webhook_deliveries (
  id              bigserial PRIMARY KEY,
  subscription_id uuid NOT NULL REFERENCES b2b.webhook_subscriptions(id) ON DELETE CASCADE,
  event_type      text NOT NULL,
  payload         jsonb NOT NULL,
  response_status integer,
  response_ms     integer,
  attempt         integer NOT NULL DEFAULT 1,
  delivered_at    timestamptz,
  failed_at       timestamptz,
  next_retry_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_pending
  ON b2b.webhook_deliveries(next_retry_at)
  WHERE delivered_at IS NULL AND failed_at IS NULL;

INSERT INTO public.schema_migrations (filename)
VALUES ('307_oauth2_public_api_v3.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
