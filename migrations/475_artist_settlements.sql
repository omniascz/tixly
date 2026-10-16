--
-- 475_artist_settlements.sql
--   lineups.artist_settlements — vyuctovani s umelcem jako UZAVRENY snimek
--
-- ── Proc snimek, a ne zivy dotaz ─────────────────────────────────────────────
-- Agent dostane po akci jednu stranku s cislem a podepise ji. Kdyz mu tentyz
-- odkaz za tyden ukaze jine cislo (protoze mezitim prisel refund), je konec
-- duvery. Uzavrenim se cisla zmrazi; pozdejsi zmeny jdou do dodatku, ktery je
-- videt zvlast.
--
-- Proto se vsechny castky ukladaji do sloupcu, ne dopocitavaji z prodeju.
-- `lines` drzi rozpad vypoctu presne tak, jak byl v okamziku uzavreni —
-- vcetne popisku, aby sel dokument znovu vytisknout beze zmeny.
--
-- ── Podpis ───────────────────────────────────────────────────────────────────
-- compliance.e_signatures ma user_id NOT NULL, takze se pro umelce/agenta
-- nehodi — ti u nas ucet nemaji a mit nemusi. Podpis se proto uklada primo
-- na dokument: jmeno, e-mail, cas, maskovana IP a otisk dokumentu. Metodika
-- je stejna jako u eIDAS SES v lib/compliance/e-signature.ts.
--

BEGIN;

CREATE TABLE IF NOT EXISTS lineups.artist_settlements (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id      uuid NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
    promoter_id   uuid NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
    agreement_id  uuid NOT NULL REFERENCES lineups.royalty_agreements(id) ON DELETE RESTRICT,
    artist_name   text NOT NULL,
    artist_email  text,
    currency      text NOT NULL DEFAULT 'CZK',

    status        text NOT NULL DEFAULT 'draft',

    -- Zmrazeny snimek akce
    capacity              integer NOT NULL DEFAULT 0,
    tickets_sold          integer NOT NULL DEFAULT 0,
    gross_revenue_minor   integer NOT NULL DEFAULT 0,
    ticket_vat_rate_pct   integer NOT NULL DEFAULT 0,
    net_revenue_minor     integer NOT NULL DEFAULT 0,
    fixed_costs_minor     integer NOT NULL DEFAULT 0,
    per_attendee_cost_minor integer NOT NULL DEFAULT 0,

    -- Zmrazeny vypocet honorare
    fee_minor         integer NOT NULL DEFAULT 0,
    share_minor       integer NOT NULL DEFAULT 0,
    deposit_minor     integer NOT NULL DEFAULT 0,
    withholding_minor integer NOT NULL DEFAULT 0,
    payable_minor     integer NOT NULL DEFAULT 0,
    lines             jsonb   NOT NULL DEFAULT '[]'::jsonb,

    closed_at         timestamptz,
    closed_by_user_id uuid,

    -- Podpis (eIDAS SES)
    signed_at       timestamptz,
    signer_name     text,
    signer_email    text,
    signer_ip       text,
    document_hash   text,

    -- Vyplata, ktera z vyuctovani vznikla
    payout_id     uuid REFERENCES lineups.artist_payouts(id) ON DELETE SET NULL,

    -- Dodatek k drive uzavrenemu vyuctovani (refund po akci apod.)
    supersedes_id uuid REFERENCES lineups.artist_settlements(id) ON DELETE SET NULL,

    notes         text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT artist_settlements_status_check
      CHECK (status = ANY (ARRAY['draft'::text, 'closed'::text, 'signed'::text, 'void'::text])),
    CONSTRAINT artist_settlements_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
    -- Uzavrene vyuctovani musi mit cas uzavreni a otisk dokumentu.
    CONSTRAINT artist_settlements_closed_fields
      CHECK (status = 'draft' OR status = 'void' OR (closed_at IS NOT NULL AND document_hash IS NOT NULL))
);

-- Jedno rozpracovane vyuctovani na smlouvu. Uzavrenych muze byt vic (dodatky).
CREATE UNIQUE INDEX IF NOT EXISTS idx_artist_settlements_one_draft
  ON lineups.artist_settlements (agreement_id) WHERE status = 'draft';
CREATE INDEX IF NOT EXISTS idx_artist_settlements_event ON lineups.artist_settlements (event_id);
CREATE INDEX IF NOT EXISTS idx_artist_settlements_promoter ON lineups.artist_settlements (promoter_id);

COMMENT ON TABLE lineups.artist_settlements IS
  'Uzavreny snimek vyuctovani s umelcem. Po uzavreni se cisla nemeni — zmena jde do dodatku.';
COMMENT ON COLUMN lineups.artist_settlements.lines IS
  'Rozpad vypoctu v okamziku uzavreni: [{key,label,amountMinor}].';
COMMENT ON COLUMN lineups.artist_settlements.supersedes_id IS
  'Dodatek nahrazujici drive uzavrene vyuctovani (napr. po refundech).';

ALTER TABLE lineups.artist_settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_artist_settlements_scope ON lineups.artist_settlements;
CREATE POLICY p_artist_settlements_scope ON lineups.artist_settlements
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id());

COMMIT;
