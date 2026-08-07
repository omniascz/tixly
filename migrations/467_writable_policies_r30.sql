--
-- 467_writable_policies_r30.sql — R-30
--   Ctyri tabulky mely VSECHNY policy jen `FOR SELECT`. Zapis do nich proto
--   tise neprosel: zadna chyba, zadny SQLSTATE, jen `rowCount = 0` (§145).
--
-- Zmereno pred opravou, servisni kontext pod tixly_app:
--   platform.payouts             UPDATE rowCount=0
--   platform.payout_settings     UPDATE rowCount=0
--   compliance.e_signatures      UPDATE rowCount=0
--   identity.oauth_accounts      UPDATE rowCount=0
--
-- ⚠️ Migrace SAMA NESTACI. `lib/payouts/executor.ts` bezel BEZ kontextu, takze
-- by mu zapis neprosel ani se servisni vetvi. Obaleno ve stejnem commitu —
-- obe casti jsou dolozene oddelene (§147).
--

BEGIN;

-- ── platform.payouts ────────────────────────────────────────────────────────
-- Zapisuji vyhradne crony a webhook banky (event-payout-release,
-- payouts-auto-settle, wise/webhook, lib/payouts/executor). Zadna uzivatelska
-- cesta. Platform-admin vetev ZAMERNE NENI: nikdo z adminu do payouts primo
-- nepise, pridavala by prava bez konzumenta.
-- Ctecí `platform_payouts_promoter` (FOR SELECT, service OR vlastni promoter)
-- ZUSTAVA beze zmeny — promoter ma na svoje vyplaty videt.
DROP POLICY IF EXISTS p_payouts_service_write ON platform.payouts;
CREATE POLICY p_payouts_service_write ON platform.payouts
  FOR ALL
  USING (public.app_is_service())
  WITH CHECK (public.app_is_service());

-- ── platform.payout_settings ────────────────────────────────────────────────
-- Nastaveni promotera, meni si ho sam (admin/settings, runAsActivePromoterNonStaff).
-- Vzorec z 461.
DROP POLICY IF EXISTS p_payout_settings_scope ON platform.payout_settings;
CREATE POLICY p_payout_settings_scope ON platform.payout_settings
  FOR ALL
  USING (public.app_is_service()
     OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_service()
     OR promoter_id = public.app_current_promoter_id());

-- ── compliance.e_signatures ─────────────────────────────────────────────────
-- Podpis je DUKAZ. Promoter ho smi VLOZIT, ale NE prepsat ani smazat —
-- prepsatelny podpis je horsi nez nezapisovatelny. Proto FOR INSERT, ne FOR ALL.
-- Plnou pravomoc ma jen servisni cesta (napr. GDPR anonymizace).
DROP POLICY IF EXISTS p_e_signatures_promoter_insert ON compliance.e_signatures;
CREATE POLICY p_e_signatures_promoter_insert ON compliance.e_signatures
  FOR INSERT
  WITH CHECK (promoter_id = public.app_current_promoter_id());

DROP POLICY IF EXISTS p_e_signatures_service ON compliance.e_signatures;
CREATE POLICY p_e_signatures_service ON compliance.e_signatures
  FOR ALL
  USING (public.app_is_service())
  WITH CHECK (public.app_is_service());

-- ── identity.oauth_accounts ─────────────────────────────────────────────────
-- Zapisuje jen prihlasovaci tok (lib/oauth/provider.ts, servisni kontext).
-- Uzivatel ma sva propojeni VIDET, ale menit je nesmi.
DROP POLICY IF EXISTS p_oauth_accounts_service ON identity.oauth_accounts;
CREATE POLICY p_oauth_accounts_service ON identity.oauth_accounts
  FOR ALL
  USING (public.app_is_service())
  WITH CHECK (public.app_is_service());

DROP POLICY IF EXISTS p_oauth_accounts_owner_read ON identity.oauth_accounts;
CREATE POLICY p_oauth_accounts_owner_read ON identity.oauth_accounts
  FOR SELECT
  USING (user_id = public.app_current_user_id());

COMMIT;
