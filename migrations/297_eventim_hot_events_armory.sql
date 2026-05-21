-- 297_eventim_hot_events_armory.sql
-- Eventim Parity Fáze E1 — Hot Events anti-scalp arsenal:
-- 1. Hidden-until-event QR (QR reveal X minut před akcí)
-- 2. Max tickets per buyer per event cap
-- 3. TAN SMS validace po nákupu
-- 4. Phone-number Pass binding (lístek se zobrazí jen majiteli čísla)
-- 5. No-gifting mode pro hot events

BEGIN;

-- ============================================================
-- 1. Hot event mode flags na catalog.events
-- ============================================================
ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS hot_event_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_tickets_per_buyer integer,
  ADD COLUMN IF NOT EXISTS qr_reveal_minutes_before integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS require_tan_validation boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS require_phone_binding boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS no_gifting_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS require_photo_id boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN catalog.events.hot_event_mode IS
  'Master switch — když true, povinné: phone binding + TAN + qr_reveal_minutes + no_gifting (Sheeran-style).';
COMMENT ON COLUMN catalog.events.max_tickets_per_buyer IS
  'Anti-scalp cap. Buyer s tímto e-mailem nebo telefonem nemůže koupit víc.';
COMMENT ON COLUMN catalog.events.qr_reveal_minutes_before IS
  'Minutes před date_start kdy se QR/barcode zobrazí v UI. 0 = vidíš ihned, 120 = až 2h před.';

-- ============================================================
-- 2. TAN codes — SMS one-time validation
-- ============================================================
CREATE TABLE IF NOT EXISTS identity.tan_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  phone_e164      text NOT NULL,
  code            text NOT NULL,             -- 6-digit
  purpose         text NOT NULL CHECK (purpose IN ('order_validation', 'phone_change', 'login')),
  related_id      uuid,                       -- order_id pro 'order_validation', user_id pro 'phone_change'
  expires_at      timestamptz NOT NULL DEFAULT (now() + INTERVAL '15 minutes'),
  consumed_at     timestamptz,
  attempts        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tan_codes_user_purpose
  ON identity.tan_codes(user_id, purpose) WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tan_codes_phone
  ON identity.tan_codes(phone_e164, purpose, consumed_at);

COMMENT ON TABLE identity.tan_codes IS
  'Eventim-style 6-digit TAN codes přes SMS. Validace objednávky / změny čísla / 2FA login.';

-- ============================================================
-- 3. Phone-number binding na tickets
-- ============================================================
ALTER TABLE tickets.tickets
  ADD COLUMN IF NOT EXISTS bound_phone_e164 text,
  ADD COLUMN IF NOT EXISTS phone_bound_at timestamptz,
  ADD COLUMN IF NOT EXISTS phone_change_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS phone_change_review_status text
    CHECK (phone_change_review_status IN (NULL, 'pending', 'approved', 'rejected'));

CREATE INDEX IF NOT EXISTS idx_tickets_bound_phone
  ON tickets.tickets(bound_phone_e164) WHERE bound_phone_e164 IS NOT NULL;

COMMENT ON COLUMN tickets.tickets.bound_phone_e164 IS
  'Eventim Pass-style binding. Lístek se zobrazí jen uživateli s tímto číslem. Změna jen přes admin review.';

-- ============================================================
-- 4. Phone change requests (Eventim 14-day review)
-- ============================================================
CREATE TABLE IF NOT EXISTS identity.phone_change_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       uuid NOT NULL REFERENCES tickets.tickets(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  old_phone_e164  text NOT NULL,
  new_phone_e164  text NOT NULL,
  reason          text NOT NULL,
  id_document_url text,                       -- doklad totožnosti (uploaded blob)
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  review_notes    text,
  reviewed_by_user_id uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  reviewed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- 14-day expected resolution
  expected_resolution_at timestamptz NOT NULL DEFAULT (now() + INTERVAL '14 days')
);

CREATE INDEX IF NOT EXISTS idx_phone_change_pending
  ON identity.phone_change_requests(status, created_at) WHERE status = 'pending';

-- ============================================================
-- 4.5 orders.tan_validated_at flag
-- ============================================================
ALTER TABLE orders.orders
  ADD COLUMN IF NOT EXISTS tan_validated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_orders_tan_pending
  ON orders.orders(event_id, created_at) WHERE tan_validated_at IS NULL;

-- ============================================================
-- 5. Buyer purchase counts per event (anti-scalp enforcement)
-- ============================================================
-- Materializace pro fast checkout-time enforcement.
-- Update přes trigger nebo jako součást order paid flow.
CREATE TABLE IF NOT EXISTS orders.buyer_event_purchases (
  user_id         uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  event_id        uuid NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  tickets_count   integer NOT NULL DEFAULT 0,
  last_purchase_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_buyer_event_purchases_event
  ON orders.buyer_event_purchases(event_id);

-- Phone-level enforcement (i pokud buyer udělá víc účtů)
CREATE TABLE IF NOT EXISTS orders.phone_event_purchases (
  phone_e164      text NOT NULL,
  event_id        uuid NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  tickets_count   integer NOT NULL DEFAULT 0,
  last_purchase_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (phone_e164, event_id)
);

COMMENT ON TABLE orders.buyer_event_purchases IS
  'Materialized count per (user, event) — pro O(1) anti-scalp check při checkout.';

INSERT INTO public.schema_migrations (filename)
VALUES ('297_eventim_hot_events_armory.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
