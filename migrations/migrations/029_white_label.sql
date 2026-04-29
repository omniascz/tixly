-- Migration 029: White-Label — theme systém a vlastní domény
-- Navazuje na: platform.promoters (slug, id)

-- ── platform.tenant_themes ──────────────────────────────────────────────────
CREATE TABLE platform.tenant_themes (
  promoter_id       UUID PRIMARY KEY REFERENCES platform.promoters(id) ON DELETE CASCADE,
  logo_url          TEXT,
  favicon_url       TEXT,
  hero_image_url    TEXT,
  primary_color     CHAR(7),
  secondary_color   CHAR(7),
  accent_color      CHAR(7),
  font_family       TEXT,                    -- Google Fonts název (whitelist 50)
  footer_text       TEXT,                    -- max 500 znaků, Pro+
  powered_by_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  custom_css        TEXT,                    -- max 50 KB, Enterprise, sanitizováno
  plan_tier         TEXT NOT NULL DEFAULT 'starter'
                    CHECK (plan_tier IN ('starter', 'pro', 'enterprise')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tenant_themes_updated ON platform.tenant_themes(updated_at DESC);

-- ── platform.custom_domains ─────────────────────────────────────────────────
CREATE TABLE platform.custom_domains (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id               UUID NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  domain                    TEXT NOT NULL,
  verification_token        TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  verified_at               TIMESTAMPTZ,
  verification_attempts     INT NOT NULL DEFAULT 0,
  last_verification_attempt TIMESTAMPTZ,
  cf_hostname_id            TEXT,
  ssl_status                TEXT NOT NULL DEFAULT 'pending'
                            CHECK (ssl_status IN ('pending', 'provisioning', 'active', 'failed')),
  ssl_provisioned_at        TIMESTAMPTZ,
  status                    TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'verified', 'active', 'expired', 'disabled')),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT custom_domains_domain_unique UNIQUE (domain)
);

-- Kritický index — hit na každý request v middleware (pouze active domény)
CREATE UNIQUE INDEX idx_custom_domains_domain_active
  ON platform.custom_domains(domain)
  WHERE status = 'active';

-- Index pro cron job verifikace
CREATE INDEX idx_custom_domains_pending
  ON platform.custom_domains(last_verification_attempt)
  WHERE status = 'pending' AND verified_at IS NULL;

-- ── platform.email_sender_configs ───────────────────────────────────────────
CREATE TABLE platform.email_sender_configs (
  promoter_id             UUID PRIMARY KEY REFERENCES platform.promoters(id) ON DELETE CASCADE,
  from_email              TEXT NOT NULL,
  from_name               TEXT NOT NULL,
  reply_to                TEXT,
  provider                TEXT NOT NULL
                          CHECK (provider IN ('sendgrid', 'mailgun', 'ses', 'smtp')),
  api_key_encrypted       TEXT,              -- AES-256-GCM
  smtp_host               TEXT,
  smtp_port               INT,
  smtp_user               TEXT,
  smtp_password_encrypted TEXT,              -- AES-256-GCM
  dns_verified_at         TIMESTAMPTZ,
  test_sent_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
