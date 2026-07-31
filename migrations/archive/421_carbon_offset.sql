-- Migration 421: Carbon offset v checkoutu
-- Kupující si může připlatit za kompenzaci uhlíkové stopy objednávky.
-- Výše příplatku je platformový setting (default 50 Kč / 5 000 halíř).
-- Platby jdou do zvláštního fondu; promotér se podílí 0 % (jde celé do offsetu).

ALTER TABLE orders.orders ADD COLUMN IF NOT EXISTS carbon_offset_halire int NOT NULL DEFAULT 0;

-- Platformový setting: výše offset příplatku
CREATE TABLE IF NOT EXISTS platform.carbon_offset_settings (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  amount_halire int         NOT NULL DEFAULT 5000, -- 50 Kč
  label_cs      text        NOT NULL DEFAULT 'Kompenzace CO₂ emisí vaší cesty na akci (50 Kč)',
  label_sk      text        NOT NULL DEFAULT 'Kompenzácia CO₂ emisií vašej cesty na akciu (50 Kč)',
  label_en      text        NOT NULL DEFAULT 'CO₂ travel offset for your event trip (50 CZK)',
  provider      text        NOT NULL DEFAULT 'mossy_earth', -- offsetový partner
  active        boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO platform.carbon_offset_settings (amount_halire, active) VALUES (5000, true)
  ON CONFLICT DO NOTHING;

-- RLS
ALTER TABLE platform.carbon_offset_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY carbon_offset_settings_public_select ON platform.carbon_offset_settings
  FOR SELECT USING (true);
CREATE POLICY carbon_offset_settings_admin_write ON platform.carbon_offset_settings
  FOR ALL USING (current_setting('app.is_platform_admin', true) = 'true');
