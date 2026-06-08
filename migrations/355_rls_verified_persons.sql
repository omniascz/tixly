-- 355_rls_verified_persons.sql
--
-- RLS — poslední citlivá tabulka bez ochrany (security audit 2026-06-08).
--
-- identity.verified_persons drží ŠIFROVANOU KYC identitu z BankID (jméno, datum
-- narození, číslo OP — vše *_enc). Klíčováno přes bank_id_sub (ne user_id).
-- Zápis/čtení patří JEN trusted backendu (BankID verifikační flow = service kontext);
-- žádný promotér ani buyer nemá důvod číst cizí ověřené identity.
--
-- Restrikce na service/admin = nejbezpečnější a bez rizika (tabulka je zatím nezapojená
-- a prázdná; až BankID flow vznikne, poběží v service kontextu → pokryto). Šifrování
-- (*_enc + ENCRYPTION_KEY) zůstává jako druhá vrstva i kdyby RLS selhalo.

ALTER TABLE identity.verified_persons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS svc_identity_verified_persons ON identity.verified_persons;
CREATE POLICY svc_identity_verified_persons ON identity.verified_persons
  FOR ALL
  USING (app_is_service() OR app_is_platform_admin())
  WITH CHECK (app_is_service() OR app_is_platform_admin());
