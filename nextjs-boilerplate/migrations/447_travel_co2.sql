-- 447: Lístek + vlak + CO₂ štítek
--
-- Cestování diváků je 70–90 % emisí akce; žádná velká platforma to neřeší.
-- Tixly: CO₂ štítek u checkoutu + „přijeď vlakem" bundle (ČD/Regiojet, na klíč).
--
-- avg_trip_km = očekávaná průměrná jednosměrná vzdálenost dojezdu na akci
-- (promotér nastaví, nebo default odhad). Slouží k výpočtu CO₂ štítku.

ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS avg_trip_km integer;

COMMENT ON COLUMN catalog.events.avg_trip_km IS
  'Očekávaná průměrná jednosměrná vzdálenost dojezdu (km) pro CO₂ štítek. NULL = default 40.';
