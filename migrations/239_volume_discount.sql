-- Volume Discount (skupinová sleva) — Schema
-- Pravidla per ticket type: od X kusů sleva Y %.
-- Aplikuje se v checkoutu před promo kódem; tieru se vybere ten s nejvyšším min_qty <= requested quantity.

BEGIN;

CREATE TABLE catalog.volume_discount_rules (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_type_id  UUID         NOT NULL REFERENCES catalog.ticket_types(id) ON DELETE CASCADE,
  min_qty         INTEGER      NOT NULL CHECK (min_qty >= 2),
  discount_pct    INTEGER      NOT NULL CHECK (discount_pct > 0 AND discount_pct <= 90),
  active          BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_volume_discount_tier UNIQUE (ticket_type_id, min_qty)
);

CREATE INDEX idx_volume_discount_ticket_type
  ON catalog.volume_discount_rules (ticket_type_id)
  WHERE active = TRUE;

COMMENT ON COLUMN catalog.volume_discount_rules.min_qty IS
  'Minimální počet vstupenek v objednávce pro aktivaci slevy. Tier s nejvyšším min_qty <= requested wins.';
COMMENT ON COLUMN catalog.volume_discount_rules.discount_pct IS
  'Procentní sleva 1–90. Aplikuje se na (unit_price * quantity) před případným promo kódem.';

COMMIT;
