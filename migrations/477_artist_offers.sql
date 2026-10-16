--
-- 477_artist_offers.sql
--   lineups.artist_offers — nabidka umelci a cesta k jejimu schvaleni
--
-- ── Proc ─────────────────────────────────────────────────────────────────────
-- V systemu byl VYSLEDEK (smlouva o podilu), ale ne cesta k nemu. Chybelo
-- sestaveni nabidky, odeslani agentovi, verzovani, protinavrh a podpis.
-- Agent pritom nema duvod si u nas zakladat ucet — musi to jit odkazem.
--
-- ── Verzovani ────────────────────────────────────────────────────────────────
-- Historie zustava: kazda zmena podminek po odeslani je NOVA verze
-- (`supersedes_id`), stara se oznaci jako nahrazena. Pri dohadovani je
-- zasadni vedet, kdo co kdy nabidl.
--
-- ── Odkaz pro agenta ─────────────────────────────────────────────────────────
-- V DB je jen OTISK tokenu (sha256), nikdy samotny token — kdyby nekdo ziskal
-- pristup k databazi, odkazy tim nezneuzije. Token ma platnost; po ni odkaz
-- nic neukaze.
--
-- ── Podpis ───────────────────────────────────────────────────────────────────
-- Stejny pristup jako u vyuctovani (475): podpis na dokumentu, ne v
-- compliance.e_signatures, ktera vyzaduje user_id.
--

BEGIN;

CREATE TABLE IF NOT EXISTS lineups.artist_offers (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    promoter_id   uuid NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
    event_id      uuid REFERENCES catalog.events(id) ON DELETE CASCADE,
    date_hold_id  uuid REFERENCES catalog.venue_date_holds(id) ON DELETE SET NULL,

    version       integer NOT NULL DEFAULT 1,
    supersedes_id uuid REFERENCES lineups.artist_offers(id) ON DELETE SET NULL,

    artist_name   text NOT NULL,
    artist_email  text,
    agent_name    text,
    agent_email   text,

    -- Co se nabizi
    performance_date date,
    venue_name    text,
    set_length_minutes integer,
    currency      text NOT NULL DEFAULT 'CZK',

    -- Podminky honorare (stejny tvar jako lineups.royalty_agreements)
    royalty_type  text NOT NULL DEFAULT 'percent',
    percent_rate  numeric(8,4),
    flat_amount_halire integer,
    per_ticket_halire  integer,
    min_guarantee_halire integer,
    cap_halire    integer,
    deposit_minor integer NOT NULL DEFAULT 0,
    backend_pct   numeric(5,2),
    bonus_tiers   jsonb NOT NULL DEFAULT '[]'::jsonb,
    split_pct     numeric(5,2) NOT NULL DEFAULT 100,
    percent_base  text NOT NULL DEFAULT 'gross',
    withholding_tax_pct numeric(5,2) NOT NULL DEFAULT 0,
    tax_residency text,

    terms_note    text,
    status        text NOT NULL DEFAULT 'draft',
    valid_until   timestamptz,

    -- Odkaz pro agenta
    access_token_hash text,
    token_expires_at  timestamptz,

    sent_at       timestamptz,
    responded_at  timestamptz,
    counter_note  text,

    -- Podpis pri prijeti
    signed_at     timestamptz,
    signer_name   text,
    signer_email  text,
    signer_ip     text,
    document_hash text,

    -- Co ze schvalene nabidky vzniklo
    agreement_id  uuid REFERENCES lineups.royalty_agreements(id) ON DELETE SET NULL,
    cost_id       uuid REFERENCES catalog.event_costs(id) ON DELETE SET NULL,

    created_by_user_id uuid,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT artist_offers_status_check CHECK (status = ANY (ARRAY[
      'draft'::text, 'sent'::text, 'countered'::text, 'accepted'::text,
      'declined'::text, 'expired'::text, 'withdrawn'::text, 'superseded'::text
    ])),
    CONSTRAINT artist_offers_royalty_type_check
      CHECK (royalty_type = ANY (ARRAY['percent'::text,'flat'::text,'per_ticket'::text,'percent_plus_flat'::text])),
    CONSTRAINT artist_offers_percent_base_check
      CHECK (percent_base = ANY (ARRAY['gross'::text,'net_of_vat'::text])),
    CONSTRAINT artist_offers_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT artist_offers_split_check CHECK (split_pct > 0 AND split_pct <= 100),
    CONSTRAINT artist_offers_bonus_tiers_check CHECK (jsonb_typeof(bonus_tiers) = 'array'),
    -- Odeslana nabidka musi mit odkaz, jinak ji agent nema jak otevrit.
    CONSTRAINT artist_offers_sent_has_token
      CHECK (status <> 'sent' OR access_token_hash IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_artist_offers_promoter ON lineups.artist_offers (promoter_id);
CREATE INDEX IF NOT EXISTS idx_artist_offers_event ON lineups.artist_offers (event_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_artist_offers_token
  ON lineups.artist_offers (access_token_hash) WHERE access_token_hash IS NOT NULL;

COMMENT ON TABLE lineups.artist_offers IS
  'Nabidka umelci: verze, odeslani odkazem, protinavrh, prijeti s podpisem.';
COMMENT ON COLUMN lineups.artist_offers.access_token_hash IS
  'SHA-256 otisk tokenu z odkazu. Samotny token se v DB neuklada.';
COMMENT ON COLUMN lineups.artist_offers.cost_id IS
  'Nakladova polozka v rozpoctu akce, ktera ze schvalene nabidky vznikla.';

ALTER TABLE lineups.artist_offers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_artist_offers_scope ON lineups.artist_offers;
CREATE POLICY p_artist_offers_scope ON lineups.artist_offers
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id());

COMMIT;
