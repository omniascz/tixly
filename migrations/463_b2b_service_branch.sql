--
-- 463_b2b_service_branch.sql — b2b trojice: servisní větev (varianta A)
--
--   platform.b2b_accounts
--   platform.b2b_transactions
--   platform.b2b_account_users
--
-- Všechny tři stály zcela mimo RLS (FINDINGS §109 — moje dřívější tvrzení,
-- že b2b_account_users policy má, bylo špatně; to číslo pocházelo z grepu,
-- který napočítal řádek CREATE INDEX).
--
-- ── Proč servisní větev, a ne korelace na uživatele ──────────────────────────
-- Identita B2B uživatele NENÍ app.current_user_id. Autorizace jde přes
-- verifyB2BToken -> session.b2bAccountId. Tabulka b2b_account_users navíc
-- žádný user_id nemá — klíčuje se e-mailem — a b2b_transactions.user_id je
-- cizí klíč do b2b_account_users, ne do identity.users.
-- Korelace na app_current_user_id() by tedy neměla z čeho vyjít.
--
-- ⚠️ CO TAHLE MIGRACE NEDĚLÁ: nepřidává vrstvu izolace mezi firmami.
-- Scoping podle b2bAccountId zůstává v aplikaci. Migrace jen zavírá tabulky
-- před kontexty, které o nich nemají vědět (promotér, kupující, anonym).
-- Skutečnou izolaci by dala až varianta B — app.b2b_account_id + DEFINER
-- helper. Ta je zapsaná jako tiket (REMEDIATION R-17), ne opomenutá.
--
-- ── Nasadit SPOLU s obalením admin/b2b a b2b/* kontextem ─────────────────────
-- ZMĚŘENO: admin/b2b používá holé requirePlatformAdmin, které kontext
-- NENASTAVUJE (kontext nastavuje až runAsPlatformAdmin z platform-auth.ts:55).
-- Bez obalení by tahle migrace správu B2B účtů ZAVŘELA — app.is_platform_admin
-- by nebylo nastavené a větev by neplatila. Kód se opravuje ve stejném commitu.
--

BEGIN;

ALTER TABLE platform.b2b_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_b2b_accounts_scope ON platform.b2b_accounts;
CREATE POLICY p_b2b_accounts_scope ON platform.b2b_accounts
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());

ALTER TABLE platform.b2b_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_b2b_transactions_scope ON platform.b2b_transactions;
CREATE POLICY p_b2b_transactions_scope ON platform.b2b_transactions
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());

ALTER TABLE platform.b2b_account_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_b2b_account_users_scope ON platform.b2b_account_users;
CREATE POLICY p_b2b_account_users_scope ON platform.b2b_account_users
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());

COMMIT;
