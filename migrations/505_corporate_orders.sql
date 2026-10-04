-- 505_corporate_orders.sql
--   Kolo 8 / krok 6 — firemní / skupinové objednávky na fakturu.
--
-- POUŽITO: b2b_orders.invoice_orders (firemní objednávka na fakturu: firma, IČO, adresa, kontakt, splatnost, stav
--          draft|confirmed|proforma_sent|paid|cancelled|overdue, payment_reference, paid_at — schéma existovalo,
--          kód ne), orders.orders + order_items (místa drží order_id jako u online nákupu), orders.invoices
--          (daňový doklad po sazbách, ISDOC, dobropis), blokace (catalog.seat_block_seats state 'corporate').
-- NOVĚ:    DIČ, vazba na objednávku míst / blokaci / doklad / dobropis, důvod úpravy ceny, upozornění po splatnosti.
-- Idempotentní.

ALTER TABLE b2b_orders.invoice_orders ADD COLUMN IF NOT EXISTS company_dic text;
ALTER TABLE b2b_orders.invoice_orders ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES orders.orders(id) ON DELETE SET NULL;
ALTER TABLE b2b_orders.invoice_orders ADD COLUMN IF NOT EXISTS block_id uuid REFERENCES catalog.seat_blocks(id) ON DELETE SET NULL;
ALTER TABLE b2b_orders.invoice_orders ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES orders.invoices(id) ON DELETE SET NULL;
ALTER TABLE b2b_orders.invoice_orders ADD COLUMN IF NOT EXISTS credit_note_id uuid REFERENCES orders.invoices(id) ON DELETE SET NULL;
ALTER TABLE b2b_orders.invoice_orders ADD COLUMN IF NOT EXISTS price_override_reason text;
ALTER TABLE b2b_orders.invoice_orders ADD COLUMN IF NOT EXISTS overdue_notified_at timestamptz;
ALTER TABLE b2b_orders.invoice_orders ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES identity.users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_invoice_orders_order ON b2b_orders.invoice_orders (order_id) WHERE order_id IS NOT NULL;

-- OPRAVENO: invoice_number byl unikátní GLOBÁLNĚ, ale číselná řada dokladů je per pořadatel × rok
-- (orders.next_document_number) → druhý pořadatel s fakturou 2026-0001 by objednávku nezaložil. Unikátnost per pořadatel.
ALTER TABLE b2b_orders.invoice_orders DROP CONSTRAINT IF EXISTS invoice_orders_invoice_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS ux_invoice_orders_promoter_number ON b2b_orders.invoice_orders (promoter_id, invoice_number) WHERE invoice_number IS NOT NULL;

-- politika měla „OR promoter_id IS NULL" (sloupec je NOT NULL → mrtvá větev) a bez WITH CHECK; sjednoceno se vzorem
DROP POLICY IF EXISTS p_invoice_orders_tenant ON b2b_orders.invoice_orders;
CREATE POLICY p_invoice_orders_tenant ON b2b_orders.invoice_orders
  FOR ALL
  USING (public.app_is_platform_admin() OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR promoter_id = public.app_current_promoter_id());

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tixly_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON b2b_orders.invoice_orders TO tixly_app;
    REVOKE TRUNCATE ON b2b_orders.invoice_orders FROM tixly_app;
  END IF;
END $$;
