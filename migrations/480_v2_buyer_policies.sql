-- 480_v2_buyer_policies.sql — kolo 2 / V2: legitimní přístup pod rolí tixly_app (RLS)
--
-- Nález V2 (audit 2026-09-30): pod tixly_app nefungovalo storno kupcem a self-refund,
-- a promotérský kontext směl vložit libovolného uživatele (i platform admina s heslem).
-- Politiky níže povolují PRÁVĚ legitimní přístup — žádný SECURITY DEFINER, žádné vypnutí RLS.
--
--  1) orders.refund_requests — kupec smí ČÍST své žádosti a ZALOŽIT žádost jen
--     na VLASTNÍ objednávku, se svým user_id a promotérem akce té objednávky.
--     (Dřív: jen promotér/admin/service → INSERT ze storna padal 42501 → 500.)
--  2) platform.refund_policies — kupec smí ČÍST politiku promotéra, u kterého má
--     objednávku (jen čtení; zápis dál jen promotér/admin/service).
--     (Dřív: self-refund vždy 403 SELF_REFUND_DISABLED — LEFT JOIN vrátil NULL.)
--  3) identity.users p_users_promoter_insert — promotér smí vkládat jen
--     uživatele BEZ přihlašovacího hesla (sentinel '!…') a NIKDY platform admina.
--
-- Idempotentní (DROP POLICY IF EXISTS + CREATE). Ověřeno od nuly i nad stávajícím schématem.

BEGIN;

-- 1) refund_requests: kupec — čtení svých, založení na vlastní objednávku
DROP POLICY IF EXISTS p_refund_requests_buyer_select ON orders.refund_requests;
CREATE POLICY p_refund_requests_buyer_select ON orders.refund_requests
  FOR SELECT
  USING (user_id IS NOT NULL AND user_id = public.app_current_user_id());

DROP POLICY IF EXISTS p_refund_requests_buyer_insert ON orders.refund_requests;
CREATE POLICY p_refund_requests_buyer_insert ON orders.refund_requests
  FOR INSERT
  WITH CHECK (
    user_id IS NOT NULL
    AND user_id = public.app_current_user_id()
    AND EXISTS (
      SELECT 1
        FROM orders.orders o
        JOIN catalog.events e ON e.id = o.event_id
       WHERE o.id = refund_requests.order_id
         AND o.user_id = public.app_current_user_id()
         AND e.promoter_id = refund_requests.promoter_id
    )
  );

-- 2) refund_policies: kupec čte politiku promotéra, u kterého nakoupil
DROP POLICY IF EXISTS p_refund_policies_buyer_read ON platform.refund_policies;
CREATE POLICY p_refund_policies_buyer_read ON platform.refund_policies
  FOR SELECT
  USING (
    public.app_current_user_id() IS NOT NULL
    AND EXISTS (
      SELECT 1
        FROM orders.orders o
        JOIN catalog.events e ON e.id = o.event_id
       WHERE o.user_id = public.app_current_user_id()
         AND e.promoter_id = refund_policies.promoter_id
    )
  );

-- 3) identity.users: promotér vkládá jen walk-in/guest účty bez hesla a bez admin práv
DROP POLICY IF EXISTS p_users_promoter_insert ON identity.users;
CREATE POLICY p_users_promoter_insert ON identity.users
  FOR INSERT
  WITH CHECK (
    public.app_current_promoter_id() IS NOT NULL
    AND is_platform_admin IS NOT TRUE
    AND (password_hash IS NULL OR left(password_hash, 1) = '!')
  );

COMMIT;
