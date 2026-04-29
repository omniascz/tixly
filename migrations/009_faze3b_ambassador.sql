-- =============================================================================
-- MIGRACE 009: Schéma pro ambassador-management modul
-- Datum: 2026-04-05
-- Modul: C:\Users\omnia\Documents\tixly\ambassador-management\
-- Tabulky: ambassador.ambassadors, ambassador.codes, ambassador.code_usages,
--          ambassador.payouts
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS ambassador;

-- ---------------------------------------------------------------------------
-- ambassador.ambassadors — VIP promotér účty
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ambassador.ambassadors (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- cross-schema ref na identity.users — bez FK
  user_id             UUID        NOT NULL,
  -- cross-schema ref na platform.promoters — bez FK
  promoter_id         UUID        NOT NULL,
  name                VARCHAR(200) NOT NULL,
  tier                TEXT        NOT NULL DEFAULT 'bronze'
    CHECK (tier IN ('bronze', 'silver', 'gold')),
  -- Provizní sazba v basis points (max 3000 = 30 %)
  commission_rate_bps INTEGER     NOT NULL DEFAULT 1000
    CHECK (commission_rate_bps >= 0 AND commission_rate_bps <= 3000),
  -- Wallet — kumulované nezaplacené komise (halíře)
  wallet_balance      INTEGER     NOT NULL DEFAULT 0 CHECK (wallet_balance >= 0),
  status              TEXT        NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'deactivated')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_ambassador_user_promoter UNIQUE (user_id, promoter_id)
);

COMMENT ON COLUMN ambassador.ambassadors.commission_rate_bps IS
  'Provizní sazba v basis points. Max 3000 = 30 %. Výpočet: Math.floor((amount * bps) / 10_000).';

CREATE INDEX IF NOT EXISTS idx_ambassador_promoter_id
  ON ambassador.ambassadors(promoter_id, status);

CREATE TRIGGER trg_ambassador_updated_at
  BEFORE UPDATE ON ambassador.ambassadors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- ambassador.codes — promo kódy vydané ambasadorovi
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ambassador.codes (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ambassador_id   UUID        NOT NULL REFERENCES ambassador.ambassadors(id) ON DELETE CASCADE,
  -- Kód bez znaků O,0,I,1 (snížení záměn při ručním opisování)
  -- Délka: výchozí 8 znaků z charset A-Z,2-9 bez AMSATFVE (custom charset)
  code            VARCHAR(20) NOT NULL UNIQUE,
  -- NULL = neomezený počet použití
  max_uses        INTEGER     CHECK (max_uses IS NULL OR max_uses > 0),
  used_count      INTEGER     NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  -- Sleva pro kupujícího v basis points (nezávislá na commission_rate)
  discount_bps    INTEGER     NOT NULL DEFAULT 0
    CHECK (discount_bps >= 0 AND discount_bps <= 10000),
  -- NULL = platí neomezeně
  valid_until     TIMESTAMPTZ,
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN ambassador.codes.code IS
  'Promo kód generovaný z vlastního charstetu (bez O,0,I,1 pro snížení záměn).';

COMMENT ON COLUMN ambassador.codes.discount_bps IS
  'Sleva pro kupujícího použitím kódu (basis points). 0 = žádná sleva, pouze tracking.';

CREATE INDEX IF NOT EXISTS idx_ambassador_codes_ambassador_id
  ON ambassador.codes(ambassador_id);

-- Partial index: pouze aktivní kódy (nejčastější dotaz při validaci kódu)
CREATE INDEX IF NOT EXISTS idx_ambassador_codes_active
  ON ambassador.codes(code)
  WHERE is_active = TRUE;

-- ---------------------------------------------------------------------------
-- ambassador.code_usages — použití kódu při objednávce
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ambassador.code_usages (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id         UUID        NOT NULL REFERENCES ambassador.codes(id),
  -- Idempotency: jedna objednávka = jedno použití kódu
  order_id        UUID        NOT NULL UNIQUE,
  order_amount    INTEGER     NOT NULL CHECK (order_amount >= 0),
  -- Provize = Math.floor((order_amount * commission_rate_bps) / 10_000)
  commission      INTEGER     NOT NULL CHECK (commission >= 0),
  -- Čas kdy kupující použil kód
  used_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ambassador.code_usages IS
  'Immutable log použití ambasadorských kódů. ON CONFLICT (order_id) DO NOTHING pro idempotenci.';

CREATE INDEX IF NOT EXISTS idx_ambassador_usages_code_id
  ON ambassador.code_usages(code_id, used_at DESC);

-- ---------------------------------------------------------------------------
-- ambassador.payouts — žádosti o výplatu wallet balance
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ambassador.payouts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ambassador_id   UUID        NOT NULL REFERENCES ambassador.ambassadors(id),
  amount          INTEGER     NOT NULL CHECK (amount > 0),
  status          TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'paid', 'failed')),
  bank_reference  TEXT,
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ambassador_payouts_ambassador_id
  ON ambassador.payouts(ambassador_id, status);

-- ---------------------------------------------------------------------------
-- Ověření
-- ---------------------------------------------------------------------------
DO $$
DECLARE tbl_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO tbl_count
  FROM information_schema.tables
  WHERE table_schema = 'ambassador'
    AND table_name IN ('ambassadors', 'codes', 'code_usages', 'payouts');

  ASSERT tbl_count = 4, format('CHYBA: Očekáváno 4 tabulky v ambassador schema, nalezeno %s', tbl_count);
  RAISE NOTICE 'Migrace 009 (ambassador) úspěšně ověřena.';
END;
$$;

COMMIT;
