-- =============================================================================
-- 075_credit_movements.sql
-- Unified credit movement ledger for dispute resolution.
--
-- permanentky.usages already records consume/refund events. This table covers
-- the remaining mutation types that usages cannot represent:
--   - admin_grant   (admin manually adds credits)
--   - admin_revoke  (admin removes credits — penalty, fraud)
--   - correction    (data migration fix, reconciliation)
--   - expiry_clawback (auto-debit on package expiry if partially used)
--
-- A VIEW (credit_movements_all) unions usages + this table so the admin/CS
-- can see a single chronological ledger per package.
-- =============================================================================

CREATE TABLE IF NOT EXISTS permanentky.credit_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES permanentky.client_packages(id),
  client_id UUID NOT NULL,
  delta INTEGER NOT NULL,  -- positive = grant, negative = revoke
  reason TEXT NOT NULL,
  actor_id UUID,           -- admin user who made the adjustment
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_credit_adj_package ON permanentky.credit_adjustments(package_id);
CREATE INDEX idx_credit_adj_client ON permanentky.credit_adjustments(client_id);

-- Unified view: all credit movements for a package in chronological order.
CREATE OR REPLACE VIEW permanentky.credit_movements_all AS
  SELECT
    u.id,
    u.package_id,
    u.client_id,
    CASE WHEN u.is_refund THEN 1 ELSE -1 END AS delta,
    CASE
      WHEN u.is_refund THEN COALESCE('refund: ' || u.refund_reason, 'refund')
      ELSE 'usage'
    END AS reason,
    COALESCE(u.refund_actor_id, u.client_id) AS actor_id,
    u.consumed_at AS created_at,
    'usage' AS source_table
  FROM permanentky.usages u
  UNION ALL
  SELECT
    a.id,
    a.package_id,
    a.client_id,
    a.delta,
    a.reason,
    a.actor_id,
    a.created_at,
    'adjustment' AS source_table
  FROM permanentky.credit_adjustments a
  ORDER BY created_at ASC;
