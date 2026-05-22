-- 316_voucher_self_purchase.sql
-- DACH parity #P1-2: Voucher self-service (Reservix pattern).
-- Buyer si sám kupuje dárkový poukaz na promotérově landing page
-- (`/p/[slug]/vouchers`) místo aby promotér admin generoval. 3-year validity
-- default, mock payment flow analogický abonementu.
--
-- Rozšíření existující marketing.gift_vouchers:
--   - source: 'admin' (current default), 'buyer_purchase' (self-service)
--   - paid_order_id: order který buyer zaplatil za voucher (NULL pro admin)
--   - recipient_message: dárková zpráva (volitelné)
--   - payment_id, payment_status: pro mock flow
--
-- Idempotent.

BEGIN;

ALTER TABLE marketing.gift_vouchers
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'admin';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gift_vouchers_source_check'
  ) THEN
    ALTER TABLE marketing.gift_vouchers
      ADD CONSTRAINT gift_vouchers_source_check
      CHECK (source IN ('admin', 'buyer_purchase', 'gift_purchase'));
  END IF;
END $$;

ALTER TABLE marketing.gift_vouchers
  ADD COLUMN IF NOT EXISTS paid_order_id uuid REFERENCES orders.orders(id) ON DELETE SET NULL;

ALTER TABLE marketing.gift_vouchers
  ADD COLUMN IF NOT EXISTS recipient_message text;

ALTER TABLE marketing.gift_vouchers
  ADD COLUMN IF NOT EXISTS recipient_name text;

ALTER TABLE marketing.gift_vouchers
  ADD COLUMN IF NOT EXISTS payment_id uuid;

ALTER TABLE marketing.gift_vouchers
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'paid';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gift_vouchers_payment_status_check'
  ) THEN
    ALTER TABLE marketing.gift_vouchers
      ADD CONSTRAINT gift_vouchers_payment_status_check
      CHECK (payment_status IN ('pending', 'paid', 'cancelled', 'refunded'));
  END IF;
END $$;

ALTER TABLE marketing.gift_vouchers
  ADD COLUMN IF NOT EXISTS buyer_email text;

CREATE INDEX IF NOT EXISTS idx_gift_vouchers_payment
  ON marketing.gift_vouchers(payment_id)
  WHERE payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gift_vouchers_source
  ON marketing.gift_vouchers(source, created_at DESC);

-- Backfill: existující vouchery (admin) jsou paid od počátku.
UPDATE marketing.gift_vouchers SET payment_status = 'paid' WHERE payment_status IS NULL;

COMMENT ON COLUMN marketing.gift_vouchers.source IS
  'Origin: admin (promotér gen), buyer_purchase (self-service), gift_purchase (z gift order)';
COMMENT ON COLUMN marketing.gift_vouchers.paid_order_id IS
  'Order, který buyer zaplatil za nákup voucheru (NULL pro admin/gift-derived).';
COMMENT ON COLUMN marketing.gift_vouchers.payment_status IS
  'pending = čeká na confirm, paid = aktivní, cancelled/refunded.';

COMMIT;
