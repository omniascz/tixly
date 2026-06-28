-- Artist Royalty Payouts
-- Promotér nastaví royalty smlouvu s umělcem per akce.
-- Při každé dokončené objednávce se spočítá a uloží podíl do ledgeru.
-- Pravidelně (nebo ručně) se z ledgeru vytvoří dávka výplat ke schválení.

-- ─── Royalty agreements ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lineups.royalty_agreements (
  id                          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id                    uuid NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  promoter_id                 uuid NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  -- Umělec: buď odkaz na lineups.artists nebo volný text (např. host. umělec)
  artist_id                   uuid REFERENCES lineups.artists(id) ON DELETE SET NULL,
  artist_name                 text NOT NULL,
  artist_email                text,
  bank_iban                   text,  -- přímá výplata na IBAN
  bank_bic                    text,
  -- Typ royalty
  royalty_type                text NOT NULL DEFAULT 'percent'
                              CHECK (royalty_type IN ('percent','flat','per_ticket','percent_plus_flat')),
  percent_rate                numeric(8,4),     -- 15.0000 = 15 %
  flat_amount_halire           int,              -- pevná částka v haléřích
  per_ticket_halire            int,              -- za každý prodaný lístek
  min_guarantee_halire         int,              -- minimální garantovaná výplata
  cap_halire                   int,              -- strop výplaty
  -- Filtrace typů lístků (NULL = všechny)
  included_ticket_type_ids    uuid[],
  status                      text NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active','paused','settled','cancelled')),
  notes                       text,
  created_at                  timestamptz NOT NULL DEFAULT NOW(),
  updated_at                  timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_royalty_agreements_event ON lineups.royalty_agreements(event_id);
CREATE INDEX IF NOT EXISTS idx_royalty_agreements_promoter ON lineups.royalty_agreements(promoter_id, status);

-- ─── Royalty ledger (per-order záznamy) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS lineups.royalty_ledger (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  agreement_id          uuid NOT NULL REFERENCES lineups.royalty_agreements(id) ON DELETE CASCADE,
  order_id              uuid NOT NULL REFERENCES orders.orders(id) ON DELETE CASCADE,
  ticket_revenue_halire int NOT NULL DEFAULT 0,   -- hrubý příjem z lístků v této objednávce
  tickets_sold          int NOT NULL DEFAULT 0,
  royalty_amount_halire int NOT NULL DEFAULT 0,   -- spočítaný podíl
  created_at            timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (agreement_id, order_id)  -- idempotentní
);

CREATE INDEX IF NOT EXISTS idx_royalty_ledger_agreement ON lineups.royalty_ledger(agreement_id, created_at DESC);

-- ─── Artist payout dávky ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lineups.artist_payouts (
  id                      uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  agreement_id            uuid NOT NULL REFERENCES lineups.royalty_agreements(id),
  promoter_id             uuid NOT NULL REFERENCES platform.promoters(id),
  artist_name             text NOT NULL,
  artist_email            text,
  bank_iban               text,
  bank_bic                text,
  period_from             timestamptz,
  period_to               timestamptz,
  gross_royalties_halire  int NOT NULL DEFAULT 0,
  adjustments_halire      int NOT NULL DEFAULT 0,  -- manuální korekce (kladné/záporné)
  net_payout_halire       int NOT NULL DEFAULT 0,
  currency                text NOT NULL DEFAULT 'CZK',
  status                  text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','approved','processing','paid','failed','cancelled')),
  paid_at                 timestamptz,
  payout_method           text,   -- 'bank_transfer'|'wise'|'paypal'|'manual'
  external_ref            text,   -- ID transakce
  notes                   text,
  created_by_user_id      uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT NOW(),
  updated_at              timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_artist_payouts_promoter ON lineups.artist_payouts(promoter_id, status);
CREATE INDEX IF NOT EXISTS idx_artist_payouts_agreement ON lineups.artist_payouts(agreement_id);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE lineups.royalty_agreements ENABLE ROW LEVEL SECURITY;
CREATE POLICY royalty_agreements_svc ON lineups.royalty_agreements
  USING (current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE lineups.royalty_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY royalty_ledger_svc ON lineups.royalty_ledger
  USING (current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE lineups.artist_payouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY artist_payouts_svc ON lineups.artist_payouts
  USING (current_setting('app.bypass_rls', true) = 'on');
