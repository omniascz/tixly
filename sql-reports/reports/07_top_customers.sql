-- =============================================================================
-- REPORT: Top zákazníci organizátora
-- =============================================================================
-- Přehled nejlepších zákazníků (nejvyšší útrata, nejčastější kupující).
-- GDPR: Neobsahuje jméno či e-mail, pouze user_id (dashboard si dohledá přes API).
--
-- Spuštění:
--   psql -v organizer_id="'550e8400-e29b-41d4-a716-446655440000'" -f reports/07_top_customers.sql
--
-- Parametr:
--   :organizer_id - UUID organizátora
--
-- Výstup sloupců:
--   user_id, total_spent, orders_count, events_attended, first_purchase, last_purchase,
--   customer_segment
--
-- Zákaznické segmenty:
--   VIP: total_spent > 10000 CZK
--   Loyal: orders_count > 5
--   Standard: ostatní
--
-- Poznámka GDPR: user_id se nemazuje ani se nepreferuje, jméno/email nejsou vůbec k dispozici.
-- =============================================================================

\pset pager off
\timing on

\set organizer_id NULL

SELECT
    o.user_id,
    ROUND(SUM(oi.total_price), 2) AS total_spent,
    COUNT(DISTINCT o.id) AS orders_count,
    COUNT(DISTINCT tt.event_id) AS events_attended,
    MIN(o.created_at::DATE) AS first_purchase,
    MAX(o.created_at::DATE) AS last_purchase,
    -- Segmentace zákazníků
    CASE
        WHEN SUM(oi.total_price) > 10000 THEN 'VIP'
        WHEN COUNT(DISTINCT o.id) > 5 THEN 'Loyal'
        ELSE 'Standard'
    END AS customer_segment

FROM orders.orders o
JOIN orders.order_items oi ON oi.order_id = o.id
JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
JOIN catalog.events e ON e.id = tt.event_id
WHERE e.organizer_id = :organizer_id::UUID
    AND o.status = 'paid'

GROUP BY o.user_id

ORDER BY total_spent DESC

LIMIT 100;
