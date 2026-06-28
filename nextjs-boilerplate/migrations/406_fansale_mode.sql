-- Migration 406: fanSALE mode — tvrdý cenový strop (max = jmenovitá hodnota vstupenky)
-- Analogie Eventim fanSALE (2007): promotér zapne jedním tlačítkem, systém vynucuje 100% cap.

ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS fansale_mode boolean NOT NULL DEFAULT false;

-- Komentář: Pokud fansale_mode = true, list-for-resale route vynucuje cap 100 % (face value),
-- bez ohledu na resale_max_price_pct. V resale_listings se mode='fansale'.
