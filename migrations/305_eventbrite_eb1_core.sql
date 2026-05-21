-- 305_eventbrite_eb1_core.sql
-- Eventbrite Parity Fáze EB1 — 5 core features:
-- 1. Donation tickets (schema z migrace 160 už existuje — jen extend)
-- 2. Group ticket discounts (auto kvantity slevy)
-- 3. Ticket changes (buyer self-service swap typu/data)
-- 4. Attendee info changes (post-purchase edit jména/emailu na ticket)
-- 5. Event clone (kód-only, schema nepotřeba)

BEGIN;

-- ============================================================
-- 1. Donation tickets — extend (schema má 160, doplníme metadata)
-- ============================================================
-- Příjemce donace pro distribuci do charity organizace
ALTER TABLE catalog.donation_campaigns
  ADD COLUMN IF NOT EXISTS beneficiary_org_name text,
  ADD COLUMN IF NOT EXISTS beneficiary_bank_iban text,
  ADD COLUMN IF NOT EXISTS beneficiary_url text,
  ADD COLUMN IF NOT EXISTS thank_you_message text,
  ADD COLUMN IF NOT EXISTS cover_image_url text;

-- ============================================================
-- 2. Group ticket discounts — quantity-based auto slevy
-- ============================================================
CREATE TABLE IF NOT EXISTS catalog.group_discount_tiers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_type_id      uuid NOT NULL REFERENCES catalog.ticket_types(id) ON DELETE CASCADE,
  min_quantity        integer NOT NULL CHECK (min_quantity >= 2),
  -- Sleva: buď flat haléřů nebo pct
  discount_pct        numeric(5,2),
  discount_flat_halire integer,
  -- Label pro UI ("Skupina 5+", "10 lístků = 20 %")
  label               text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (discount_pct IS NOT NULL OR discount_flat_halire IS NOT NULL),
  UNIQUE (ticket_type_id, min_quantity)
);

CREATE INDEX IF NOT EXISTS idx_group_discount_tt
  ON catalog.group_discount_tiers(ticket_type_id);

COMMENT ON TABLE catalog.group_discount_tiers IS
  'Per ticket_type kvantity slevy. Eg. 5+ = -10 %, 10+ = -20 %. Engine vybere nejvyšší match.';

-- ============================================================
-- 3. Ticket Changes (self-service swap)
-- ============================================================
CREATE TABLE IF NOT EXISTS tickets.ticket_changes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id           uuid NOT NULL REFERENCES tickets.tickets(id) ON DELETE CASCADE,
  -- Co se mění
  change_type         text NOT NULL CHECK (change_type IN
                        ('ticket_type', 'event', 'date', 'seat')),
  old_ticket_type_id  uuid REFERENCES catalog.ticket_types(id) ON DELETE SET NULL,
  new_ticket_type_id  uuid REFERENCES catalog.ticket_types(id) ON DELETE SET NULL,
  old_event_id        uuid REFERENCES catalog.events(id) ON DELETE SET NULL,
  new_event_id        uuid REFERENCES catalog.events(id) ON DELETE SET NULL,
  old_seat_id         uuid REFERENCES catalog.event_seats(id) ON DELETE SET NULL,
  new_seat_id         uuid REFERENCES catalog.event_seats(id) ON DELETE SET NULL,
  -- Pricing diff
  price_diff_halire   integer NOT NULL DEFAULT 0,  -- positive = buyer doplácí
  refund_amount_halire integer NOT NULL DEFAULT 0, -- pokud nová cena nižší
  -- Audit
  initiated_by_user_id uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  initiated_by         text NOT NULL CHECK (initiated_by IN ('buyer', 'promoter', 'support')),
  reason              text,
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'completed', 'rejected', 'cancelled')),
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_changes_ticket
  ON tickets.ticket_changes(ticket_id, created_at DESC);

COMMENT ON TABLE tickets.ticket_changes IS
  'Audit log + state machine pro Eventbrite-style ticket swap (typ/event/datum/sedadlo).';

-- Per-event policy zda jsou ticket changes povolené
ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS allow_ticket_changes boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ticket_change_deadline_hours_before integer DEFAULT 24;

-- ============================================================
-- 4. Attendee Info Changes — edit jména/emailu post-purchase
-- ============================================================
CREATE TABLE IF NOT EXISTS tickets.attendee_info (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id           uuid NOT NULL REFERENCES tickets.tickets(id) ON DELETE CASCADE UNIQUE,
  first_name          text,
  last_name           text,
  email               text,
  phone               text,
  -- Last update tracking
  updated_by_user_id  uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attendee_info_email
  ON tickets.attendee_info(LOWER(email)) WHERE email IS NOT NULL;

COMMENT ON TABLE tickets.attendee_info IS
  'Per-ticket attendee identity (kdo na lístku jde, ne kdo ho koupil). Eventbrite "Each attendee" mode.';

-- Audit log změn
CREATE TABLE IF NOT EXISTS tickets.attendee_info_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       uuid NOT NULL REFERENCES tickets.tickets(id) ON DELETE CASCADE,
  field_name      text NOT NULL,            -- 'first_name', 'email', ...
  old_value       text,
  new_value       text,
  changed_by_user_id uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  changed_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attendee_info_log_ticket
  ON tickets.attendee_info_log(ticket_id, changed_at DESC);

-- ============================================================
-- 5. Event Clone — žádné schema, jen kód
-- (clone copies catalog.events row + ticket_types + custom_fields + promo_codes)
-- ============================================================

INSERT INTO public.schema_migrations (filename)
VALUES ('305_eventbrite_eb1_core.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
