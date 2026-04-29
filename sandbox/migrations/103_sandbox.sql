-- Migration 103: Sandbox environment for developers
CREATE SCHEMA IF NOT EXISTS sandbox;

CREATE TABLE sandbox.tenants (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           VARCHAR(200) NOT NULL,
  owner_email    VARCHAR(200) NOT NULL,
  sandbox_key    VARCHAR(100) NOT NULL UNIQUE,
  schema_prefix  VARCHAR(50) NOT NULL UNIQUE,
  expires_at     TIMESTAMPTZ NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON sandbox.tenants (owner_email, is_active, expires_at);

-- Seeded data tables (minimal denormalized form — production would use real schemas)
CREATE TABLE sandbox.seeded_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES sandbox.tenants(id) ON DELETE CASCADE,
  name           VARCHAR(200) NOT NULL,
  venue          VARCHAR(200) NOT NULL,
  starts_at      TIMESTAMPTZ NOT NULL,
  price_hellers  INTEGER NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sandbox.seeded_tickets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES sandbox.tenants(id) ON DELETE CASCADE,
  event_id    UUID NOT NULL REFERENCES sandbox.seeded_events(id) ON DELETE CASCADE,
  seat_label  VARCHAR(20) NOT NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'available',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sandbox.seeded_users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES sandbox.tenants(id) ON DELETE CASCADE,
  email      VARCHAR(200) NOT NULL,
  name       VARCHAR(200) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sandbox.seeded_orders (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES sandbox.tenants(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL,
  event_id       UUID NOT NULL,
  total_hellers  INTEGER NOT NULL,
  status         VARCHAR(20) NOT NULL DEFAULT 'paid',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sandbox.seeded_api_keys (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES sandbox.tenants(id) ON DELETE CASCADE,
  api_key    VARCHAR(200) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON sandbox.seeded_events (tenant_id);
CREATE INDEX ON sandbox.seeded_tickets (tenant_id, event_id);
CREATE INDEX ON sandbox.seeded_users (tenant_id);
CREATE INDEX ON sandbox.seeded_orders (tenant_id);
