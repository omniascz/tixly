-- =============================================================================
-- REPORT: Analýza výkonu fází cenotvorby
-- =============================================================================
-- Přehled prodejů v jednotlivých fázích (Early Bird, Regular, Late, Door).
-- Analýza: počet prodaných vstupenek, tržby, procento z celku, demand factor, trvání fáze.
--
-- Spuštění:
--   psql -v event_id="'550e8400-e29b-41d4-a716-446655440000'" -f reports/05_pricing_phase_analysis.sql
--
-- Výstup sloupců:
--   phase, price, tickets_sold, revenue, pct_of_total_sales, avg_demand_factor,
--   phase_duration_days
--
-- Poznámka: Datová deduplikace cen pro případ kdy je stejná cena v více fázích.
-- =============================================================================

\pset pager off
\timing on

\set event_id '550e8400-e29b-41d4-a716-446655440000'

WITH pricing_rules_by_event AS (
    -- Zmapujeme všechna pricing rules pro event
    SELECT
        pr.id,
        pr.phase,
        pr.price,
        pr.demand_factor_min,
        pr.demand_factor_max,
        pr.threshold_date,
        pr.priority,
        tt.id AS ticket_type_id
    FROM catalog.pricing_rules pr
    JOIN catalog.ticket_types tt ON tt.id = pr.ticket_type_id
    WHERE tt.event_id = :event_id::UUID
        AND pr.active = TRUE
),
phase_sales AS (
    -- Spočítáme prodeje v jednotlivých fázích
    -- Problém: nemáme přímou vazbu mezi order_item a pricing_rule
    -- Řešení: mapujeme přes unit_price a pravidla
    SELECT
        pr.phase,
        pr.price,
        COUNT(DISTINCT oi.id) AS tickets_sold,
        ROUND(SUM(oi.total_price), 2) AS revenue,
        ROUND(AVG((pr.demand_factor_min + pr.demand_factor_max) / 2), 2) AS avg_demand_factor
    FROM orders.order_items oi
    JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
    JOIN orders.orders o ON o.id = oi.order_id AND o.status = 'paid'
    JOIN pricing_rules_by_event pr
        ON pr.ticket_type_id = tt.id
        AND oi.unit_price = pr.price
    WHERE tt.event_id = :event_id::UUID
    GROUP BY pr.phase, pr.price, pr.demand_factor_min, pr.demand_factor_max
),
total_sales_summary AS (
    -- Celkový počet prodaných vstupenek a tržby
    SELECT
        COUNT(DISTINCT oi.id) AS total_tickets,
        ROUND(SUM(oi.total_price), 2) AS total_revenue
    FROM orders.order_items oi
    JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
    JOIN orders.orders o ON o.id = oi.order_id AND o.status = 'paid'
    WHERE tt.event_id = :event_id::UUID
),
phase_duration AS (
    -- Délka trvání každé fáze (ze audit logu pokud dostupný, jinak NULL)
    SELECT
        pr.phase,
        ROUND(EXTRACT(DAY FROM MAX(pr.threshold_date) - MIN(pr.threshold_date)), 1) AS duration_days
    FROM pricing_rules_by_event pr
    WHERE pr.threshold_date IS NOT NULL
    GROUP BY pr.phase
)
SELECT
    ps.phase,
    ps.price,
    ps.tickets_sold,
    ps.revenue,
    ROUND(
        CASE
            WHEN tss.total_revenue > 0
                THEN (ps.revenue / tss.total_revenue * 100)
            ELSE 0
        END,
        2
    ) AS pct_of_total_sales,
    ps.avg_demand_factor,
    COALESCE(pd.duration_days, NULL) AS phase_duration_days
FROM phase_sales ps
CROSS JOIN total_sales_summary tss
LEFT JOIN phase_duration pd ON pd.phase = ps.phase
ORDER BY
    -- Pořadí fází podle typu
    CASE ps.phase
        WHEN 'early_bird' THEN 1
        WHEN 'regular' THEN 2
        WHEN 'late' THEN 3
        WHEN 'door' THEN 4
        ELSE 5
    END ASC;
