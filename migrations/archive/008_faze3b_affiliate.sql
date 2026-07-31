-- =============================================================================
-- MIGRACE 008: Schéma pro affiliate-tracking modul
-- Datum: 2026-04-05
-- Modul: C:\Users\omnia\Documents\tixly\affiliate-tracking\
-- Tabulky: affiliate.affiliates, affiliate.links, affiliate.clicks,
--          affiliate.conversions, affiliate.payouts
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS affiliate;

-- ---------------------------------------------------------------------------
-- affiliate.affiliates — partnerské účty
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS affiliate.affiliates (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- cross-schema ref na identity.users — bez FK
  user_id             UUID        NOT NULL,
  -- cross-schema ref na platform.promoters — bez FK (affiliate pracuje pro promotéra)
  promoter_id         UUID        NOT NULL,
  -- Provizní sazba v basis points (500 = 5 %, max 5000 = 50 %)
  commission_rate_bps INTEGER     NOT NULL DEFAULT 500
    CHECK (commission_rate_bps >= 0 AND commission_rate_bps <= 5000),
  -- Peněženka — kumulované nezaplacené komise (halíře)
  wallet_balance      INTEGER     NOT NULL DEFAULT 0 CHECK (wallet_balance >= 0),
  -- Minimální částka pro výplatu (default 1 000 Kč = 100 000 halířů)
  payout_threshold    INTEGER     NOT NULL DEFAULT 100000 CHECK (payout_threshold > 0),
  status              TEXT        NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'closed')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_affiliate_user_promoter UNIQUE (user_id, promoter_id)
);

CREATE TRIGGER trg_affiliate_updated_at
  BEFORE UPDATE ON affiliate.affiliates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- affiliate.links — trackingové URL per affiliate
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS affiliate.links (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id    UUID        NOT NULL REFERENCES affiliate.affiliates(id) ON DELETE CASCADE,
  -- NULL = obecný link (platí pro všechny akce promotéra)
  event_id        UUID,
  -- Base62 kód (8 znaků), unikátní, generovaný kryptograficky
  code            VARCHAR(20) NOT NULL UNIQUE,
  click_count     INTEGER     NOT NULL DEFAULT 0 CHECK (click_count >= 0),
  conversion_count INTEGER    NOT NULL DEFAULT 0 CHECK (conversion_count >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN affiliate.links.code IS
  'Base62 kód (8 znaků) generovaný přes crypto.getRandomValues. Používá se v URL /r/{code}.';

CREATE INDEX IF NOT EXISTS idx_affiliate_links_affiliate_id
  ON affiliate.links(affiliate_id);

CREATE INDEX IF NOT EXISTS idx_affiliate_links_code
  ON affiliate.links(code);

-- ---------------------------------------------------------------------------
-- affiliate.clicks — raw click events (fire-and-forget, INSERT mimo transakci)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS affiliate.clicks (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id     UUID        NOT NULL REFERENCES affiliate.links(id) ON DELETE CASCADE,
  session_id  TEXT,
  referrer    TEXT,
  ip_hash     TEXT,       -- SHA-256 hash IP adresy (GDPR: neukládáme raw IP)
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE affiliate.clicks IS
  'Raw kliknutí na affiliate link. Fire-and-forget INSERT mimo transakci.
   Pro statistiky stačí click_count counter na affiliate.links.';

COMMENT ON COLUMN affiliate.clicks.ip_hash IS
  'SHA-256 hash IP adresy pro fraud detection. Raw IP se neukládá (GDPR).';

CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_link_id
  ON affiliate.clicks(link_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- affiliate.conversions — dokončené konverze (objednávky přes affiliate link)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS affiliate.conversions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id         UUID        NOT NULL REFERENCES affiliate.links(id),
  affiliate_id    UUID        NOT NULL REFERENCES affiliate.affiliates(id),
  -- Idempotency: jedna objednávka = jedna konverze
  order_id        UUID        NOT NULL UNIQUE,
  order_amount    INTEGER     NOT NULL CHECK (order_amount >= 0),
  -- Provize = Math.floor((order_amount * commission_rate_bps) / 10000)
  commission      INTEGER     NOT NULL CHECK (commission >= 0),
  status          TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'reversed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_affiliate_conversions_affiliate_id
  ON affiliate.conversions(affiliate_id, status);

CREATE INDEX IF NOT EXISTS idx_affiliate_conversions_link_id
  ON affiliate.conversions(link_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- affiliate.payouts — žádosti o výplatu
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS affiliate.payouts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id    UUID        NOT NULL REFERENCES affiliate.affiliates(id),
  amount          INTEGER     NOT NULL CHECK (amount > 0),
  status          TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'paid', 'failed')),
  bank_reference  TEXT,
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_affiliate_payouts_affiliate_id
  ON affiliate.payouts(affiliate_id, status);

-- ---------------------------------------------------------------------------
-- Ověření
-- ---------------------------------------------------------------------------
DO $$
DECLARE tbl_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO tbl_count
  FROM information_schema.tables
  WHERE table_schema = 'affiliate'
    AND table_name IN ('affiliates', 'links', 'clicks', 'conversions', 'payouts');

  ASSERT tbl_count = 5, format('CHYBA: Očekáváno 5 tabulek v affiliate schema, nalezeno %s', tbl_count);
  RAISE NOTICE 'Migrace 008 (affiliate) úspěšně ověřena.';
END;
$$;

COMMIT;
