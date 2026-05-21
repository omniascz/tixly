-- 299_eventim_fansale_reissue.sql
-- Eventim Parity Fáze E3 — fanSALE complete:
-- 1. Per-event resale policy (enabled, deadline, kdo platí poplatky)
-- 2. Barcode-based listing authentication
-- 3. Re-issue flow (originál revoke, mint novou vstupenku)
-- 4. Seller payout queue (4 dny po doručení)
-- 5. Combo/bundle exclusion

BEGIN;

-- ============================================================
-- 1. Per-event resale policy
-- ============================================================
ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS resale_policy text NOT NULL DEFAULT 'enabled'
    CHECK (resale_policy IN ('enabled', 'disabled', 'restricted')),
  ADD COLUMN IF NOT EXISTS resale_window_hours_before integer DEFAULT 24,
  ADD COLUMN IF NOT EXISTS resale_fee_pct numeric(5,2) NOT NULL DEFAULT 5.00,
  ADD COLUMN IF NOT EXISTS resale_seller_payout_delay_days integer NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS resale_combo_excluded boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN catalog.events.resale_policy IS
  'enabled = unrestricted, disabled = no resale, restricted = jen určité ticket types (per ticket_types.resale_allowed)';
COMMENT ON COLUMN catalog.events.resale_window_hours_before IS
  'Deadline kdy se listings auto-expirují. Eventim Sheeran: 24h před akcí.';

-- Per ticket_type resale flag (pro restricted policy)
ALTER TABLE catalog.ticket_types
  ADD COLUMN IF NOT EXISTS resale_allowed boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_combo_bundle boolean NOT NULL DEFAULT false;

-- ============================================================
-- 2. Re-issue chain + barcode authentication na resale_listings
-- ============================================================
ALTER TABLE resale.resale_listings
  ADD COLUMN IF NOT EXISTS barcode_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS original_ticket_status_snapshot text,
  ADD COLUMN IF NOT EXISTS reissued_ticket_id uuid REFERENCES tickets.tickets(id) ON DELETE SET NULL;

COMMENT ON COLUMN resale.resale_listings.reissued_ticket_id IS
  'Při sold: originál tickets.tickets.id se revoke, vznikne nový s novým TOTP secret. Tady link na new.';

-- Re-issue chain — sledování parent → child vstupenek
ALTER TABLE tickets.tickets
  ADD COLUMN IF NOT EXISTS reissue_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reissue_parent_id uuid REFERENCES tickets.tickets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reissue_reason text;

CREATE INDEX IF NOT EXISTS idx_tickets_reissue_parent
  ON tickets.tickets(reissue_parent_id) WHERE reissue_parent_id IS NOT NULL;

-- ============================================================
-- 3. Seller payout queue
-- ============================================================
CREATE TABLE IF NOT EXISTS resale.seller_payouts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id      uuid NOT NULL REFERENCES resale.resale_listings(id) ON DELETE CASCADE,
  seller_id       uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  -- Částky
  sale_price_halire integer NOT NULL,
  resale_fee_halire integer NOT NULL,
  payout_halire   integer NOT NULL,           -- sale_price - resale_fee
  currency        text NOT NULL DEFAULT 'CZK',
  -- Bank info (seller account z onboarding)
  bank_iban       text,
  bank_account_holder text,
  -- Lifecycle
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'eligible', 'processing', 'paid', 'failed', 'reversed')),
  scheduled_for   timestamptz NOT NULL,        -- now() + delay_days
  paid_at         timestamptz,
  external_payout_id text,                     -- z banky/Wise/Stripe
  failure_reason  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seller_payouts_eligible
  ON resale.seller_payouts(scheduled_for) WHERE status IN ('pending', 'eligible');
CREATE INDEX IF NOT EXISTS idx_seller_payouts_seller
  ON resale.seller_payouts(seller_id, status);

COMMENT ON TABLE resale.seller_payouts IS
  'Eventim-style 4-day payout queue. Po doručení vstupenky (immediate v digital) se nastartuje timer; po N dnech eligible → payout.';

-- ============================================================
-- 4. Listing-time integrity check (barcode authentication)
-- ============================================================
-- Helper view: aktuální resale eligibility per ticket
CREATE OR REPLACE VIEW resale.vw_ticket_resale_eligibility AS
SELECT
  t.id AS ticket_id,
  t.owner_id,
  t.status AS ticket_status,
  t.original_price,
  tt.resale_allowed,
  tt.is_combo_bundle,
  e.resale_policy,
  e.resale_window_hours_before,
  e.resale_combo_excluded,
  e.date_start AS event_start,
  -- Resale deadline = event_start - window_hours
  (e.date_start - (e.resale_window_hours_before * INTERVAL '1 hour')) AS resale_deadline,
  CASE
    WHEN e.resale_policy = 'disabled' THEN 'event_resale_disabled'
    WHEN e.resale_policy = 'restricted' AND NOT tt.resale_allowed THEN 'ticket_type_not_resellable'
    WHEN e.resale_combo_excluded AND tt.is_combo_bundle THEN 'combo_excluded'
    WHEN t.status != 'valid' THEN 'ticket_not_valid'
    WHEN now() > (e.date_start - (e.resale_window_hours_before * INTERVAL '1 hour')) THEN 'past_deadline'
    ELSE 'eligible'
  END AS eligibility_reason,
  CASE
    WHEN e.resale_policy = 'disabled' THEN false
    WHEN e.resale_policy = 'restricted' AND NOT tt.resale_allowed THEN false
    WHEN e.resale_combo_excluded AND tt.is_combo_bundle THEN false
    WHEN t.status != 'valid' THEN false
    WHEN now() > (e.date_start - (e.resale_window_hours_before * INTERVAL '1 hour')) THEN false
    ELSE true
  END AS is_eligible
FROM tickets.tickets t
JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
JOIN orders.orders o ON o.id = t.order_id
JOIN catalog.events e ON e.id = o.event_id;

COMMENT ON VIEW resale.vw_ticket_resale_eligibility IS
  'O(1) resale gate per ticket — vrací is_eligible + machine-readable reason.';

INSERT INTO public.schema_migrations (filename)
VALUES ('299_eventim_fansale_reissue.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
