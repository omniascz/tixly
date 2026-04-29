-- Migration 038: Packages v2 (Rezervační vertikála — Balíčky v2)
-- Schema: reservations

-- ---------------------------------------------------------------------------
-- reservations.packages
-- ---------------------------------------------------------------------------

CREATE TABLE reservations.packages (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id             UUID NOT NULL,
  branch_id               UUID,
  name                    VARCHAR(200) NOT NULL,
  slug                    VARCHAR(200) NOT NULL,
  description             TEXT,
  short_description       VARCHAR(500),
  package_type            VARCHAR(20) NOT NULL DEFAULT 'bundle'
                            CHECK (package_type IN ('bundle', 'series', 'membership', 'gift')),
  price_hellers           INT NOT NULL,
  original_price_hellers  INT,
  validity_days           INT,
  max_activations         INT NOT NULL DEFAULT 1,
  activations_sold        INT NOT NULL DEFAULT 0,
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  is_featured             BOOLEAN NOT NULL DEFAULT FALSE,
  sale_start              TIMESTAMPTZ,
  sale_end                TIMESTAMPTZ,
  image_url               TEXT,
  terms_text              TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT packages_promoter_slug_unique UNIQUE (promoter_id, slug),
  CONSTRAINT packages_activations_check CHECK (activations_sold <= max_activations)
);

CREATE INDEX idx_packages_promoter_active    ON reservations.packages (promoter_id, is_active);
CREATE INDEX idx_packages_promoter_featured  ON reservations.packages (promoter_id, is_featured);

-- ---------------------------------------------------------------------------
-- reservations.package_items
-- ---------------------------------------------------------------------------

CREATE TABLE reservations.package_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id  UUID NOT NULL REFERENCES reservations.packages (id) ON DELETE CASCADE,
  service_id  UUID REFERENCES reservations.services (id) ON DELETE SET NULL,
  item_type   VARCHAR(20) NOT NULL
                CHECK (item_type IN ('service', 'credit', 'access', 'custom')),
  name        VARCHAR(200) NOT NULL,
  description TEXT,
  quantity    INT NOT NULL DEFAULT 1,
  unit        VARCHAR(50) NOT NULL DEFAULT 'session',
  sort_order  INT NOT NULL DEFAULT 0,
  metadata    JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_package_items_package_id ON reservations.package_items (package_id);

-- ---------------------------------------------------------------------------
-- reservations.package_purchases
-- ---------------------------------------------------------------------------

CREATE TABLE reservations.package_purchases (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id               UUID NOT NULL REFERENCES reservations.packages (id),
  user_id                  UUID NOT NULL,
  promoter_id              UUID NOT NULL,
  order_id                 UUID,
  status                   VARCHAR(20) NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'expired', 'fully_used', 'cancelled', 'transferred')),
  purchased_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at             TIMESTAMPTZ,
  expires_at               TIMESTAMPTZ,
  gift_recipient_user_id   UUID,
  gift_message             TEXT,
  transfer_token           UUID,
  notes                    TEXT
);

CREATE INDEX idx_package_purchases_user_id        ON reservations.package_purchases (user_id);
CREATE INDEX idx_package_purchases_package_status ON reservations.package_purchases (package_id, status);

-- ---------------------------------------------------------------------------
-- reservations.package_usage
-- ---------------------------------------------------------------------------

CREATE TABLE reservations.package_usage (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id      UUID NOT NULL REFERENCES reservations.package_purchases (id) ON DELETE CASCADE,
  item_id          UUID REFERENCES reservations.package_items (id) ON DELETE SET NULL,
  booking_id       UUID REFERENCES reservations.bookings (id) ON DELETE SET NULL,
  used_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  quantity_used    INT NOT NULL DEFAULT 1,
  notes            TEXT,
  used_by_user_id  UUID NOT NULL
);

CREATE INDEX idx_package_usage_purchase_id ON reservations.package_usage (purchase_id);
CREATE INDEX idx_package_usage_item_id     ON reservations.package_usage (item_id);

-- ---------------------------------------------------------------------------
-- reservations.package_credit_balances
-- ---------------------------------------------------------------------------

CREATE TABLE reservations.package_credit_balances (
  purchase_id        UUID PRIMARY KEY REFERENCES reservations.package_purchases (id) ON DELETE CASCADE,
  initial_credits    INT NOT NULL,
  remaining_credits  INT NOT NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT credit_remaining_non_negative CHECK (remaining_credits >= 0),
  CONSTRAINT credit_remaining_not_exceed   CHECK (remaining_credits <= initial_credits)
);
