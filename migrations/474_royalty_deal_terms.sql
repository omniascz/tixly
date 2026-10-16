--
-- 474_royalty_deal_terms.sql
--   lineups.royalty_agreements — podminky honorare podle skutecne praxe
--
-- ── Co dosud slo sjednat ─────────────────────────────────────────────────────
-- procento z trzby / pevna castka / castka na vstupenku / kombinace,
-- k tomu minimalni garance a strop. To pokryje bezny klub.
--
-- ── Co pokryt neslo a pridava se ─────────────────────────────────────────────
-- • `deposit_minor`    — zaloha zaplacena pri podpisu, odecita se z konecneho
--                        vyuctovani. Bez ni se zaloha zapocitava rucne a mizi.
-- • `backend_pct`      — podil z toho, co zbude POTE, co poradatel pokryje
--                        naklady vcetne garance. Nejcastejsi model u vetsich
--                        jmen („garance + 70 % nad breakeven").
-- • `bonus_tiers`      — priplatky pri dosazeni prodeje (napr. pri vyprodani).
-- • `split_pct`        — podil umelce na spolecnem honorari, kdyz na akci hraje
--                        vic ucinkujicich s jinym klicem.
-- • `percent_base`     — z ceho se procento pocita. Dosavadni chovani pocitalo
--                        z ceny VCETNE DPH (order_items.total_price), coz je pro
--                        platce DPH nevyhodne a v branzi se to sjednava ruzne.
--                        Vychozi hodnota zachovava dosavadni chovani.
-- • `withholding_tax_pct` + `tax_residency` — srazkova dan u zahranicnich
--                        umelcu. Poradatel ji sraz i u zdroje a odvadi za umelce;
--                        dosud v systemu nebyla ani zminka.
--
-- Vsechny sloupce jsou nullable nebo maji default, takze existujici smlouvy
-- se chovaji presne jako dosud.
--

BEGIN;

ALTER TABLE lineups.royalty_agreements
  ADD COLUMN IF NOT EXISTS deposit_minor integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS backend_pct numeric(5,2),
  ADD COLUMN IF NOT EXISTS bonus_tiers jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS split_pct numeric(5,2) NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS percent_base text NOT NULL DEFAULT 'gross',
  ADD COLUMN IF NOT EXISTS withholding_tax_pct numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_residency text;

ALTER TABLE lineups.royalty_agreements
  DROP CONSTRAINT IF EXISTS royalty_agreements_deposit_check;
ALTER TABLE lineups.royalty_agreements
  ADD CONSTRAINT royalty_agreements_deposit_check CHECK (deposit_minor >= 0);

ALTER TABLE lineups.royalty_agreements
  DROP CONSTRAINT IF EXISTS royalty_agreements_backend_check;
ALTER TABLE lineups.royalty_agreements
  ADD CONSTRAINT royalty_agreements_backend_check
  CHECK (backend_pct IS NULL OR (backend_pct >= 0 AND backend_pct <= 100));

ALTER TABLE lineups.royalty_agreements
  DROP CONSTRAINT IF EXISTS royalty_agreements_split_check;
ALTER TABLE lineups.royalty_agreements
  ADD CONSTRAINT royalty_agreements_split_check
  CHECK (split_pct > 0 AND split_pct <= 100);

ALTER TABLE lineups.royalty_agreements
  DROP CONSTRAINT IF EXISTS royalty_agreements_percent_base_check;
ALTER TABLE lineups.royalty_agreements
  ADD CONSTRAINT royalty_agreements_percent_base_check
  CHECK (percent_base = ANY (ARRAY['gross'::text, 'net_of_vat'::text]));

ALTER TABLE lineups.royalty_agreements
  DROP CONSTRAINT IF EXISTS royalty_agreements_withholding_check;
ALTER TABLE lineups.royalty_agreements
  ADD CONSTRAINT royalty_agreements_withholding_check
  CHECK (withholding_tax_pct >= 0 AND withholding_tax_pct <= 100);

ALTER TABLE lineups.royalty_agreements
  DROP CONSTRAINT IF EXISTS royalty_agreements_residency_check;
ALTER TABLE lineups.royalty_agreements
  ADD CONSTRAINT royalty_agreements_residency_check
  CHECK (tax_residency IS NULL OR tax_residency ~ '^[A-Z]{2}$');

-- Tvar bonusovych hladin hlida aplikace; v DB stacime overit, ze je to pole.
ALTER TABLE lineups.royalty_agreements
  DROP CONSTRAINT IF EXISTS royalty_agreements_bonus_tiers_check;
ALTER TABLE lineups.royalty_agreements
  ADD CONSTRAINT royalty_agreements_bonus_tiers_check
  CHECK (jsonb_typeof(bonus_tiers) = 'array');

COMMENT ON COLUMN lineups.royalty_agreements.deposit_minor IS
  'Zaloha zaplacena pri podpisu (halire). Odecita se z konecneho vyuctovani.';
COMMENT ON COLUMN lineups.royalty_agreements.backend_pct IS
  'Podil umelce (%) z castky, ktera zbyde po pokryti nakladu akce vcetne garance.';
COMMENT ON COLUMN lineups.royalty_agreements.bonus_tiers IS
  'Pole [{"atTickets":300,"amountMinor":500000}] nebo [{"atSelloutPct":90,"amountMinor":...}].';
COMMENT ON COLUMN lineups.royalty_agreements.split_pct IS
  'Podil tohoto umelce na spolecnem honorari, kdyz hraje vic ucinkujicich.';
COMMENT ON COLUMN lineups.royalty_agreements.percent_base IS
  'gross = z ceny vcetne DPH (dosavadni chovani), net_of_vat = ze zakladu bez DPH.';
COMMENT ON COLUMN lineups.royalty_agreements.withholding_tax_pct IS
  'Srazkova dan u zdroje. Poradatel ji sraz i z honorare a odvadi za umelce.';

COMMIT;
