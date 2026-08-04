--
-- 454_rls_cast_nullif_fix.sql — 4 policies castují GUC napřímo → 22P02
--
-- ── Co je špatně ─────────────────────────────────────────────────────────────
-- Čtyři policies dělají `(current_setting('app.current_user_id', true))::uuid`.
-- `app.current_user_id` je jméno, které aplikace REÁLNĚ nastavuje — a po
-- `RESET` v něm zůstane **prázdný řetězec**, ne NULL (doloženo jako T-AUDIT-GUC).
-- `''::uuid` není NULL, je to **22P02 invalid input syntax** → dotaz spadne,
-- tedy 500. Není to tedy fail-closed, je to výpadek.
--
-- Kanonický tvar to řeší a existuje od migrace 285:
--   app_current_user_id() = SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid
-- `NULLIF` prázdný řetězec převede na NULL → predikát je NULL → řádek se
-- odfiltruje. To je fail-closed, jak se čekalo.
--
-- ── ⚠️ Co tahle migrace ZÁMĚRNĚ NEDĚLÁ ───────────────────────────────────────
-- `oauth_accounts_own` a `artist_follows_own` čtou v téže policy i
-- `current_setting('app.is_service')` — jméno, které aplikace NENASTAVUJE
-- (name-drift, FINDINGS §38). Tady se ho NEDOTÝKÁM. Nahradit ho za
-- `app_is_service()` by **aktivovalo dosud mrtvou větev**, tedy rozšířilo
-- přístup — a to je jiné rozhodnutí než oprava pádu. Patří do migrace
-- na 39 name-drift policies, ne sem.
--
-- Tahle migrace tedy mění POUZE tvar castu. Množina viditelných řádků se
-- pro nastavené platné UUID nemění.
--
-- NENASAZENO NA PRODUKCI.
--

BEGIN;

-- ── catalog.scanner_devices ──────────────────────────────────────────────────
DROP POLICY IF EXISTS platform_admin_devices ON catalog.scanner_devices;
CREATE POLICY platform_admin_devices ON catalog.scanner_devices
  USING (EXISTS (
    SELECT 1 FROM identity.users u
    WHERE u.id = public.app_current_user_id()
      AND u.is_platform_admin = true
  ));

DROP POLICY IF EXISTS promoter_own_devices ON catalog.scanner_devices;
CREATE POLICY promoter_own_devices ON catalog.scanner_devices
  USING (promoter_id = (
    SELECT p.id FROM platform.promoters p
    WHERE p.id = scanner_devices.promoter_id
      AND EXISTS (
        SELECT 1 FROM platform.promoter_members pm
        WHERE pm.promoter_id = p.id
          AND pm.user_id = public.app_current_user_id()
      )
  ));

-- ── identity.oauth_accounts ──────────────────────────────────────────────────
-- `app.is_service` ponecháno beze změny (viz hlavička).
DROP POLICY IF EXISTS oauth_accounts_own ON identity.oauth_accounts;
CREATE POLICY oauth_accounts_own ON identity.oauth_accounts
  FOR SELECT
  USING (
    user_id = public.app_current_user_id()
    OR current_setting('app.is_platform_admin'::text, true) = 'true'::text
    OR current_setting('app.is_service'::text, true) = 'true'::text
  );

-- ── lineups.artist_follows ───────────────────────────────────────────────────
DROP POLICY IF EXISTS artist_follows_own ON lineups.artist_follows;
CREATE POLICY artist_follows_own ON lineups.artist_follows
  USING (
    user_id = public.app_current_user_id()
    OR current_setting('app.is_service'::text, true) = 'true'::text
  );

COMMIT;
