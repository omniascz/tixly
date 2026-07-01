-- 445: „No-surge" záruka poctivé ceny
--
-- Pořadatel může u akce slíbit, že cena NIKDY nepřekročí zveřejněnou základní cenu
-- (dynamic pricing pak smí jen zlevňovat, ne zdražovat). Diferenciátor proti drip/surge
-- pricingu konkurence (Ticketmaster Platinum, Eventim). Vynucuje dynamic-engine.

ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS no_surge_pledge boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN catalog.events.no_surge_pledge IS
  'Poctivá cena: když true, dynamic pricing nikdy nezdraží nad base_price (jen slevy). Veřejná záruka.';
