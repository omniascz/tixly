-- =============================================================================
-- REPORT: Sales Heatmap — kdy se prodávalo
-- =============================================================================
-- Heatmapa prodejů: den týdne × hodina dne.
-- Vyplní všech 168 kombinací (7 dní × 24 hodin), včetně dnů bez prodejů.
--
-- Spuštění:
--   psql -v event_id="'550e8400-e29b-41d4-a716-446655440000'" -f reports/04_sales_heatmap.sql
--
-- Výstup sloupců:
--   day_of_week (0=Neděle...6=Sobota), hour_of_day (0-23), sales_count, revenue, day_name_cs
--
-- Poznámka: Používáme generate_series pro všech 168 kombinací.
-- =============================================================================

\pset pager off
\timing on

\set event_id '550e8400-e29b-41d4-a716-446655440000'

WITH time_grid AS (
    -- Vygenerujeme všech 168 kombinací (7 dní × 24 hodin)
    SELECT
        d.day_of_week,
        h.hour_of_day
    FROM generate_series(0, 6) AS d(day_of_week)
    CROSS JOIN generate_series(0, 23) AS h(hour_of_day)
),
sales_by_hour AS (
    -- Agregujeme skutečné prodeje podle dne a hodiny
    SELECT
        EXTRACT(DOW FROM o.paid_at)::INTEGER AS day_of_week,
        EXTRACT(HOUR FROM o.paid_at)::INTEGER AS hour_of_day,
        COUNT(DISTINCT o.id) AS sales_count,
        ROUND(SUM(oi.total_price), 2) AS revenue
    FROM orders.orders o
    JOIN orders.order_items oi ON oi.order_id = o.id
    JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
    WHERE tt.event_id = :event_id::UUID
        AND o.status = 'paid'
        AND o.paid_at IS NOT NULL
    GROUP BY
        EXTRACT(DOW FROM o.paid_at),
        EXTRACT(HOUR FROM o.paid_at)
)
SELECT
    tg.day_of_week,
    tg.hour_of_day,
    COALESCE(sbh.sales_count, 0) AS sales_count,
    COALESCE(sbh.revenue, 0) AS revenue,
    -- Název dne týdne v češtině
    CASE tg.day_of_week
        WHEN 0 THEN 'Neděle'
        WHEN 1 THEN 'Pondělí'
        WHEN 2 THEN 'Úterý'
        WHEN 3 THEN 'Středa'
        WHEN 4 THEN 'Čtvrtek'
        WHEN 5 THEN 'Pátek'
        WHEN 6 THEN 'Sobota'
    END AS day_name_cs
FROM time_grid tg
LEFT JOIN sales_by_hour sbh
    ON sbh.day_of_week = tg.day_of_week
    AND sbh.hour_of_day = tg.hour_of_day
ORDER BY
    tg.day_of_week ASC,
    tg.hour_of_day ASC;
