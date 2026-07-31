-- Partner POS network — partnerská prodejní místa (knihkupectví, info centra,
-- benzínky, cestovky). Mají vlastní API token, prodávají vstupenky z centrální
-- databáze. Provize partnerovi se hradí z provize platformy (nezatěžuje promotéra).
--
-- Flow:
--   1. Super Admin registruje partnera (Tixly partner program)
--   2. Partner dostane API token (long-lived)
--   3. POST /api/partner/sales s token v Authorization header → vytvoří order
--      payment_provider='partner_pos', status='paid', issue tickets
--   4. Partner accumuluje provizi v platform.partner_settlements (per měsíc)

BEGIN;

CREATE SCHEMA IF NOT EXISTS partner;

CREATE TABLE partner.partners (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT         NOT NULL,
  legal_name      TEXT,
  ico             TEXT,
  dic             TEXT,
  contact_email   TEXT         NOT NULL,
  contact_phone   TEXT,
  address         TEXT,
  bank_account    TEXT,
  commission_pct  NUMERIC(5,2) NOT NULL DEFAULT 5.00 CHECK (commission_pct BETWEEN 0 AND 50),
  status          TEXT         NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending', 'active', 'suspended', 'terminated')),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE partner.partner_tokens (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id      UUID         NOT NULL REFERENCES partner.partners(id) ON DELETE CASCADE,
  token_hash      TEXT         NOT NULL UNIQUE,  -- SHA-256 hash (nikdy uložen raw token)
  label           TEXT         NOT NULL,         -- e.g. „POS Brno hlavní nádraží"
  last_used_at    TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_partner_tokens_hash
  ON partner.partner_tokens (token_hash)
  WHERE revoked_at IS NULL;

CREATE INDEX idx_partner_tokens_partner
  ON partner.partner_tokens (partner_id);

CREATE TABLE partner.partner_sales (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id      UUID         NOT NULL REFERENCES partner.partners(id),
  token_id        UUID         REFERENCES partner.partner_tokens(id),
  order_id        UUID         NOT NULL UNIQUE,
  gross_halire    INTEGER      NOT NULL,
  partner_commission_halire INTEGER NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_partner_sales_partner_date
  ON partner.partner_sales (partner_id, created_at DESC);

CREATE TABLE partner.partner_settlements (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id      UUID         NOT NULL REFERENCES partner.partners(id),
  period_from     DATE         NOT NULL,
  period_to       DATE         NOT NULL,
  sales_count     INTEGER      NOT NULL,
  gross_halire    INTEGER      NOT NULL,
  commission_halire INTEGER    NOT NULL,
  status          TEXT         NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'disputed')),
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_partner_settlement_period UNIQUE (partner_id, period_from, period_to)
);

COMMENT ON TABLE partner.partners IS
  'Partner POS network — externí prodejní místa s vlastním API tokenem.';
COMMENT ON COLUMN partner.partner_tokens.token_hash IS
  'SHA-256 hash, raw token se nikdy neukládá. Při validaci porovnáme hash.';
COMMENT ON TABLE partner.partner_sales IS
  'Audit log prodejů přes partner POS — pro vyúčtování commission.';

COMMIT;
