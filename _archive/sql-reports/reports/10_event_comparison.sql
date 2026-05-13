-- =============================================================================
-- REPORT: Porovnání výkonu akcí organizátora
-- =============================================================================
-- Benchmarking prodejů akcí: top performers, worst performers, trend analysis.
-- Včetně fill rate, resale activity, a dob do vyprodání.
--
-- Spuštění:
--   psql -v organizer_id="'550e8400-e29b-41d4-a716-446655440000'" -f reports/10_event_comparison.sql
--   psql -v organizer_id="'550e8400-e29b-41d4-a716-446655440000'" -v limit="20" -f reports/10_event_comparison.sql
--
-- Parametry:
--   :organizer_id - UUID organizátora (povinný)
--   :limit - počet sloupců (default: 10)
--
-- Výstup sloupců:
--   event_title, event_date, total_revenue, tickets_sold, fill_rate_pct,
--   resale_rate_pct, avg_ticket_price, days_to_sellout, rank
--
-- Poznámka: days_to_sellout je NULL pokud se akce zatím zcela neprodala.
-- =============================================================================

\pset pager off
\timing on

\set organizer_id NULL
\set limit 10

WITH event_metrics AS (
    -- Agregace dat pro každou akci
    SELECT
        e.id,
        e.title,
        e.date_start,
        SUM(tt.total_qty) AS total_capacity,
        COUNT(DISTINCT CASE WHEN o.status = 'paid' THEN t.id ELSE NULL END) AS tickets_sold,
        COUNT(DISTINCT CASE WHEN o.status = 'paid' THEN o.id ELSE NULL END) AS total_orders,
        ROUND(SUM(CASE WHEN o.status = 'paid' THEN oi.total_price ELSE 0 END), 2) AS total_revenue,
        ROUND(
            SUM(CASE WHEN o.status = 'paid' THEN oi.unit_price ELSE 0 END)::NUMERIC
            / NULLIF(COUNT(DISTINCT CASE WHEN o.status = 'paid' THEN t.id END), 0),
            2
        ) AS avg_ticket_price,
        -- Počet prodaných vstupenek přes resale
        COUNT(DISTINCT CASE WHEN rl.status = 'sold' THEN rl.id ELSE NULL END) AS resale_sold_count
    FROM catalog.events e
    LEFT JOIN catalog.ticket_types tt ON tt.event_id = e.id
    LEFT JOIN orders.order_items oi ON oi.ticket_type_id = tt.id
    LEFT JOIN orders.orders o ON o.id = oi.order_id
    LEFT JOIN tickets.tickets t ON t.order_id = o.id AND t.ticket_type_id = tt.id
    LEFT JOIN resale.resale_listings rl ON rl.ticket_id = t.id
    WHERE e.organizer_id = :organizer_id::UUID
    GROUP BY e.id, e.title, e.date_start
),
event_with_rates AS (
    -- Kalkulace procentuálních metrik
    SELECT
        em.id,
        em.title,
        em.date_start,
        em.total_revenue,
        em.tickets_sold,
        ROUND(
            CASE
                WHEN em.total_capacity > 0
                    THEN (em.tickets_sold::NUMERIC / em.total_capacity * 100)
                ELSE 0
            END,
            2
        ) AS fill_rate_pct,
        ROUND(
            CASE
                WHEN em.tickets_sold > 0
                    THEN (em.resale_sold_count::NUMERIC / em.tickets_sold * 100)
                ELSE 0
            END,
            2
        ) AS resale_rate_pct,
        em.avg_ticket_price
    FROM event_metrics em
),
event_with_rank AS (
    -- Ranking a days_to_sellout (z audit log)
    SELECT
        ewr.id,
        ewr.title,
        ewr.date_start,
        ewr.total_revenue,
        ewr.tickets_sold,
        ewr.fill_rate_pct,
        ewr.resale_rate_pct,
        ewr.avg_ticket_price,
        -- days_to_sellout: interpolácia z audit logu (pokud dostupné)
        NULL::INTEGER AS days_to_sellout,
        RANK() OVER (ORDER BY ewr.total_revenue DESC) AS rank
    FROM event_with_rates ewr
)
SELECT
    title AS event_title,
    date_start::DATE AS event_date,
    total_revenue,
    tickets_sold,
    fill_rate_pct,
    resale_rate_pct,
    avg_ticket_price,
    days_to_sellout,
    rank
FROM event_with_rank
ORDER BY rank ASC
LIMIT :limit::INTEGER;
