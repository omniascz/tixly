CREATE SCHEMA IF NOT EXISTS platform;

-- Enum typy
CREATE TYPE platform.promoter_status AS ENUM ('pending', 'active', 'suspended', 'banned', 'closed');
CREATE TYPE platform.kyc_status AS ENUM ('not_started', 'submitted', 'verified', 'rejected');
CREATE TYPE platform.member_role AS ENUM ('owner', 'admin', 'manager', 'finance', 'marketing', 'staff', 'gate');
CREATE TYPE platform.member_status AS ENUM ('invited', 'active', 'deactivated');

-- ─── Promotér (organizace) ───────────────────────────────────────────────────
CREATE TABLE platform.promoters (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Identita
  name              VARCHAR(200) NOT NULL,
  legal_name        VARCHAR(200),
  ico               VARCHAR(20),                     -- IČO (CZ)
  dic               VARCHAR(20),                     -- DIČ (CZ)
  -- Kontakt
  email             VARCHAR(255) NOT NULL,
  phone             VARCHAR(30),
  website           TEXT,
  -- Branding
  logo_url          TEXT,
  brand_colors      JSONB NOT NULL DEFAULT '{}',     -- { "primary": "#fff", "secondary": "#000" }
  slug              VARCHAR(100) UNIQUE,              -- URL slug (subdoména/path)
  -- Stav
  status            platform.promoter_status NOT NULL DEFAULT 'pending',
  kyc_status        platform.kyc_status NOT NULL DEFAULT 'not_started',
  kyc_verified_at   TIMESTAMPTZ,
  kyc_notes         TEXT,                            -- interní poznámky pro admina
  -- Bankovní spojení (pro payouty)
  bank_account_iban VARCHAR(34),
  bank_account_swift VARCHAR(11),
  stripe_account_id VARCHAR(100),                    -- Stripe Connect (budoucí)
  -- Nastavení
  default_currency  CHAR(3) NOT NULL DEFAULT 'CZK',
  timezone          VARCHAR(50) NOT NULL DEFAULT 'Europe/Prague',
  -- Metadata
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Členové promotérského týmu ──────────────────────────────────────────────
CREATE TABLE platform.promoter_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     UUID NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL,                     -- cross-schema ref -> identity.users
  role            platform.member_role NOT NULL DEFAULT 'staff',
  invited_by      UUID,                              -- user_id který pozval
  status          platform.member_status NOT NULL DEFAULT 'active',
  invited_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at    TIMESTAMPTZ,
  deactivated_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_promoter_member UNIQUE (promoter_id, user_id)
);

-- ─── Fee schedule per promotér ───────────────────────────────────────────────
CREATE TABLE platform.fee_schedules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     UUID NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  name            VARCHAR(100) NOT NULL DEFAULT 'default',
  -- Procentuální poplatek (celé číslo: 500 = 5.00 %)
  percentage_fee  INTEGER NOT NULL DEFAULT 500 CHECK (percentage_fee BETWEEN 0 AND 10000),
  -- Fixní poplatek per vstupenka (haléře)
  fixed_fee       INTEGER NOT NULL DEFAULT 0 CHECK (fixed_fee >= 0),
  -- Min/max fee per vstupenka (haléře, NULL = bez limitu)
  min_fee         INTEGER CHECK (min_fee >= 0),
  max_fee         INTEGER CHECK (max_fee >= 0),
  -- Platnost
  valid_from      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until     TIMESTAMPTZ,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fee_min_max CHECK (max_fee IS NULL OR min_fee IS NULL OR min_fee <= max_fee)
);

-- ─── Payouty (tabulka; plná logika přijde v P1-2) ────────────────────────────
CREATE TABLE platform.payouts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id       UUID NOT NULL REFERENCES platform.promoters(id),
  period_from       TIMESTAMPTZ NOT NULL,
  period_to         TIMESTAMPTZ NOT NULL,
  -- Částky (haléře)
  gross_revenue     INTEGER NOT NULL CHECK (gross_revenue >= 0),
  platform_fees     INTEGER NOT NULL CHECK (platform_fees >= 0),
  refunds           INTEGER NOT NULL DEFAULT 0 CHECK (refunds >= 0),
  chargebacks       INTEGER NOT NULL DEFAULT 0 CHECK (chargebacks >= 0),
  rolling_reserve   INTEGER NOT NULL DEFAULT 0 CHECK (rolling_reserve >= 0),
  net_payout        INTEGER NOT NULL,               -- gross - fees - refunds - chargebacks - reserve
  -- Stav
  status            TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'processing', 'paid', 'failed')),
  bank_reference    VARCHAR(100),
  paid_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Platform admin audit log ────────────────────────────────────────────────
CREATE TABLE platform.admin_actions (
  id              BIGSERIAL PRIMARY KEY,
  admin_user_id   UUID NOT NULL,
  action          VARCHAR(100) NOT NULL,   -- 'promoter.approve', 'promoter.suspend', 'payout.approve'
  target_type     VARCHAR(50) NOT NULL,    -- 'promoter', 'event', 'payout'
  target_id       UUID NOT NULL,
  details         JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Indexy ──────────────────────────────────────────────────────────────────
CREATE INDEX idx_promoters_status ON platform.promoters(status);
CREATE INDEX idx_promoters_kyc ON platform.promoters(kyc_status) WHERE kyc_status != 'verified';
CREATE INDEX idx_promoters_slug ON platform.promoters(slug) WHERE slug IS NOT NULL;
CREATE INDEX idx_members_user ON platform.promoter_members(user_id, status);
CREATE INDEX idx_members_promoter ON platform.promoter_members(promoter_id, role, status);
CREATE INDEX idx_fee_active ON platform.fee_schedules(promoter_id, is_active) WHERE is_active = TRUE;
CREATE INDEX idx_payouts_promoter ON platform.payouts(promoter_id, status);
CREATE INDEX idx_admin_actions_target ON platform.admin_actions(target_type, target_id);
CREATE INDEX idx_admin_actions_admin ON platform.admin_actions(admin_user_id, created_at DESC);
