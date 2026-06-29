CREATE TABLE IF NOT EXISTS platform.gift_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  initial_value_halire bigint NOT NULL CHECK (initial_value_halire > 0),
  remaining_value_halire bigint NOT NULL CHECK (remaining_value_halire >= 0),
  currency text NOT NULL DEFAULT 'CZK',
  issued_to_email text,
  issued_to_user_id uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  promoter_id uuid REFERENCES platform.promoters(id) ON DELETE SET NULL,
  purchased_order_id uuid,
  expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS gift_cards_code_idx ON platform.gift_cards (code);
CREATE INDEX IF NOT EXISTS gift_cards_user_idx ON platform.gift_cards (issued_to_user_id);
ALTER TABLE platform.gift_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY gift_cards_owner ON platform.gift_cards
  FOR SELECT
  USING (issued_to_user_id::text = current_setting('app.current_user_id', true));
CREATE POLICY gift_cards_admin ON platform.gift_cards
  FOR ALL
  USING (current_setting('app.is_platform_admin', true) = 'true');
