-- =============================================================================
-- REPORT: Přehled refundů a stornování
-- =============================================================================
-- Analýza zrušených objednávek, vrácených peněz a důvodů stornování.
--
-- Spuštění:
--   psql -v event_id="'550e8400-e29b-41d4-a716-446655440000'" -f reports/06_refunds_and_cancellations.sql
--   psql -v organizer_id="'550e8400-e29b-41d4-a716-446655440000'" -f reports/06_refunds_and_cancellations.sql
--
-- Parametry:
--   :event_id   - UUID akce (pokud NULL, filtruje se podle :organizer_id)
--   :organizer_id - UUID organizátora (používá se pokud event_id IS NULL)
--
-- Výstup sloupců:
--   event_title, order_id, cancelled_at, refund_amount, cancellation_reason,
--   days_before_event
--
-- Poznámka: Vrací se pouze skutečně zrušené objednávky (status = 'cancelled' nebo 'refunded').
-- =============================================================================

\pset pager off
\timing on

-- Defaultní parametry
\set event_id NULL
\set organizer_id NULL

WITH event_filter AS (
    -- Pokud je event_id zadán, filtrujeme konkrétní akcí
    -- Pokud není, filtrujeme všechny akce daného organizátora
    SELECT e.id, e.title, e.date_start
    FROM catalog.events e
    WHERE (
        :event_id::UUID IS NOT NULL AND e.id = :event_id::UUID
    )
    OR (
        :event_id::UUID IS NULL AND :organizer_id::UUID IS NOT NULL AND e.organizer_id = :organizer_id::UUID
    )
),
cancelled_orders AS (
    SELECT
        ef.title AS event_title,
        o.id AS order_id,
        o.updated_at AS cancelled_at,
        o.total_amount AS refund_amount,
        -- Důvod zrušení: pokud máme v audit logu, jinak 'Unknown'
        COALESCE(
            (al.new_values->>'cancellation_reason'),
            'Unknown'
        ) AS cancellation_reason,
        -- Počet dní před akcí
        EXTRACT(DAY FROM ef.date_start - o.updated_at)::INTEGER AS days_before_event
    FROM orders.orders o
    JOIN event_filter ef ON TRUE
    LEFT JOIN audit.audit_log al
        ON al.schema_name = 'orders'
        AND al.table_name = 'orders'
        AND al.record_id = o.id::TEXT
        AND al.action = 'UPDATE'
        AND (al.old_values->>'status') = 'pending'
        AND (al.new_values->>'status') IN ('cancelled', 'refunded')
    WHERE o.status IN ('cancelled', 'refunded')
)
SELECT
    event_title,
    order_id,
    cancelled_at,
    refund_amount,
    cancellation_reason,
    days_before_event
FROM cancelled_orders
ORDER BY cancelled_at DESC;
