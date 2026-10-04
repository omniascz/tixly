-- 502_seat_blocks.sql
--   Kolo 8 / krok 3 — pojmenované blokace míst (Firma XY, Tisk, Technika, Rezerva…).
--
-- POUŽITO: mechanismus držení na catalog.event_seats (status 'blocked' + hold_kind + hold_label) — blokované
--          místo nejde podržet ani koupit (seat hold i checkout chtějí 'available' / vlastní hold), pokladna
--          vidí hold_label = název blokace.
-- NOVĚ:    catalog.seat_blocks (blokace jako entita s poznámkou a barvou) a catalog.seat_block_seats (stav
--          každého místa v blokaci: blocked | released | issued | sold | corporate) pro přehled
--          „míst celkem | uvolněno | vydáno | prodáno"; hold_kind 'block'.
-- Idempotentní.

CREATE TABLE IF NOT EXISTS catalog.seat_blocks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id           uuid NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  promoter_id        uuid NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  name               text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  note               text,
  color              text NOT NULL DEFAULT '#6b7280' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  created_by_user_id uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, name)
);
CREATE INDEX IF NOT EXISTS idx_seat_blocks_promoter ON catalog.seat_blocks (promoter_id);

CREATE TABLE IF NOT EXISTS catalog.seat_block_seats (
  block_id    uuid NOT NULL REFERENCES catalog.seat_blocks(id) ON DELETE CASCADE,
  seat_id     uuid NOT NULL REFERENCES catalog.event_seats(id) ON DELETE CASCADE,
  promoter_id uuid NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  state       text NOT NULL DEFAULT 'blocked' CHECK (state IN ('blocked', 'released', 'issued', 'sold', 'corporate')),
  order_id    uuid REFERENCES orders.orders(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (block_id, seat_id)
);
-- místo je v nejvýš jedné aktivní blokaci
CREATE UNIQUE INDEX IF NOT EXISTS ux_seat_block_seats_active ON catalog.seat_block_seats (seat_id) WHERE state = 'blocked';
CREATE INDEX IF NOT EXISTS idx_seat_block_seats_promoter ON catalog.seat_block_seats (promoter_id);

ALTER TABLE catalog.event_seats DROP CONSTRAINT IF EXISTS event_seats_hold_kind_check;
ALTER TABLE catalog.event_seats ADD CONSTRAINT event_seats_hold_kind_check
  CHECK (hold_kind IS NULL OR hold_kind IN ('artist', 'promoter', 'comp', 'production', 'customer', 'group_invite', 'block'));

ALTER TABLE catalog.seat_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog.seat_block_seats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_seat_blocks_scope ON catalog.seat_blocks;
CREATE POLICY p_seat_blocks_scope ON catalog.seat_blocks
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service() OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service() OR promoter_id = public.app_current_promoter_id());
DROP POLICY IF EXISTS p_seat_block_seats_scope ON catalog.seat_block_seats;
CREATE POLICY p_seat_block_seats_scope ON catalog.seat_block_seats
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service() OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service() OR promoter_id = public.app_current_promoter_id());

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tixly_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON catalog.seat_blocks, catalog.seat_block_seats TO tixly_app;
    REVOKE TRUNCATE ON catalog.seat_blocks, catalog.seat_block_seats FROM tixly_app;
  END IF;
END $$;
