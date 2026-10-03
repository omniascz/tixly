--
-- 473_event_costs.sql
--   catalog.event_costs — rozpocet akce (naklady), zaklad pro bod zlomu
--
-- ── Proc ─────────────────────────────────────────────────────────────────────
-- V systemu byl vyhled trzeb (revenue.projections), ale nikde naklady. Trzba
-- bez nakladu neodpovida na jedinou otazku, kterou si poradatel klade kazdy den:
-- kolik vstupenek jeste chybi, aby akce nebyla ztratova.
--
-- ── Klicove rozhodnuti: pevny naklad vs. naklad na navstevnika ───────────────
-- Bod zlomu nejde spocitat, kdyz se tyhle dva druhy micha dohromady. Pronajem
-- salu je pevny (stoji stejne pri 50 i 500 lidech), zatimco naramek, tisk
-- vstupenky nebo poplatek za odbaveni roste s kazdym navstevnikem a snizuje
-- prispevek kazde prodane vstupenky. Proto `is_per_attendee`.
--
-- ── Castky ──────────────────────────────────────────────────────────────────
-- Vse v halirich (INTEGER), jako zbytek platformy. `amount_minor` je ZAKLAD bez
-- DPH; `vat_rate_pct` je sazba na vstupu. Poradatel-platce DPH pocita bod zlomu
-- ze zakladu (DPH si odecte), neplatce z castky vcetne dane — proto se uklada
-- oboji a rozhodne se az pri vypoctu.
--

BEGIN;

CREATE TABLE IF NOT EXISTS catalog.event_costs (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id      uuid NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
    promoter_id   uuid NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
    category      text NOT NULL,
    description   text NOT NULL,
    amount_minor  integer NOT NULL,
    vat_rate_pct  integer NOT NULL DEFAULT 21,
    is_per_attendee boolean NOT NULL DEFAULT false,
    supplier      text,
    due_date      date,
    paid          boolean NOT NULL DEFAULT false,
    paid_at       timestamptz,
    -- Vazba na honorar umelce: polozka vznikla ze schvalene nabidky (faze F).
    -- Takovou polozku nelze rucne prepsat, aby se cislo v rozpoctu nerozeslo
    -- s cislem ve smlouve.
    royalty_agreement_id uuid REFERENCES lineups.royalty_agreements(id) ON DELETE SET NULL,
    notes         text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT event_costs_category_check CHECK (category = ANY (ARRAY[
      'venue',        -- pronajem salu
      'production',   -- zvuk, svetla, jeviste
      'staff',        -- porada, technici, uklid
      'artist',       -- honorare a zalohy
      'marketing',    -- reklama, plakaty, PR
      'travel',       -- doprava
      'accommodation',-- ubytovani
      'catering',     -- obcerstveni, rider
      'rights',       -- autorske poplatky (OSA/Intergram)
      'insurance',    -- pojisteni akce
      'security',     -- ostraha
      'other'
    ])),
    CONSTRAINT event_costs_amount_check CHECK (amount_minor >= 0),
    CONSTRAINT event_costs_vat_check CHECK (vat_rate_pct >= 0 AND vat_rate_pct <= 100)
);

CREATE INDEX IF NOT EXISTS idx_event_costs_event ON catalog.event_costs (event_id);
CREATE INDEX IF NOT EXISTS idx_event_costs_promoter ON catalog.event_costs (promoter_id);
CREATE INDEX IF NOT EXISTS idx_event_costs_agreement ON catalog.event_costs (royalty_agreement_id)
  WHERE royalty_agreement_id IS NOT NULL;

COMMENT ON TABLE catalog.event_costs IS
  'Polozkovy rozpocet akce. Zaklad pro bod zlomu a pro vyuctovani s umelcem.';
COMMENT ON COLUMN catalog.event_costs.is_per_attendee IS
  'TRUE = naklad roste s kazdym navstevnikem (naramek, odbaveni). FALSE = pevny naklad akce.';
COMMENT ON COLUMN catalog.event_costs.amount_minor IS
  'Zaklad bez DPH v halirich. U per-attendee polozky je to castka na jednoho navstevnika.';
COMMENT ON COLUMN catalog.event_costs.royalty_agreement_id IS
  'Polozka vznikla ze smlouvy s umelcem — v rozpoctu je jen odvozena, edituje se u smlouvy.';

ALTER TABLE catalog.event_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_event_costs_scope ON catalog.event_costs;
CREATE POLICY p_event_costs_scope ON catalog.event_costs
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id());

COMMIT;
