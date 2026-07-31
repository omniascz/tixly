-- =============================================================================
-- Migration 040: Rules Engine
-- Schema: reservations
-- =============================================================================

-- ---------------------------------------------------------------------------
-- reservations.rules — rule definitions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reservations.rules (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     UUID        NOT NULL,
  branch_id       UUID,       -- NULL = applies to all branches
  service_id      UUID,       -- NULL = applies to all services
  name            VARCHAR(200) NOT NULL,
  description     TEXT,
  rule_type       TEXT        NOT NULL CHECK (rule_type IN (
                    'booking_window','advance_notice','user_limit','capacity',
                    'time_restriction','approval','discount','surcharge',
                    'verification','blackout'
                  )),
  trigger_event   TEXT        NOT NULL DEFAULT 'before_hold'
                    CHECK (trigger_event IN ('before_hold','before_confirm','on_cancel','on_complete')),
  priority        INT         NOT NULL DEFAULT 0,
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  stop_on_match   BOOLEAN     NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (promoter_id, name)
);

-- ---------------------------------------------------------------------------
-- reservations.rule_conditions — AND conditions for a rule
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reservations.rule_conditions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id         UUID        NOT NULL REFERENCES reservations.rules (id) ON DELETE CASCADE,
  condition_type  TEXT        NOT NULL CHECK (condition_type IN (
                    'day_of_week','time_of_day','advance_hours','user_role',
                    'quantity','user_booking_count','service_type','branch',
                    'date_range','always'
                  )),
  operator        TEXT        NOT NULL CHECK (operator IN (
                    'eq','neq','gt','gte','lt','lte','in','not_in','between'
                  )),
  value_a         TEXT        NOT NULL,
  value_b         TEXT,
  sort_order      INT         NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- reservations.rule_actions — actions executed when rule fires
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reservations.rule_actions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id         UUID        NOT NULL REFERENCES reservations.rules (id) ON DELETE CASCADE,
  action_type     TEXT        NOT NULL CHECK (action_type IN (
                    'block','allow','require_approval','apply_discount',
                    'apply_surcharge','set_limit','send_notification','add_tag'
                  )),
  action_value    TEXT,
  action_message  TEXT,
  sort_order      INT         NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- reservations.rule_evaluations — audit log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reservations.rule_evaluations (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id             UUID        NOT NULL REFERENCES reservations.rules (id) ON DELETE CASCADE,
  booking_id          UUID,
  user_id             UUID        NOT NULL,
  slot_id             UUID        NOT NULL,
  result              TEXT        NOT NULL CHECK (result IN ('passed','blocked','approved','discounted')),
  matched_conditions  JSONB       NOT NULL DEFAULT '[]',
  applied_action      TEXT,
  evaluated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- reservations.approval_requests — pending manager approvals
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reservations.approval_requests (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id         UUID        NOT NULL REFERENCES reservations.rules (id) ON DELETE CASCADE,
  booking_id      UUID        REFERENCES reservations.bookings (id) ON DELETE SET NULL,
  slot_id         UUID        NOT NULL REFERENCES reservations.slots (id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL,
  promoter_id     UUID        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected','expired')),
  request_data    JSONB       NOT NULL DEFAULT '{}',
  reviewer_id     UUID,
  reviewer_notes  TEXT,
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at     TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '48 hours'
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_rules_promoter_active
  ON reservations.rules (promoter_id, is_active);

CREATE INDEX IF NOT EXISTS idx_rules_promoter_service
  ON reservations.rules (promoter_id, service_id);

CREATE INDEX IF NOT EXISTS idx_rule_conditions_rule
  ON reservations.rule_conditions (rule_id);

CREATE INDEX IF NOT EXISTS idx_rule_actions_rule
  ON reservations.rule_actions (rule_id);

CREATE INDEX IF NOT EXISTS idx_rule_evaluations_rule_time
  ON reservations.rule_evaluations (rule_id, evaluated_at);

CREATE INDEX IF NOT EXISTS idx_rule_evaluations_user
  ON reservations.rule_evaluations (user_id);

CREATE INDEX IF NOT EXISTS idx_approval_requests_promoter_status
  ON reservations.approval_requests (promoter_id, status);

CREATE INDEX IF NOT EXISTS idx_approval_requests_user
  ON reservations.approval_requests (user_id);
