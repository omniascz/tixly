-- =============================================================================
-- PostgreSQL VIEW: Organizer Sales Summary
-- =============================================================================
-- Rychlá agregace prodejů pro rychlý přístup z aplikace.
-- Jednoduché filtrování v aplikaci WHERE organizer_id = $1.
--
-- Vytvoření:
--   psql -U postgres -d tixly -f views/organizer_sales_summary.sql
--
-- Použití v aplikaci:
--   SELECT * FROM organizer_sales_summary WHERE organizer_id = $1;
--
-- Sloupce:
--   event_id, organizer_id, title, date_start, total_orders, total_revenue,
--   tickets_sold, resale_count, days_until_event
-- =============================================================================

CREATE OR REPLACE VIEW organizer_sales_summary AS
SELECT
    e.id AS event_id,
    e.organizer_id,
    e.title,
    e.date_start,
    COUNT(DISTINCT o.id) AS total_orders,
    COALESCE(SUM(oi.total_price), 0) AS total_revenue,
    COUNT(DISTINCT t.id) AS tickets_sold,
    COUNT(DISTINCT rl.id) FILTER (WHERE rl.status = 'sold') AS resale_count,
    EXTRACT(DAY FROM e.date_start - NOW())::INTEGER AS days_until_event
FROM catalog.events e
LEFT JOIN catalog.ticket_types tt ON tt.event_id = e.id
LEFT JOIN orders.order_items oi ON oi.ticket_type_id = tt.id
LEFT JOIN orders.orders o ON o.id = oi.order_id AND o.status = 'paid'
LEFT JOIN tickets.tickets t ON t.order_id = o.id
LEFT JOIN resale.resale_listings rl ON rl.ticket_id = t.id
GROUP BY e.id, e.organizer_id, e.title, e.date_start;

COMMENT ON VIEW organizer_sales_summary IS
    'Agregovaná sales summary pro pořadatele; filtrujte WHERE organizer_id = $1 v aplikaci.';

COMMENT ON COLUMN organizer_sales_summary.event_id IS
    'UUID akce.';

COMMENT ON COLUMN organizer_sales_summary.organizer_id IS
    'UUID organizátora; primární filtrační klíč.';

COMMENT ON COLUMN organizer_sales_summary.title IS
    'Název akce.';

COMMENT ON COLUMN organizer_sales_summary.date_start IS
    'Datum zahájení akce.';

COMMENT ON COLUMN organizer_sales_summary.total_orders IS
    'Počet zaplacených objednávek.';

COMMENT ON COLUMN organizer_sales_summary.total_revenue IS
    'Celkové tržby v CZK (bez refundů).';

COMMENT ON COLUMN organizer_sales_summary.tickets_sold IS
    'Celkový počet prodaných vstupenek.';

COMMENT ON COLUMN organizer_sales_summary.resale_count IS
    'Počet vstupenek prodaných přes resale marketplace.';

COMMENT ON COLUMN organizer_sales_summary.days_until_event IS
    'Počet dní od teď do startu akce (negativní = akce již probíhá/skončila).';
