-- 291_event_groups.sql
-- TM Parity Fáze 2: Event Groups + Cross-Org Sharing
--
-- TM-style multi-event management:
-- - Event Groups: sdružení tour, festivalů, repríz do logických skupin
-- - Bulk Edit napříč events v groupě
-- - Coordinated Onsale: synchronní spuštění prodeje
-- - Cross-Org Sharing: tour delegace na partnerské promotéry

BEGIN;

CREATE SCHEMA IF NOT EXISTS event_groups;

-- 1. Event Group (parent container)
CREATE TABLE IF NOT EXISTS event_groups.groups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     uuid NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  name            text NOT NULL,
  slug            text NOT NULL,
  description     text,
  -- Typ skupiny určuje default chování
  group_type      text NOT NULL DEFAULT 'tour'
                    CHECK (group_type IN (
                      'tour',          -- Koncertní turné — sdílený artist, různá venues + data
                      'festival',      -- Festival s více scénami v jednom místě
                      'series',        -- Divadelní cyklus, opera season
                      'repeating',     -- Pravidelně opakované akce (workshop weekly)
                      'cross_venue'    -- Stejná akce v různých venues (touring stand-up)
                    )),
  cover_image_url text,
  brand_color_hex text,
  -- Bulk-edit defaults — když promotér vytvoří nový event v této groupě,
  -- dostane tyto defaultní hodnoty (lze override per event)
  default_currency       text,
  default_refund_days    integer,
  default_qr_policy      text,
  default_min_age        integer,
  -- Coordinated onsale
  onsale_coordinated_at  timestamptz,  -- Když všechna events v groupě jdou živě
  -- Status
  status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('draft', 'active', 'completed', 'archived')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_event_groups_slug UNIQUE (promoter_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_event_groups_promoter
  ON event_groups.groups(promoter_id, status);

COMMENT ON TABLE event_groups.groups IS
  'TM-style Event Group — tour, festival, series, repeating, cross-venue.';

-- 2. Membership: events v groupě (M2M)
CREATE TABLE IF NOT EXISTS event_groups.members (
  group_id      uuid NOT NULL REFERENCES event_groups.groups(id) ON DELETE CASCADE,
  event_id      uuid NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  order_index   integer NOT NULL DEFAULT 0,
  -- Pokud true, tento event je "primary" pro group (např. hlavní show tour)
  is_primary    boolean NOT NULL DEFAULT false,
  added_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_event_group_members_event
  ON event_groups.members(event_id);

-- 3. Cross-Org Sharing — promotér A může delegovat group na promotéra B
CREATE TABLE IF NOT EXISTS event_groups.shares (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        uuid NOT NULL REFERENCES event_groups.groups(id) ON DELETE CASCADE,
  owner_promoter_id   uuid NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  shared_with_promoter_id uuid NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  -- Permissions: jaké akce smí shared partner dělat
  can_edit_events   boolean NOT NULL DEFAULT false,
  can_publish       boolean NOT NULL DEFAULT false,
  can_manage_inventory boolean NOT NULL DEFAULT true,
  can_scan          boolean NOT NULL DEFAULT true,
  can_view_reports  boolean NOT NULL DEFAULT true,
  -- Lifecycle
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  accepted_at       timestamptz,
  revoked_at        timestamptz,
  expires_at        timestamptz,
  -- Audit
  created_by_user_id uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_group_shares UNIQUE (group_id, shared_with_promoter_id)
);

CREATE INDEX IF NOT EXISTS idx_group_shares_shared_with
  ON event_groups.shares(shared_with_promoter_id, status);

COMMENT ON TABLE event_groups.shares IS
  'Cross-Org delegation: promotér A sdílí group s promotérem B s defined permissions.';

-- 4. Bulk Edit audit log (pro accountability — kdo upravil X events najednou)
CREATE TABLE IF NOT EXISTS event_groups.bulk_edits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        uuid REFERENCES event_groups.groups(id) ON DELETE SET NULL,
  performed_by_user_id uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  event_count     integer NOT NULL CHECK (event_count > 0),
  field_changes   jsonb NOT NULL,  -- {"refund_deadline_days": {"from": 14, "to": 30}, ...}
  affected_events uuid[] NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bulk_edits_group
  ON event_groups.bulk_edits(group_id, created_at DESC);

COMMIT;
