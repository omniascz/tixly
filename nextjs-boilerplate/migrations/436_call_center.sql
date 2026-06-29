-- Migration 436: Call center / phone order modul
-- Extends orders.orders so that a call-center agent can place an order on behalf of a buyer
-- and send them a payment link.

ALTER TABLE orders.orders ADD COLUMN IF NOT EXISTS placed_by_agent_id uuid REFERENCES identity.users(id) ON DELETE SET NULL;
ALTER TABLE orders.orders ADD COLUMN IF NOT EXISTS order_source text NOT NULL DEFAULT 'web';
ALTER TABLE orders.orders ADD COLUMN IF NOT EXISTS phone_payment_link text;
ALTER TABLE orders.orders ADD COLUMN IF NOT EXISTS phone_payment_expires_at timestamptz;
