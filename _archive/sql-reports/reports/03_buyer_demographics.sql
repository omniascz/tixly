-- =============================================================================
-- REPORT: Demografika kupujících
-- =============================================================================
-- Tři samostatné SELECT dotazy pro analýzu kupujících.
-- (1) Top 10 měst - GDPR: bez PII, agregované metriky
-- (2) Opakovaní vs. nový zákazníci - churn analysis
-- (3) Nákupní kanál - device_type analýza
--
-- Spuštění:
--   psql -v event_id="'550e8400-e29b-41d4-a716-446655440000'" -f reports/03_buyer_demographics.sql
--
-- Poznámka GDPR: Tato reportu neobsahuje jméno ani e-mail, pouze city a device_type.
-- =============================================================================

\pset pager off
\timing on

\set event_id '550e8400-e29b-41d4-a716-446655440000'

-- =============================================================================
-- DOTAZ 1: Top 10 měst
-- =============================================================================
\echo '=== TOP 10 MĚST ==='
\echo 'city | buyer_count | revenue | avg_order_value'

WITH buyer_cities AS (
    SELECT
        COALESCE(u.city, 'Unknown') AS city,
        COUNT(DISTINCT o.user_id) AS buyer_count,
        ROUND(SUM(oi.total_price), 2) AS revenue,
        ROUND(AVG(oi.total_price), 2) AS avg_order_value
    FROM orders.orders o
    JOIN orders.order_items oi ON oi.order_id = o.id
    JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
    JOIN identity.users u ON u.id = o.user_id
    WHERE tt.event_id = :event_id::UUID
        AND o.status = 'paid'
        AND u.anonymized_at IS NULL  -- Pouze aktivní (neanonymizované) uživatele
    GROUP BY u.city
)
SELECT
    city,
    buyer_count,
    revenue,
    avg_order_value
FROM buyer_cities
ORDER BY revenue DESC
LIMIT 10;

-- =============================================================================
-- DOTAZ 2: Opakovaní zákazníci vs. noví
-- =============================================================================
\echo ''
\echo '=== OPAKOVANÍ VS. NOVÍ ZÁKAZNÍCI ==='
\echo 'repeat_buyers | new_buyers | repeat_rate_pct'

WITH buyer_history AS (
    SELECT
        o.user_id,
        COUNT(DISTINCT tt.event_id) AS event_count
    FROM orders.orders o
    JOIN orders.order_items oi ON oi.order_id = o.id
    JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
    WHERE o.status = 'paid'
    GROUP BY o.user_id
),
buyer_categorization AS (
    SELECT
        CASE
            WHEN bh.event_count > 1 THEN 'repeat'
            ELSE 'new'
        END AS buyer_type,
        COUNT(*) AS buyer_count
    FROM buyer_history bh
    GROUP BY CASE WHEN bh.event_count > 1 THEN 'repeat' ELSE 'new' END
)
SELECT
    SUM(CASE WHEN buyer_type = 'repeat' THEN buyer_count ELSE 0 END) AS repeat_buyers,
    SUM(CASE WHEN buyer_type = 'new' THEN buyer_count ELSE 0 END) AS new_buyers,
    ROUND(
        SUM(CASE WHEN buyer_type = 'repeat' THEN buyer_count ELSE 0 END)::NUMERIC
        / SUM(buyer_count) * 100,
        2
    ) AS repeat_rate_pct
FROM buyer_categorization;

-- =============================================================================
-- DOTAZ 3: Nákupní kanál (device_type)
-- =============================================================================
\echo ''
\echo '=== NÁKUPNÍ KANÁL (DEVICE_TYPE) ==='
\echo 'device_type | order_count | revenue'

SELECT
    COALESCE(ud.device_type, 'Unknown') AS device_type,
    COUNT(DISTINCT o.id) AS order_count,
    ROUND(SUM(oi.total_price), 2) AS revenue
FROM orders.orders o
JOIN orders.order_items oi ON oi.order_id = o.id
JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
LEFT JOIN identity.user_devices ud ON ud.user_id = o.user_id
WHERE tt.event_id = :event_id::UUID
    AND o.status = 'paid'
    AND ud.last_seen_at IS NOT NULL
GROUP BY ud.device_type
ORDER BY revenue DESC NULLS LAST;
