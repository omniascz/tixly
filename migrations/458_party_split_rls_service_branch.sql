--
-- 458_party_split_rls_service_branch.sql — party_split_* dostane servisní větev
--
-- ── Co je špatně ─────────────────────────────────────────────────────────────
-- `orders.party_split_sessions` má jedinou zapisovatelnou policy:
--
--   party_split_sessions_owner
--     USING (organizer_user_id::text = current_setting('app.current_user_id', true))
--
-- Žádný `app_is_platform_admin()`, žádný `app_is_service()`, žádný `WITH CHECK`.
-- Route `checkout/party-split/route.ts:65` přitom běží v `runWithServiceContext`,
-- který nastavuje `app.role`, NE `app.current_user_id` — GUC je prázdný, porovnání
-- neplatí a INSERT skončí na:
--
--   42501 new row violates row-level security policy for table "party_split_sessions"
--
-- `orders.party_split_slots` na tom byla hůř: měla POUZE `FOR SELECT` policy,
-- takže zápis do ní neprošel vůbec.
--
-- ── Proč servisní větev, a ne přepsání routy ─────────────────────────────────
-- Rozhodl zavedený vzorec, ne úvaha: **355 policies v baseline** používá
-- `app_is_service()`. Srovnatelná `orders.orders` má
--
--   p_orders_scope USING (app_is_platform_admin() OR app_is_service()
--                         OR user_id = app_current_user_id() OR EXISTS (…))
--
-- Zakládání party-split session je servisní operace stejně jako zakládání
-- objednávky. `party_split_*` byla výjimka, ne konstrukční volba (FINDINGS §79).
--
-- ── ⚠️ Izolace se tím NESMÍ otevřít ──────────────────────────────────────────
-- Vlastnická větev zůstává a `WITH CHECK` je nově explicitní, takže cizí
-- uživatel nesmí číst ani zapsat cizí session. Ověřeno testem, ne úvahou.
-- `party_split_sessions_public_read` (SELECT nad `status='open'`) zůstává beze
-- změny — sdílení odkazu je smysl té featury.
--
-- NENASAZENO NA PRODUKCI.
--

BEGIN;

-- ── sessions ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS party_split_sessions_owner ON orders.party_split_sessions;
CREATE POLICY party_split_sessions_owner ON orders.party_split_sessions
  USING (
    public.app_is_platform_admin()
    OR public.app_is_service()
    OR organizer_user_id = public.app_current_user_id()
  )
  WITH CHECK (
    public.app_is_platform_admin()
    OR public.app_is_service()
    OR organizer_user_id = public.app_current_user_id()
  );

-- ── slots ───────────────────────────────────────────────────────────────────
-- Čtení zůstává vázané na session (beze změny), přibývá ZÁPIS: servisní kontext
-- nebo organizátor té session. Bez toho nešel slot vůbec zapsat.
DROP POLICY IF EXISTS party_split_slots_write ON orders.party_split_slots;
CREATE POLICY party_split_slots_write ON orders.party_split_slots
  USING (
    public.app_is_platform_admin()
    OR public.app_is_service()
    OR session_id IN (
      SELECT s.id FROM orders.party_split_sessions s
      WHERE s.organizer_user_id = public.app_current_user_id()
    )
  )
  WITH CHECK (
    public.app_is_platform_admin()
    OR public.app_is_service()
    OR session_id IN (
      SELECT s.id FROM orders.party_split_sessions s
      WHERE s.organizer_user_id = public.app_current_user_id()
    )
  );

COMMIT;
