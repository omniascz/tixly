-- 493_events_sales_end_at.sql
--   Kolo 7 / C-29 — uzávěrka online prodeje.
--
-- Nový nepovinný sloupec catalog.events.sales_end_at = konec online prodeje (kupec). Když není
-- nastaven, platí začátek akce (date_start). Vynucuje se v kódu (lib/sales/cutoff.ts) na všech
-- cestách, kde objednávku zakládá kupec; pokladna pořadatele prodává do konce akce
-- (date_end, jinak date_start + 12 h).
--
-- Proč ne existující `sale_end_at`: sloupec z baseline zapisoval formulář nové akce a koordinace
-- skupin akcí, ale nic ho NEVYNUCOVALO. Hodnoty se převezmou (jen ty, které nejsou po konci akce)
-- a zapisovače přešly na sales_end_at; `sale_end_at` je zastaralý.
--
-- Idempotentní (lze spustit znovu nad stávajícím schématem).

ALTER TABLE catalog.events ADD COLUMN IF NOT EXISTS sales_end_at timestamptz;

UPDATE catalog.events
   SET sales_end_at = sale_end_at
 WHERE sales_end_at IS NULL
   AND sale_end_at IS NOT NULL
   AND (date_end IS NULL OR sale_end_at <= date_end);

ALTER TABLE catalog.events DROP CONSTRAINT IF EXISTS chk_catalog_events_sales_end_before_end;
ALTER TABLE catalog.events
  ADD CONSTRAINT chk_catalog_events_sales_end_before_end
  CHECK (sales_end_at IS NULL OR date_end IS NULL OR sales_end_at <= date_end);

COMMENT ON COLUMN catalog.events.sales_end_at IS
  'Konec online prodeje (kupec). NULL = začátek akce. Vynucuje lib/sales/cutoff.ts (kolo 7, C-29).';
COMMENT ON COLUMN catalog.events.sale_end_at IS
  'ZASTARALÉ (kolo 7): nevynucovalo se; nahrazeno sales_end_at.';
