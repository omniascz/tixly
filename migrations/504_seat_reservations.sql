-- 504_seat_reservations.sql
--   Kolo 8 / krok 5 — rezervace s platbou na pokladně.
--
-- POUŽITO: objednávka orders.orders ve stavu 'pending' s expires_at (vzor admin /api/admin/reservations),
--          místa drží order_items.seat_id + event_seats.order_id; uvolnění přes lib/orders/release-capacity;
--          platba na pokladně orders.box_office_sessions / orders.box_office_sales (payment_type cash|card);
--          doklad přes lib/accounting/documents.issueOrderDocument; cron přes dispatcher + verifyInternalToken.
-- NOVĚ:    nastavení rezervací na termínu (events.reservations_enabled / reservation_days / reservation_cutoff_hours)
--          a orders.seat_reservations (kód rezervace, kontakt, lhůta, připomínka, storno odkazem, způsob platby).
-- Idempotentní.

ALTER TABLE catalog.events ADD COLUMN IF NOT EXISTS reservations_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE catalog.events ADD COLUMN IF NOT EXISTS reservation_days integer NOT NULL DEFAULT 5;
ALTER TABLE catalog.events ADD COLUMN IF NOT EXISTS reservation_cutoff_hours integer NOT NULL DEFAULT 2;
ALTER TABLE catalog.events DROP CONSTRAINT IF EXISTS events_reservation_days_check;
ALTER TABLE catalog.events ADD CONSTRAINT events_reservation_days_check CHECK (reservation_days BETWEEN 1 AND 60);
ALTER TABLE catalog.events DROP CONSTRAINT IF EXISTS events_reservation_cutoff_hours_check;
ALTER TABLE catalog.events ADD CONSTRAINT events_reservation_cutoff_hours_check CHECK (reservation_cutoff_hours BETWEEN 0 AND 336);

CREATE TABLE IF NOT EXISTS orders.seat_reservations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid NOT NULL UNIQUE REFERENCES orders.orders(id) ON DELETE CASCADE,
  event_id          uuid NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  promoter_id       uuid NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  code              text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{6,12}$'),
  buyer_email       text NOT NULL,
  buyer_name        text NOT NULL,
  buyer_phone       text,
  seat_count        integer NOT NULL CHECK (seat_count > 0),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paid', 'expired', 'cancelled')),
  expires_at        timestamptz NOT NULL,
  reminded_at       timestamptz,
  cancel_token_hash text NOT NULL,
  paid_at           timestamptz,
  payment_type      text CHECK (payment_type IS NULL OR payment_type IN ('cash', 'card')),
  paid_by_user_id   uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  closed_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_seat_reservations_event_status ON orders.seat_reservations (event_id, status);
CREATE INDEX IF NOT EXISTS idx_seat_reservations_email ON orders.seat_reservations (event_id, lower(buyer_email)) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_seat_reservations_expiry ON orders.seat_reservations (expires_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_seat_reservations_promoter ON orders.seat_reservations (promoter_id);

ALTER TABLE orders.seat_reservations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_seat_reservations_scope ON orders.seat_reservations;
CREATE POLICY p_seat_reservations_scope ON orders.seat_reservations
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service() OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service() OR promoter_id = public.app_current_promoter_id());

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tixly_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON orders.seat_reservations TO tixly_app;
    REVOKE TRUNCATE ON orders.seat_reservations FROM tixly_app;
  END IF;
END $$;

-- OPRAVENO: politiky evidence pokladny (box_office_sessions / box_office_sales) pouštěly jen člena pořadatele přes
-- app_current_user_id(), který kontext pořadatele (runWithPromoterContext) nenastavuje → pod tixly_app pokladna
-- nemohla otevřít směnu ani zapsat prodej (42501). Přidán rozsah pořadatele termínu + servisní kontext, jako u
-- ostatních tabulek; původní podmínka (člen pořadatele) zůstává.
DROP POLICY IF EXISTS box_office_sessions_promoter ON orders.box_office_sessions;
CREATE POLICY box_office_sessions_promoter ON orders.box_office_sessions
  FOR ALL
  USING (
    public.app_is_platform_admin() OR public.app_is_service()
    OR EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = box_office_sessions.event_id AND e.promoter_id = public.app_current_promoter_id())
    OR EXISTS (SELECT 1 FROM catalog.events e JOIN platform.promoter_members pm ON pm.promoter_id = e.promoter_id
                WHERE e.id = box_office_sessions.event_id AND pm.user_id = public.app_current_user_id()))
  WITH CHECK (
    public.app_is_platform_admin() OR public.app_is_service()
    OR EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = box_office_sessions.event_id AND e.promoter_id = public.app_current_promoter_id())
    OR EXISTS (SELECT 1 FROM catalog.events e JOIN platform.promoter_members pm ON pm.promoter_id = e.promoter_id
                WHERE e.id = box_office_sessions.event_id AND pm.user_id = public.app_current_user_id()));

DROP POLICY IF EXISTS box_office_sales_promoter ON orders.box_office_sales;
CREATE POLICY box_office_sales_promoter ON orders.box_office_sales
  FOR ALL
  USING (
    public.app_is_platform_admin() OR public.app_is_service()
    OR EXISTS (SELECT 1 FROM orders.box_office_sessions s JOIN catalog.events e ON e.id = s.event_id
                WHERE s.id = box_office_sales.session_id AND e.promoter_id = public.app_current_promoter_id())
    OR EXISTS (SELECT 1 FROM orders.box_office_sessions s JOIN catalog.events e ON e.id = s.event_id
                JOIN platform.promoter_members pm ON pm.promoter_id = e.promoter_id
                WHERE s.id = box_office_sales.session_id AND pm.user_id = public.app_current_user_id()))
  WITH CHECK (
    public.app_is_platform_admin() OR public.app_is_service()
    OR EXISTS (SELECT 1 FROM orders.box_office_sessions s JOIN catalog.events e ON e.id = s.event_id
                WHERE s.id = box_office_sales.session_id AND e.promoter_id = public.app_current_promoter_id())
    OR EXISTS (SELECT 1 FROM orders.box_office_sessions s JOIN catalog.events e ON e.id = s.event_id
                JOIN platform.promoter_members pm ON pm.promoter_id = e.promoter_id
                WHERE s.id = box_office_sales.session_id AND pm.user_id = public.app_current_user_id()));
