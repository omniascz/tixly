-- =============================================================================
-- REPORT: Prognóza tržeb do konce prodeje
-- =============================================================================
-- Jednoduchý forecast budoucích tržeb na základě historie poslední týdne.
-- Vhodný pro upozorňování na potencialitu events a rychlého prodeje.
--
-- Spuštění:
--   psql -v event_id="'550e8400-e29b-41d4-a716-446655440000'" -f reports/08_revenue_forecast.sql
--
-- Výstup sloupců:
--   current_revenue, remaining_capacity, avg_daily_sales_last_7_days,
--   days_until_event, forecast_additional_revenue, forecast_total_revenue, confidence
--
-- Confidence level:
--   high: days_until_event > 14 a zbývá > 20% kapacity
--   medium: ostatní normální případy
--   low: < 3 dny do akce
-- =============================================================================

\pset pager off
\timing on

\set event_id '550e8400-e29b-41d4-a716-446655440000'

WITH event_data AS (
    -- Načteme základní data o akci
    SELECT
        e.id,
        e.date_start,
        SUM(tt.total_qty) AS total_capacity,
        SUM(tt.remaining_qty) AS remaining_capacity
    FROM catalog.events e
    JOIN catalog.ticket_types tt ON tt.event_id = e.id
    WHERE e.id = :event_id::UUID
    GROUP BY e.id, e.date_start
),
current_revenue_calc AS (
    -- Suma všech zaplacených objednávek
    SELECT
        ROUND(SUM(oi.total_price), 2) AS current_revenue
    FROM orders.order_items oi
    JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
    JOIN orders.orders o ON o.id = oi.order_id AND o.status = 'paid'
    WHERE tt.event_id = :event_id::UUID
),
daily_sales_last_7_days AS (
    -- Průměrné denní tržby za poslední 7 dní
    SELECT
        COALESCE(ROUND(AVG(daily_revenue), 2), 0) AS avg_daily_revenue
    FROM (
        SELECT
            DATE(o.paid_at) AS sale_date,
            ROUND(SUM(oi.total_price), 2) AS daily_revenue
        FROM orders.order_items oi
        JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
        JOIN orders.orders o ON o.id = oi.order_id AND o.status = 'paid'
        WHERE tt.event_id = :event_id::UUID
            AND o.paid_at >= NOW() - INTERVAL '7 days'
            AND o.paid_at IS NOT NULL
        GROUP BY DATE(o.paid_at)
    ) daily_summary
),
current_avg_price AS (
    -- Průměrná cena zbývajících lístků
    SELECT
        COALESCE(ROUND(AVG(oi.unit_price), 2), 0) AS avg_price
    FROM orders.order_items oi
    JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
    JOIN orders.orders o ON o.id = oi.order_id AND o.status = 'paid'
    WHERE tt.event_id = :event_id::UUID
)
SELECT
    crc.current_revenue,
    ed.remaining_capacity,
    ds7.avg_daily_revenue AS avg_daily_sales_last_7_days,
    EXTRACT(DAY FROM ed.date_start - NOW())::INTEGER AS days_until_event,

    -- Prognóza: průměrné denní tržby × dní do akce
    ROUND(
        ds7.avg_daily_revenue * GREATEST(EXTRACT(DAY FROM ed.date_start - NOW()), 0),
        2
    ) AS forecast_additional_revenue,

    -- Celkové předpokládané tržby
    ROUND(
        crc.current_revenue +
        ds7.avg_daily_revenue * GREATEST(EXTRACT(DAY FROM ed.date_start - NOW()), 0),
        2
    ) AS forecast_total_revenue,

    -- Úroveň spolehlivosti prognózy
    CASE
        WHEN EXTRACT(DAY FROM ed.date_start - NOW()) < 3 THEN 'low'
        WHEN EXTRACT(DAY FROM ed.date_start - NOW()) > 14
            AND ed.remaining_capacity > (ed.total_capacity * 0.2)
            THEN 'high'
        ELSE 'medium'
    END AS confidence

FROM event_data ed
CROSS JOIN current_revenue_calc crc
CROSS JOIN daily_sales_last_7_days ds7
CROSS JOIN current_avg_price cap;
