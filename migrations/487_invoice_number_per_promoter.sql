-- 487_invoice_number_per_promoter.sql  (kolo 3 / krok 2 — X7)
--
-- Číslo faktury je řada PER POŘADATEL (oba generátory: MAX(...) WHERE promoter_id),
-- ale unikátnost byla globální UNIQUE(invoice_number) → první faktura druhého pořadatele
-- v roce (YYYY-0001) narazila na fakturu prvního → 23505 → kupec doklad nedostal.
-- Nově UNIQUE(promoter_id, invoice_number). Idempotentní.

ALTER TABLE orders.invoices DROP CONSTRAINT IF EXISTS invoices_invoice_number_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'orders.invoices'::regclass
       AND conname = 'invoices_promoter_invoice_number_key'
  ) THEN
    ALTER TABLE orders.invoices
      ADD CONSTRAINT invoices_promoter_invoice_number_key UNIQUE (promoter_id, invoice_number);
  END IF;
END $$;
