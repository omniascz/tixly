-- Migration: 002_default_fee_schedule
-- Globální výchozí fee schedule + pomocná DB funkce

-- ---------------------------------------------------------------------------
-- Sentinel UUID pro globální default fee schedule
-- Promotéři bez vlastního nastavení padnou zpět na tento záznam
-- ---------------------------------------------------------------------------

-- Ujistíme se, že existuje sentinel promotér (platform-level)
-- V produkci je tento promotér vytvořen při bootstrap skriptu
-- INSERT je NOOP pokud již existuje
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM platform.promoters
    WHERE id = '00000000-0000-0000-0000-000000000000'
  ) THEN
    INSERT INTO platform.promoters (id, name, email, slug)
    VALUES (
      '00000000-0000-0000-0000-000000000000',
      '__platform_default__',
      'platform@tixly.cz',
      '__platform_default__'
    );
  END IF;
END
$$;

-- Globální default fee schedule: 5 % bez fixního poplatku
INSERT INTO platform.fee_schedules (
  id,
  promoter_id,
  name,
  percentage_fee,
  fixed_fee,
  min_fee,
  max_fee,
  valid_from,
  valid_until,
  is_active
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'platform_default',
  500,   -- 5.00 %
  0,
  NULL,
  NULL,
  '2020-01-01T00:00:00Z',
  NULL,
  TRUE
) ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Pomocná funkce: najde aktivní fee schedule pro promotéra
-- Pokud neexistuje vlastní → vrátí globální default
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform.get_active_fee_schedule(p_promoter_id UUID)
RETURNS TABLE(
  id              UUID,
  promoter_id     UUID,
  percentage_fee  INTEGER,
  fixed_fee       INTEGER,
  min_fee         INTEGER,
  max_fee         INTEGER
) AS $$
  -- Nejdřív zkus vlastní aktivní schedule promotéra
  SELECT
    fs.id,
    fs.promoter_id,
    fs.percentage_fee,
    fs.fixed_fee,
    fs.min_fee,
    fs.max_fee
  FROM platform.fee_schedules fs
  WHERE fs.promoter_id = p_promoter_id
    AND fs.is_active = TRUE
    AND fs.valid_from <= NOW()
    AND (fs.valid_until IS NULL OR fs.valid_until > NOW())
  ORDER BY fs.valid_from DESC
  LIMIT 1

  UNION ALL

  -- Fallback: globální default (pouze pokud výše nenašel vlastní)
  SELECT
    fs.id,
    fs.promoter_id,
    fs.percentage_fee,
    fs.fixed_fee,
    fs.min_fee,
    fs.max_fee
  FROM platform.fee_schedules fs
  WHERE fs.promoter_id = '00000000-0000-0000-0000-000000000000'
    AND fs.is_active = TRUE
    AND fs.valid_from <= NOW()
    AND (fs.valid_until IS NULL OR fs.valid_until > NOW())
  ORDER BY fs.valid_from DESC
  LIMIT 1

  LIMIT 1;  -- výsledek: maximálně 1 řádek (vlastní nebo default)
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION platform.get_active_fee_schedule(UUID) IS
  'Vrátí aktivní fee schedule pro promotéra. Pokud nemá vlastní, použije globální platform default.';
