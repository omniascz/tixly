-- 494_vat_rates.sql
--   Kolo 7 / C-54 — sazby DPH jako konfigurační data (ne natvrdo v kódu).
--
-- ZDROJ hodnot (ověřeno 2026-10-04):
--   * Zákon č. 235/2004 Sb., o dani z přidané hodnoty, § 47 odst. 1 (znění účinné od 1. 1. 2026,
--     verze 69 dle zakonyprolidi.cz/cs/2004-235): „a) základní sazba daně ve výši 21 %, nebo
--     b) snížená sazba daně ve výši 12 %"; § 47 odst. 2: sazba platná ke dni vzniku povinnosti
--     přiznat daň (den uskutečnění zdanitelného plnění, § 20a).
--   * Generální finanční ředitelství: „Informace GFŘ ke změnám sazeb DPH od 1. 1. 2024"
--     (financnisprava.gov.cz/assets/cs/prilohy/d-seznam-dani/Informace_GFR_ke_zmenam_sazeb_DPH_od_1_1_2024.pdf):
--     od 1. 1. 2024 (zákon č. 349/2023 Sb.) základní 21 %, jediná snížená 12 %; příloha č. 2,
--     CZ-CPA 59.14, 90, 91, 93 „Poskytnutí oprávnění ke vstupu na představení, do divadel, …,
--     na koncerty, …, do kin, na výstavy a na podobné kulturní události" = snížená sazba.
--
-- Modelu: kód sazby (CZ_STANDARD, CZ_REDUCED) → procenta s platností od–do (včetně, NULL = dosud).
-- Typ vstupenky odkazuje na kód sazby; procento se bere k datu uskutečnění plnění
-- (platform.vat_rate_at). Překryv platností téhož kódu zakazuje EXCLUDE.
-- Idempotentní.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS platform.vat_rate_codes (
  code     text PRIMARY KEY CHECK (code ~ '^[A-Z]{2}_[A-Z_]+$'),
  country  char(2) NOT NULL,
  label    text NOT NULL
);

CREATE TABLE IF NOT EXISTS platform.vat_rates (
  code        text NOT NULL REFERENCES platform.vat_rate_codes(code),
  rate_pct    numeric(5,2) NOT NULL CHECK (rate_pct >= 0 AND rate_pct < 100),
  valid_from  date NOT NULL,
  valid_to    date,
  source      text NOT NULL,
  PRIMARY KEY (code, valid_from),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vat_rates_no_overlap') THEN
    ALTER TABLE platform.vat_rates
      ADD CONSTRAINT vat_rates_no_overlap
      EXCLUDE USING gist (code WITH =, daterange(valid_from, valid_to, '[]') WITH &&);
  END IF;
END $$;

INSERT INTO platform.vat_rate_codes (code, country, label) VALUES
  ('CZ_STANDARD', 'CZ', 'Základní sazba DPH'),
  ('CZ_REDUCED',  'CZ', 'Snížená sazba DPH (mj. vstupné na kulturní akce)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO platform.vat_rates (code, rate_pct, valid_from, valid_to, source) VALUES
  ('CZ_STANDARD', 21.00, DATE '2024-01-01', NULL,
   'Zákon 235/2004 Sb. § 47 odst. 1 písm. a) ve znění zák. 349/2023 Sb.; Informace GFŘ ke změnám sazeb DPH od 1. 1. 2024'),
  ('CZ_REDUCED',  12.00, DATE '2024-01-01', NULL,
   'Zákon 235/2004 Sb. § 47 odst. 1 písm. b) ve znění zák. 349/2023 Sb., příloha č. 2 (CZ-CPA 59.14, 90, 91, 93); Informace GFŘ ke změnám sazeb DPH od 1. 1. 2024')
ON CONFLICT (code, valid_from) DO NOTHING;

-- Sazba platná k datu uskutečnění plnění; NULL = pro dané datum není sazba (doklad nevznikne).
CREATE OR REPLACE FUNCTION platform.vat_rate_at(p_code text, p_date date)
RETURNS numeric
LANGUAGE sql STABLE
SET search_path = platform, pg_temp
AS $$
  SELECT rate_pct FROM platform.vat_rates
   WHERE code = p_code AND valid_from <= p_date AND (valid_to IS NULL OR valid_to >= p_date)
$$;

-- Číselník je veřejný údaj: čtení pro všechny, zápis jen migrací (vlastník DB).
ALTER TABLE platform.vat_rate_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.vat_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_vat_rate_codes_read ON platform.vat_rate_codes;
CREATE POLICY p_vat_rate_codes_read ON platform.vat_rate_codes FOR SELECT USING (true);
DROP POLICY IF EXISTS p_vat_rates_read ON platform.vat_rates;
CREATE POLICY p_vat_rates_read ON platform.vat_rates FOR SELECT USING (true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tixly_app') THEN
    GRANT SELECT ON platform.vat_rate_codes, platform.vat_rates TO tixly_app;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON platform.vat_rate_codes, platform.vat_rates FROM tixly_app;
    GRANT EXECUTE ON FUNCTION platform.vat_rate_at(text, date) TO tixly_app;
  END IF;
END $$;

-- Sazba na typu vstupenky (odkaz na kód). Neplátce ji nevyplňuje; plátce u placeného typu musí.
ALTER TABLE catalog.ticket_types
  ADD COLUMN IF NOT EXISTS vat_rate_code text REFERENCES platform.vat_rate_codes(code);

COMMENT ON COLUMN catalog.ticket_types.vat_rate_code IS
  'Kód sazby DPH (platform.vat_rate_codes). Povinné u placeného typu plátce DPH (kolo 7, C-54).';
COMMENT ON COLUMN platform.promoters.vat_rate_pct IS
  'ZASTARALÉ (kolo 7): doklady berou sazbu z typu vstupenky (catalog.ticket_types.vat_rate_code).';

-- Připravenost akce k publikaci/prodeji z pohledu DPH. SECURITY DEFINER: kupcové cesty běží pod
-- různými RLS kontexty a údaje pořadatele nevidí; funkce vrací jen kódy problémů (žádná data).
--   VAT_DIC_MISSING     plátce DPH bez platného DIČ (CZ + 8–10 číslic)
--   VAT_RATE_MISSING    placený typ vstupenky plátce bez kódu sazby
--   VAT_RATE_NOT_VALID  kód sazby nemá k datu akce platné procento
CREATE OR REPLACE FUNCTION catalog.event_vat_readiness(p_event uuid)
RETURNS TABLE(problem text, ticket_type_id uuid, ticket_type_name text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = catalog, platform, pg_temp
AS $$
  SELECT 'VAT_DIC_MISSING'::text, NULL::uuid, NULL::text
    FROM catalog.events e JOIN platform.promoters p ON p.id = e.promoter_id
   WHERE e.id = p_event AND p.vat_payer
     AND (p.company_dic IS NULL OR btrim(p.company_dic) !~ '^CZ[0-9]{8,10}$')
  UNION ALL
  SELECT CASE WHEN tt.vat_rate_code IS NULL THEN 'VAT_RATE_MISSING' ELSE 'VAT_RATE_NOT_VALID' END,
         tt.id, tt.name
    FROM catalog.events e
    JOIN platform.promoters p ON p.id = e.promoter_id
    JOIN catalog.ticket_types tt ON tt.event_id = e.id
   WHERE e.id = p_event AND p.vat_payer AND tt.base_price > 0
     AND (tt.vat_rate_code IS NULL OR platform.vat_rate_at(tt.vat_rate_code, (e.date_start AT TIME ZONE 'Europe/Prague')::date) IS NULL)
$$;
REVOKE ALL ON FUNCTION catalog.event_vat_readiness(uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tixly_app') THEN
    GRANT EXECUTE ON FUNCTION catalog.event_vat_readiness(uuid) TO tixly_app;
  END IF;
END $$;
