-- 290_discovery_feed_face_value_top_picks.sql
-- TM Parity Fáze 1: Face Value Exchange mode + Top Picks SQL view
--
-- 1. resale_listings.mode — 'standard' (free price) vs 'face_value' (fixed orig price)
--    Face Value mode: zdarma pro sellera (žádný resale fee), strop = orig + fees
--
-- 2. Top Picks materialized view — pro každý event vrátí best available seats
--    podle heuristiky (cena/m², vzdálenost od pódia, blok velikosti)

BEGIN;

-- Face Value Exchange mode na resale_listings
ALTER TABLE resale.resale_listings
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'standard'
    CHECK (mode IN ('standard', 'face_value')),
  ADD COLUMN IF NOT EXISTS original_purchase_price_halire integer,
  ADD COLUMN IF NOT EXISTS face_value_cap_halire integer;

COMMENT ON COLUMN resale.resale_listings.mode IS
  'standard = seller free price; face_value = fixed at original purchase price (free for seller, TM-style FVE)';

COMMENT ON COLUMN resale.resale_listings.face_value_cap_halire IS
  'Max povolená cena pro face_value mode (= original purchase price + fees + tax).';

-- Top Picks materialized view (refresh-able)
-- Pro každý published event vrátí best available seats per zone
-- heuristic: cheapest available seat per (event_id, zone) → "best deal"
CREATE OR REPLACE VIEW catalog.vw_top_picks AS
SELECT
  e.id AS event_id,
  e.title AS event_title,
  e.date_start,
  tt.id AS ticket_type_id,
  tt.name AS ticket_type_name,
  tt.zone,
  tt.base_price AS min_price_halire,
  tt.remaining_qty,
  CASE
    WHEN tt.remaining_qty <= 5 THEN 'last_few'
    WHEN tt.remaining_qty <= 20 THEN 'limited'
    ELSE 'plenty'
  END AS availability,
  -- Score: lower price + more remaining = higher score
  GREATEST(0, 100 - LEAST(tt.remaining_qty, 100)) +
    CASE WHEN tt.base_price < 50000 THEN 30  -- < 500 Kč
         WHEN tt.base_price < 150000 THEN 15  -- < 1500 Kč
         ELSE 0
    END AS pick_score
FROM catalog.events e
JOIN catalog.ticket_types tt ON tt.event_id = e.id
WHERE e.status = 'published'
  AND e.date_start > NOW()
  AND tt.visibility = 'public'
  AND tt.remaining_qty > 0
ORDER BY pick_score DESC;

COMMENT ON VIEW catalog.vw_top_picks IS
  'TM-style Top Picks per event. Higher pick_score = better deal (low price + available).';

COMMIT;
