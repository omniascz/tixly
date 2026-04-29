-- =============================================================================
-- REPORT: Prodeje dle zóny a sekce
-- =============================================================================
-- Přehled prodejů vstuppenek dle zón a sekcí pro danou akcí.
-- Včetně počtu prodaných vstupenek, zbývajících kapacit, tržeb a vypočítaných metrik.
--
-- Spuštění:
--   psql -v event_id="'550e8400-e29b-41d4-a716-446655440000'" -f reports/01_sales_by_zone.sql
--   psql -v event_id="'550e8400-e29b-41d4-a716-446655440000'" -f reports/01_sales_by_zone.sql | grep -v "^$"
--
-- Výstup sloupců:
--   zone, section, ticket_type_name, tickets_sold, tickets_remaining, revenue,
--   avg_price, fill_percent
-- =============================================================================

\pset pager off
\timing on

-- Validace parametru
\set event_id '550e8400-e29b-41d4-a716-446655440000'

SELECT
    -- Identifikace zóny
    COALESCE(tt.zone, 'General Admission') AS zone,
    COALESCE(s.section, 'N/A') AS section,
    tt.name AS ticket_type_name,

    -- Prodejní metriky
    COUNT(DISTINCT t.id) AS tickets_sold,
    tt.remaining_qty AS tickets_remaining,

    -- Finanční metriky (pouze placené objednávky)
    COALESCE(SUM(oi.total_price), 0) AS revenue,
    COALESCE(AVG(oi.unit_price), 0) AS avg_price,

    -- Procento naplnění zóny
    ROUND(
        CASE
            WHEN tt.total_qty = 0 THEN 0
            ELSE (COUNT(DISTINCT t.id)::NUMERIC / tt.total_qty * 100)
        END,
        2
    ) AS fill_percent

FROM catalog.ticket_types tt
-- LEFT JOIN s objednávkami a položkami (pro placené objednávky)
LEFT JOIN orders.order_items oi ON oi.ticket_type_id = tt.id
LEFT JOIN orders.orders o ON o.id = oi.order_id AND o.status = 'paid'
LEFT JOIN tickets.tickets t ON t.order_id = o.id
-- LEFT JOIN se sedadly pro seated eventy
LEFT JOIN catalog.seats s ON s.id = oi.seat_id AND s.status IN ('sold', 'locked')
WHERE tt.event_id = :event_id::UUID

GROUP BY
    tt.id,
    tt.zone,
    tt.name,
    tt.total_qty,
    tt.remaining_qty,
    s.section

ORDER BY
    revenue DESC NULLS LAST,
    zone ASC,
    section ASC,
    ticket_type_name ASC;
