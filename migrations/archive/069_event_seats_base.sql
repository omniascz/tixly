-- Event seats — base table (per-event row pro každé sedadlo)
--
-- BACKGROUND: Tabulka catalog.event_seats byla v dev DB vytvořena ručně přes psql
-- a NIKDY nebyla v žádné migraci. Migrace 240_seat_holds_kills.sql na ní pak ALTER
-- TABLE ADD COLUMN, což na fresh DB selže.
--
-- Tato migrace doplňuje chybějící CREATE TABLE. IF NOT EXISTS dělá idempotent.
--
-- Závislosti:
--   - catalog.events (z 001_initial.sql)
--   - catalog.ticket_types (z 001_initial.sql)
--
-- Co se přidává v pozdějších migracích:
--   - 240_seat_holds_kills: hold_kind, hold_label sloupce + index
--   - 264_event_seats_nulls_not_distinct: UNIQUE NULLS NOT DISTINCT na pozici
--
-- Schéma rekonstruováno z usage v:
--   - nextjs-boilerplate/src/lib/seats/copy-layout-to-event-seats.ts (INSERT cols)
--   - nextjs-boilerplate/src/app/api/checkout/route.ts (SELECT, UPDATE)
--   - nextjs-boilerplate/src/app/api/admin/events/[id]/seats/route.ts
--   - nextjs-boilerplate/src/app/api/admin/events/[id]/holds/route.ts
--   - scripts/seed-rich-demo-phase3-seats.sql

BEGIN;

CREATE TABLE IF NOT EXISTS catalog.event_seats (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Vazba na event a volitelně konkrétní den (pro recurring events)
  event_id        UUID NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  event_day_id    UUID,  -- NULL pro single-day akce (FK na recurring tabulku z 018, bez constraintu pro nezávislost)

  -- Vazba na typ vstupenky (cenová úroveň/zóna)
  ticket_type_id  UUID NOT NULL REFERENCES catalog.ticket_types(id) ON DELETE RESTRICT,

  -- Identifikace pozice — mapuje sektor / řada / sedadlo z layoutu
  sector          TEXT NOT NULL,
  row             TEXT NOT NULL,
  seat_number     TEXT NOT NULL,

  -- Souřadnice pro vykreslení v SeatPickeru (volitelné, převzato z layout JSON)
  x_coord         NUMERIC,
  y_coord         NUMERIC,

  -- Stav sedadla
  status          TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'held', 'sold', 'blocked')),

  -- Wheelchair-accessible flag (převzato z layout JSON sektor.seats[].acc)
  accessibility   BOOLEAN NOT NULL DEFAULT FALSE,

  -- Buyer-side temporary hold (checkout flow)
  hold_until      TIMESTAMPTZ,
  hold_user_id    UUID,  -- identity.users.id, cross-schema bez FK

  -- Vazba na objednávku po nákupu (cross-schema)
  order_id        UUID,  -- orders.orders.id

  -- Cached dynamic price (z W.1 dynamic pricing engine), NULL = base price
  dynamic_price_minor INTEGER,

  -- Pricing snapshot (kdy byl naposledy přepočítán)
  dynamic_price_at TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  catalog.event_seats IS
  'Per-event sedadla — vznikají z catalog.venue_seating_charts.layout přes copy-layout-to-event-seats.ts při tvorbě akce.';
COMMENT ON COLUMN catalog.event_seats.event_day_id IS
  'NULL pro single-day akce. UUID na catalog.event_days pro recurring events (bez FK, cross-table konvence).';
COMMENT ON COLUMN catalog.event_seats.status IS
  'available = volné, held = dočasně rezervováno (hold_until/hold_user_id), sold = prodáno (order_id), blocked = permanentní hold (artist/promoter/comp/production — viz hold_kind z migrace 240).';
COMMENT ON COLUMN catalog.event_seats.hold_until IS
  'Platnost buyer-side hold-u. Po vypršení se sedadlo uvolní přes /api/internal/cron/release-expired-seat-holds nebo SSE stream.';
COMMENT ON COLUMN catalog.event_seats.dynamic_price_minor IS
  'Cached dynamic price (W.1 engine). NULL znamená použij base z ticket_types.';

-- Indexy pro nejčastější dotazy
CREATE INDEX IF NOT EXISTS idx_event_seats_event_id
  ON catalog.event_seats (event_id);

CREATE INDEX IF NOT EXISTS idx_event_seats_event_day
  ON catalog.event_seats (event_id, event_day_id)
  WHERE event_day_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_event_seats_ticket_type
  ON catalog.event_seats (ticket_type_id);

CREATE INDEX IF NOT EXISTS idx_event_seats_status
  ON catalog.event_seats (event_id, status);

-- Partial index: aktivní holdy (cleanup cron a SSE stream)
CREATE INDEX IF NOT EXISTS idx_event_seats_hold_until
  ON catalog.event_seats (hold_until)
  WHERE status = 'held' AND hold_until IS NOT NULL;

-- Partial index: sold sedadla per order (refund flow)
CREATE INDEX IF NOT EXISTS idx_event_seats_order_id
  ON catalog.event_seats (order_id)
  WHERE order_id IS NOT NULL;

-- Trigger pro auto-update updated_at
DROP TRIGGER IF EXISTS trg_event_seats_updated_at ON catalog.event_seats;
CREATE TRIGGER trg_event_seats_updated_at
  BEFORE UPDATE ON catalog.event_seats
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Pozn: UNIQUE constraint NA (event_id, event_day_id, sector, row, seat_number) je v migraci 264
-- (vyžaduje NULLS NOT DISTINCT z PG 15+, takže nelze přímo zde).

COMMIT;
