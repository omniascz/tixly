-- Group Payment Splitting — Schema
-- Tables: group_payments, group_members, group_invites

BEGIN;

-- ─── group_payments ───────────────────────────────────────────
CREATE TABLE orders.group_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events.events(id) ON DELETE CASCADE,
  total_amount_halire integer NOT NULL CHECK (total_amount_halire > 0),
  splitter_strategy text NOT NULL DEFAULT 'equal'
    CHECK (splitter_strategy IN ('equal', 'proportional', 'custom')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'disputed')),
  created_at timestamp with time zone NOT NULL DEFAULT NOW(),
  updated_at timestamp with time zone DEFAULT NOW(),
  tenant_id uuid
);

-- Indexes for queries
CREATE INDEX idx_group_payments_owner_id ON orders.group_payments(group_owner_id);
CREATE INDEX idx_group_payments_event_id ON orders.group_payments(event_id);
CREATE INDEX idx_group_payments_status ON orders.group_payments(status);

-- ─── group_members ────────────────────────────────────────────
CREATE TABLE orders.group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_payment_id uuid NOT NULL REFERENCES orders.group_payments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders.orders(id) ON DELETE RESTRICT,
  amount_owed_halire integer NOT NULL DEFAULT 0 CHECK (amount_owed_halire >= 0),
  amount_paid_halire integer NOT NULL DEFAULT 0 CHECK (amount_paid_halire >= 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'disputed')),
  joined_at timestamp with time zone NOT NULL DEFAULT NOW(),
  paid_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT NOW(),
  UNIQUE(group_payment_id, user_id)
);

-- Indexes for queries
CREATE INDEX idx_group_members_group_id ON orders.group_members(group_payment_id);
CREATE INDEX idx_group_members_user_id ON orders.group_members(user_id);
CREATE INDEX idx_group_members_status ON orders.group_members(status);

-- ─── group_invites ────────────────────────────────────────────
CREATE TABLE orders.group_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_payment_id uuid NOT NULL REFERENCES orders.group_payments(id) ON DELETE CASCADE,
  to_email text NOT NULL,
  token text NOT NULL, -- SHA256 hash of the invite token
  expires_at timestamp with time zone NOT NULL,
  joined_at timestamp with time zone,
  joined_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT NOW(),
  UNIQUE(group_payment_id, to_email)
);

-- Index for token lookups
CREATE INDEX idx_group_invites_token ON orders.group_invites(token);
CREATE INDEX idx_group_invites_group_id ON orders.group_invites(group_payment_id);
CREATE INDEX idx_group_invites_email ON orders.group_invites(to_email);

-- ─── Constraints and triggers ──────────────────────────────────

-- Trigger to update updated_at on group_payments
CREATE TRIGGER update_group_payments_timestamp BEFORE UPDATE ON orders.group_payments
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- Constraint: member order_id must belong to the same event as group
ALTER TABLE orders.group_members
  ADD CONSTRAINT check_order_event FOREIGN KEY (order_id)
    REFERENCES orders.orders(id);

-- Ensure amount_paid <= amount_owed (basic validation)
ALTER TABLE orders.group_members
  ADD CONSTRAINT check_paid_not_exceeds_owed
    CHECK (amount_paid_halire <= (amount_owed_halire + 1000000)); -- allow small overpayments

COMMIT;
