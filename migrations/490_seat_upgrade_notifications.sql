--
-- 490_seat_upgrade_notifications.sql
--   orders.seat_upgrade_notifications — log upozornění „uvolnilo se lepší místo"
--
-- ── Proč ────────────────────────────────────────────────────────────────────
-- Cron /api/internal/cron/seat-upgrade-notify deduplikoval přes neexistující sloupce
-- orders.seat_upgrades.order_id/notified_at (FIX_REPORT_R3 bod 4) a vždy spadl.
-- `seat_upgrades` eviduje SKUTEČNÉ upgrady (původní/nové sedadlo, poplatek, platba) —
-- upozornění do ní nepatří. Tahle tabulka drží jen „komu a kdy jsme psali", aby kupec
-- nedostal stejné upozornění častěji než jednou za 7 dní.
--
-- RLS: zapisuje a čte jen cron (servisní kontext) a platform admin. Idempotentní.
--
BEGIN;

CREATE TABLE IF NOT EXISTS orders.seat_upgrade_notifications (
  order_id      uuid PRIMARY KEY REFERENCES orders.orders(id) ON DELETE CASCADE,
  notified_at   timestamptz NOT NULL DEFAULT now(),
  better_seats  integer NOT NULL DEFAULT 0 CHECK (better_seats >= 0)
);

ALTER TABLE orders.seat_upgrade_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_seat_upgrade_notifications_svc ON orders.seat_upgrade_notifications;
CREATE POLICY p_seat_upgrade_notifications_svc ON orders.seat_upgrade_notifications
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());

GRANT SELECT, INSERT, UPDATE, DELETE ON orders.seat_upgrade_notifications TO tixly_app;
-- ALTER DEFAULT PRIVILEGES dává novým tabulkám i TRUNCATE, který RLS obchází (kontrola 3B).
REVOKE TRUNCATE ON orders.seat_upgrade_notifications FROM tixly_app;

COMMIT;
