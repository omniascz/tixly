-- 288_risk_mitigation.sql
-- P0 risk mitigace proti promotérskému scamu (z docs/risk-analysis):
--
-- 1. Pre-event hold — peníze se NEVYPLATÍ dokud akce nepronběhne + 14 dní
--    refund window
-- 2. Hard cap T1 — nový promotér nesmí prodat víc než X Kč než pass review
-- 3. Event completion verify — scanner stats < 10% = SUSPICIOUS, hold payout
-- 4. ARES check — IČO ověřeno
--
-- Bez těchto chrání se Tixly před insolvency rizikem z prvního scamu.

BEGIN;

-- 1. Pre-event hold tracking
ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS completion_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS completion_status text NOT NULL DEFAULT 'pending'
    CHECK (completion_status IN ('pending', 'completed', 'suspicious', 'no_show', 'cancelled')),
  ADD COLUMN IF NOT EXISTS scan_rate_pct integer,
  ADD COLUMN IF NOT EXISTS payout_hold_until timestamptz;

COMMENT ON COLUMN catalog.events.completion_status IS
  'pending=akce nepronběhla | completed=scanner > 30% | suspicious=scanner 10-30% | no_show=< 10% | cancelled';

COMMENT ON COLUMN catalog.events.scan_rate_pct IS
  'Procento naskenovaných lístků (z prodaných). NULL = akce ještě neprošla.';

COMMENT ON COLUMN catalog.events.payout_hold_until IS
  'Promotér nedostane payout dokud not > NOW(). Default: date_end + 14 dní (EU refund window).';

CREATE INDEX IF NOT EXISTS idx_events_completion_pending
  ON catalog.events(date_end, completion_status)
  WHERE completion_status = 'pending' AND status = 'published';

CREATE INDEX IF NOT EXISTS idx_events_payout_hold
  ON catalog.events(payout_hold_until)
  WHERE payout_hold_until IS NOT NULL;

-- 2. Hard cap pro T1 promotery
ALTER TABLE platform.promoters
  ADD COLUMN IF NOT EXISTS pre_review_volume_cap_halire integer DEFAULT 10000000,  -- 100k Kč default
  ADD COLUMN IF NOT EXISTS pre_review_volume_used_halire integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pre_review_passed_at timestamptz;

COMMENT ON COLUMN platform.promoters.pre_review_volume_cap_halire IS
  'T1 max prodáno v Kč halířích dokud pass_review_passed_at IS NULL. Default 100k Kč.';

COMMENT ON COLUMN platform.promoters.pre_review_volume_used_halire IS
  'Total prodáno k dnešnímu dni. Inkrementováno per order paid.';

COMMENT ON COLUMN platform.promoters.pre_review_passed_at IS
  'Datum manuálního schválení master adminem. NULL = stále T1 hard cap.';

-- 3. ARES check log
ALTER TABLE platform.promoters
  ADD COLUMN IF NOT EXISTS ares_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS ares_ico_valid boolean,
  ADD COLUMN IF NOT EXISTS ares_company_active boolean,
  ADD COLUMN IF NOT EXISTS ares_address_match boolean,
  ADD COLUMN IF NOT EXISTS ares_raw_response jsonb;

COMMENT ON COLUMN platform.promoters.ares_checked_at IS
  'Datum posledního ARES API checku (justice.cz).';

COMMENT ON COLUMN platform.promoters.ares_ico_valid IS
  'true = IČO existuje v ARES; false = neexistuje; NULL = ještě nezkontrolováno';

-- 4. Risk score per promoter (computed)
ALTER TABLE platform.promoters
  ADD COLUMN IF NOT EXISTS risk_score integer NOT NULL DEFAULT 50
    CHECK (risk_score >= 0 AND risk_score <= 100);

COMMENT ON COLUMN platform.promoters.risk_score IS
  '0-100. 0=trusted (T3 enterprise), 100=high risk (T1 new, no ARES). Auto computed.';

-- 5. Default payout_hold_until na všechny existing published events
UPDATE catalog.events
   SET payout_hold_until = COALESCE(date_end, date_start) + INTERVAL '14 days'
 WHERE payout_hold_until IS NULL
   AND status = 'published';

COMMIT;
