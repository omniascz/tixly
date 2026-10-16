--
-- 491_true_policies_owner_scope.sql
--   RLS politiky s podmínkou `true` (FIX_REPORT_R3 bod 4, kolo 4 krok 3b)
--
-- ── Inventura (logs/r4/3b_true_policies_before.txt, 19 politik) ──────────────
-- ZÁPIS s true (vždy chyba, kromě append-only auditu) — nahrazeno:
--   marketing.ticket_alerts   INSERT, UPDATE  → servis/admin (routa zapisuje servisně)
--   orders.postal_deliveries  INSERT          → servis/admin (checkout)
--   orders.travel_bookings    INSERT          → servis/admin (checkout, order-completed)
--   orders.seat_upgrades      INSERT, UPDATE  → servis/admin (upgrade přes asSystemInTx)
--   orders.ticket_transfers   UPDATE          → servis/admin, odesílatel, příjemce (e-mail)
-- ČTENÍ s true vázané na akci — omezeno na publikované akce (+ vlastník/admin/servis):
--   catalog.event_travel_packages, catalog.superfan_experiences
-- ČTENÍ s true u pořadatele — omezeno na aktivní (+ vlastní/člen/admin/servis):
--   platform.promoters (tabulka nese bankovní účet, KYC, ARES — neaktivní nemají být vidět)
-- PONECHÁNO (veřejné údaje sálu / číselníky, záměr): audit.audit_log INSERT (append-only),
--   catalog.cinema_screens, seats, seat_view_photos, venue_seating_charts, travel_hotels,
--   travel_hotel_rooms, platform.carbon_offset_settings, platform.postal_fees.
--
-- Idempotentní (DROP POLICY IF EXISTS). Ověřeno tests/fix-r4-true-policies.live.test.ts.
--
BEGIN;

-- ── marketing.ticket_alerts ─────────────────────────────────────────────────
DROP POLICY IF EXISTS ticket_alerts_insert ON marketing.ticket_alerts;
CREATE POLICY ticket_alerts_insert ON marketing.ticket_alerts
  FOR INSERT WITH CHECK (public.app_is_service() OR public.app_is_platform_admin());
DROP POLICY IF EXISTS ticket_alerts_update ON marketing.ticket_alerts;
CREATE POLICY ticket_alerts_update ON marketing.ticket_alerts
  FOR UPDATE USING (public.app_is_service() OR public.app_is_platform_admin())
  WITH CHECK (public.app_is_service() OR public.app_is_platform_admin());

-- ── orders.postal_deliveries ────────────────────────────────────────────────
DROP POLICY IF EXISTS postal_deliveries_insert ON orders.postal_deliveries;
CREATE POLICY postal_deliveries_insert ON orders.postal_deliveries
  FOR INSERT WITH CHECK (public.app_is_service() OR public.app_is_platform_admin());

-- ── orders.travel_bookings ──────────────────────────────────────────────────
DROP POLICY IF EXISTS travel_bookings_insert ON orders.travel_bookings;
CREATE POLICY travel_bookings_insert ON orders.travel_bookings
  FOR INSERT WITH CHECK (public.app_is_service() OR public.app_is_platform_admin());

-- ── orders.seat_upgrades ────────────────────────────────────────────────────
DROP POLICY IF EXISTS seat_upgrades_insert ON orders.seat_upgrades;
CREATE POLICY seat_upgrades_insert ON orders.seat_upgrades
  FOR INSERT WITH CHECK (public.app_is_service() OR public.app_is_platform_admin());
DROP POLICY IF EXISTS seat_upgrades_update ON orders.seat_upgrades;
CREATE POLICY seat_upgrades_update ON orders.seat_upgrades
  FOR UPDATE USING (public.app_is_service() OR public.app_is_platform_admin())
  WITH CHECK (public.app_is_service() OR public.app_is_platform_admin());

-- ── orders.ticket_transfers ─────────────────────────────────────────────────
DROP POLICY IF EXISTS ticket_transfers_update ON orders.ticket_transfers;
CREATE POLICY ticket_transfers_update ON orders.ticket_transfers
  FOR UPDATE
  USING (
    public.app_is_service() OR public.app_is_platform_admin()
    OR from_user_id = public.app_current_user_id()
    OR (to_email IS NOT NULL AND lower(to_email) =
        (SELECT lower(u.email) FROM identity.users u WHERE u.id = public.app_current_user_id()))
  )
  WITH CHECK (
    public.app_is_service() OR public.app_is_platform_admin()
    OR from_user_id = public.app_current_user_id()
    OR (to_email IS NOT NULL AND lower(to_email) =
        (SELECT lower(u.email) FROM identity.users u WHERE u.id = public.app_current_user_id()))
  );

-- ── catalog.event_travel_packages ───────────────────────────────────────────
DROP POLICY IF EXISTS event_travel_packages_select ON catalog.event_travel_packages;
CREATE POLICY event_travel_packages_select ON catalog.event_travel_packages
  FOR SELECT USING (
    public.app_is_service() OR public.app_is_platform_admin()
    OR EXISTS (SELECT 1 FROM catalog.events e
                WHERE e.id = event_travel_packages.event_id
                  AND (e.status IN ('published', 'on_sale') OR e.promoter_id = public.app_current_promoter_id()))
  );

-- ── catalog.superfan_experiences ────────────────────────────────────────────
DROP POLICY IF EXISTS superfan_exp_public_read ON catalog.superfan_experiences;
CREATE POLICY superfan_exp_public_read ON catalog.superfan_experiences
  FOR SELECT USING (
    public.app_is_service() OR public.app_is_platform_admin()
    OR EXISTS (SELECT 1 FROM catalog.events e
                WHERE e.id = superfan_experiences.event_id
                  AND (e.status IN ('published', 'on_sale') OR e.promoter_id = public.app_current_promoter_id()))
  );

-- ── platform.promoters ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS p_promoters_read ON platform.promoters;
CREATE POLICY p_promoters_read ON platform.promoters
  FOR SELECT USING (
    status = 'active'
    OR public.app_is_service() OR public.app_is_platform_admin()
    OR id = public.app_current_promoter_id()
    OR EXISTS (SELECT 1 FROM platform.promoter_members pm
                WHERE pm.promoter_id = promoters.id AND pm.user_id = public.app_current_user_id())
  );

COMMIT;
