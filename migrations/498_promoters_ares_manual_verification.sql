-- 498_promoters_ares_manual_verification.sql
--   Kolo 7 / krok 5 — výpadek ARES přepne pořadatele do ručního ověření.
--
-- Dřív: výpadek nebo timeout ARES se zapsal stejně jako neexistující IČO (ares_ico_valid = false,
-- risk_score 100) a KYC skončilo 422. Teď se výsledek ověření ukládá rozlišeně:
--   ares_check_status: verified | not_found | inactive | unavailable | not_provided
--   manual_verification_required: true, když ARES nebyl dostupný → platform admin ověří ručně.
-- Historické řádky: odvodí se z ares_ico_valid / ares_company_active tam, kde je výsledek jednoznačný;
-- neplatné bez odpovědi ARES (nelze rozlišit výpadek od neexistujícího IČO) zůstanou NULL.
-- Idempotentní.

ALTER TABLE platform.promoters
  ADD COLUMN IF NOT EXISTS ares_check_status text,
  ADD COLUMN IF NOT EXISTS manual_verification_required boolean NOT NULL DEFAULT false;

ALTER TABLE platform.promoters DROP CONSTRAINT IF EXISTS promoters_ares_check_status_check;
ALTER TABLE platform.promoters ADD CONSTRAINT promoters_ares_check_status_check
  CHECK (ares_check_status IS NULL OR ares_check_status IN ('verified', 'not_found', 'inactive', 'unavailable', 'not_provided'));

COMMENT ON COLUMN platform.promoters.ares_check_status IS
  'Výsledek ověření IČO v ARES (kolo 7): verified | not_found | inactive | unavailable (výpadek/timeout) | not_provided.';
COMMENT ON COLUMN platform.promoters.manual_verification_required IS
  'ARES nebyl dostupný — údaje firmy musí ručně ověřit platform admin (kolo 7).';

UPDATE platform.promoters SET ares_check_status = 'verified'
 WHERE ares_check_status IS NULL AND ares_ico_valid IS TRUE AND ares_company_active IS TRUE;
UPDATE platform.promoters SET ares_check_status = 'inactive'
 WHERE ares_check_status IS NULL AND ares_ico_valid IS TRUE AND ares_company_active IS FALSE;
UPDATE platform.promoters SET ares_check_status = 'not_provided'
 WHERE ares_check_status IS NULL AND ares_checked_at IS NOT NULL AND company_ico IS NULL;
