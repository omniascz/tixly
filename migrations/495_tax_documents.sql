-- 495_tax_documents.sql
--   Kolo 7 / C-54 — daňové doklady kupci po sazbách, dobropisy, číselné řady bez děr.
--
-- 1) orders.invoices (doklady pořadatele kupci): typ dokladu (doklad / opravný daňový doklad =
--    dobropis), vazba dobropisu na opravovaný doklad, datum uskutečnění plnění, plátcovství a otisk
--    údajů prodávajícího k datu vystavení. Sazba už není jedna na doklad → vat_rate_pct NULL-ovatelné,
--    rozpis po sazbách je v orders.invoice_vat_lines. Jedna objednávka = jeden doklad, dobropisů může
--    být víc (částečné refundy) → UNIQUE(order_id) nahrazen částečným indexem jen pro doklady.
-- 2) orders.document_sequences + orders.next_document_number(): řada per pořadatel × rok × druh.
--    Číslo se přidělí UPDATE … RETURNING ve stejné transakci jako vložení dokladu → při souběhu
--    druhá transakce čeká na zámek řádku, při ROLLBACK se číslo vrátí → žádné díry ani duplicity.
-- Idempotentní.

ALTER TABLE orders.invoices
  ADD COLUMN IF NOT EXISTS doc_type text NOT NULL DEFAULT 'invoice',
  ADD COLUMN IF NOT EXISTS corrects_invoice_id uuid REFERENCES orders.invoices(id),
  ADD COLUMN IF NOT EXISTS taxable_supply_date date,
  ADD COLUMN IF NOT EXISTS supplier_vat_payer boolean,
  ADD COLUMN IF NOT EXISTS supplier jsonb,
  ADD COLUMN IF NOT EXISTS series_year integer;

ALTER TABLE orders.invoices ALTER COLUMN vat_rate_pct DROP NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_invoices_doc_type') THEN
    ALTER TABLE orders.invoices ADD CONSTRAINT chk_invoices_doc_type
      CHECK (doc_type IN ('invoice', 'credit_note'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_invoices_credit_note_ref') THEN
    ALTER TABLE orders.invoices ADD CONSTRAINT chk_invoices_credit_note_ref
      CHECK ((doc_type = 'credit_note') = (corrects_invoice_id IS NOT NULL));
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_order_id_key') THEN
    ALTER TABLE orders.invoices DROP CONSTRAINT invoices_order_id_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_order_invoice
  ON orders.invoices (order_id) WHERE doc_type = 'invoice' AND order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_invoices_corrects ON orders.invoices (corrects_invoice_id);

-- Rozpis po sazbách (jen plátce DPH). Částky v haléřích, u dobropisu záporné.
CREATE TABLE IF NOT EXISTS orders.invoice_vat_lines (
  invoice_id     uuid NOT NULL REFERENCES orders.invoices(id) ON DELETE CASCADE,
  vat_rate_code  text NOT NULL REFERENCES platform.vat_rate_codes(code),
  rate_pct       numeric(5,2) NOT NULL,
  base_minor     bigint NOT NULL,
  vat_minor      bigint NOT NULL,
  total_minor    bigint NOT NULL,
  PRIMARY KEY (invoice_id, vat_rate_code),
  CHECK (base_minor + vat_minor = total_minor)
);

ALTER TABLE orders.invoice_vat_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_invoice_vat_lines_scope ON orders.invoice_vat_lines;
CREATE POLICY p_invoice_vat_lines_scope ON orders.invoice_vat_lines
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service()
         OR EXISTS (SELECT 1 FROM orders.invoices i
                     WHERE i.id = invoice_id AND i.promoter_id = public.app_current_promoter_id()))
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());

-- Číselné řady dokladů.
CREATE TABLE IF NOT EXISTS orders.document_sequences (
  promoter_id  uuid NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  year         integer NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  series       text NOT NULL CHECK (series IN ('invoice', 'credit_note', 'commission')),
  last_number  integer NOT NULL CHECK (last_number >= 0),
  PRIMARY KEY (promoter_id, year, series)
);

ALTER TABLE orders.document_sequences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_document_sequences_scope ON orders.document_sequences;
CREATE POLICY p_document_sequences_scope ON orders.document_sequences
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service() OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());

CREATE OR REPLACE FUNCTION orders.next_document_number(p_promoter uuid, p_year integer, p_series text)
RETURNS integer
LANGUAGE sql VOLATILE
SET search_path = orders, pg_temp
AS $$
  INSERT INTO orders.document_sequences (promoter_id, year, series, last_number)
  VALUES (p_promoter, p_year, p_series, 1)
  ON CONFLICT (promoter_id, year, series)
  DO UPDATE SET last_number = orders.document_sequences.last_number + 1
  RETURNING last_number
$$;

-- Navázání řad na už vystavené doklady (staré číslo „YYYY-NNNN" vznikalo jako MAX+1): řada pořadatele
-- pokračuje od nejvyššího čísla roku, takže v číslování nevznikne díra ani duplicita.
INSERT INTO orders.document_sequences (promoter_id, year, series, last_number)
SELECT promoter_id, split_part(invoice_number, '-', 1)::int, 'invoice', max(split_part(invoice_number, '-', 2)::int)
  FROM orders.invoices
 WHERE invoice_number ~ '^[0-9]{4}-[0-9]+$' AND doc_type = 'invoice'
 GROUP BY 1, 2
ON CONFLICT (promoter_id, year, series)
DO UPDATE SET last_number = GREATEST(orders.document_sequences.last_number, EXCLUDED.last_number);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tixly_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON orders.invoice_vat_lines TO tixly_app;
    GRANT SELECT, INSERT, UPDATE ON orders.document_sequences TO tixly_app;
    REVOKE TRUNCATE ON orders.invoice_vat_lines, orders.document_sequences FROM tixly_app;
    GRANT EXECUTE ON FUNCTION orders.next_document_number(uuid, integer, text) TO tixly_app;
  END IF;
END $$;

COMMENT ON COLUMN orders.invoices.vat_rate_pct IS
  'ZASTARALÉ pro nové doklady (kolo 7): sazby jsou v orders.invoice_vat_lines; NULL u neplátce/víc sazeb.';
