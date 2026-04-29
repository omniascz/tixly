-- Migration 102: OAuth 2.0 provider — clients, authorization codes, tokens
CREATE SCHEMA IF NOT EXISTS oauth;

CREATE TABLE oauth.clients (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           VARCHAR(100) NOT NULL UNIQUE,
  client_secret_hash  VARCHAR(64),                -- SHA-256 hex; NULL for public clients
  client_type         VARCHAR(20) NOT NULL CHECK (client_type IN ('confidential','public')),
  name                VARCHAR(200) NOT NULL,
  redirect_uris       TEXT[] NOT NULL DEFAULT '{}',
  allowed_grant_types TEXT[] NOT NULL DEFAULT '{}',
  allowed_scopes      TEXT[] NOT NULL DEFAULT '{}',
  promoter_id         UUID,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE oauth.authorization_codes (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash              VARCHAR(64) NOT NULL UNIQUE,
  client_id              VARCHAR(100) NOT NULL REFERENCES oauth.clients(client_id),
  user_id                UUID NOT NULL,
  redirect_uri           TEXT NOT NULL,
  scopes                 TEXT[] NOT NULL DEFAULT '{}',
  code_challenge         TEXT NOT NULL,
  code_challenge_method  VARCHAR(10) NOT NULL CHECK (code_challenge_method IN ('plain','S256')),
  expires_at             TIMESTAMPTZ NOT NULL,
  used_at                TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON oauth.authorization_codes (expires_at);

CREATE TABLE oauth.access_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  VARCHAR(64) NOT NULL UNIQUE,
  client_id   VARCHAR(100) NOT NULL REFERENCES oauth.clients(client_id),
  user_id     UUID,                          -- NULL for client_credentials
  scopes      TEXT[] NOT NULL DEFAULT '{}',
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON oauth.access_tokens (client_id, expires_at);
CREATE INDEX ON oauth.access_tokens (user_id) WHERE user_id IS NOT NULL;

CREATE TABLE oauth.refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  VARCHAR(64) NOT NULL UNIQUE,
  client_id   VARCHAR(100) NOT NULL REFERENCES oauth.clients(client_id),
  user_id     UUID NOT NULL,
  scopes      TEXT[] NOT NULL DEFAULT '{}',
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON oauth.refresh_tokens (user_id, client_id);
