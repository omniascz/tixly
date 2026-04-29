-- =============================================================================
-- REPORT: Resale objem a analýza
-- =============================================================================
-- Přehled přeprodejného trhu pro danou akcí.
-- Součástí jsou metrics: počet inzerátů, jejich stav, průměrná cena, sleva,
-- tržby z přeproděje a doba prodání.
--
-- Spuštění:
--   psql -v event_id="'550e8400-e29b-41d4-a716-446655440000'" -f reports/02_resale_volume.sql
--
-- Výstup sloupců:
--   total_listings, active_listings, sold_listings, cancelled_listings,
--   avg_ask_price, avg_discount_pct, total_resale_revenue, platform_commission,
--   median_time_to_sell_minutes
-- =============================================================================

\pset pager off
\timing on

\set event_id '550e8400-e29b-41d4-a716-446655440000'

WITH ticket_base AS (
    -- Načteme všechny vstupenky z dané akce
    SELECT
        t.id,
        t.original_price,
        t.ticket_type_id
    FROM tickets.tickets t
    JOIN orders.orders o ON o.id = t.order_id AND o.status = 'paid'
    JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
    WHERE tt.event_id = :event_id::UUID
),
resale_metrics AS (
    -- Analyze resale listings s denormalizovanou original_price
    SELECT
        rl.id,
        rl.status,
        rl.ask_price,
        rl.original_price,
        rl.listed_at,
        rl.sold_at,
        rl.cancelled_at,
        -- Výpočet slevy v procentech: (1 - ask_price / original_price) * 100
        CASE
            WHEN rl.original_price > 0
                THEN ROUND((1 - (rl.ask_price::NUMERIC / rl.original_price)) * 100, 2)
            ELSE 0
        END AS discount_pct,
        -- Čas od vystavení do prodeje v minutách
        CASE
            WHEN rl.status = 'sold' AND rl.sold_at IS NOT NULL
                THEN EXTRACT(EPOCH FROM (rl.sold_at - rl.listed_at)) / 60
            ELSE NULL
        END AS time_to_sell_minutes
    FROM resale.resale_listings rl
    JOIN ticket_base tb ON tb.id = rl.ticket_id
)
SELECT
    -- Celkový počet inzerátů
    COUNT(*) AS total_listings,
    COUNT(*) FILTER (WHERE status = 'active') AS active_listings,
    COUNT(*) FILTER (WHERE status = 'sold') AS sold_listings,
    COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled_listings,

    -- Ceny a slevy
    ROUND(AVG(ask_price), 2) AS avg_ask_price,
    ROUND(AVG(discount_pct), 2) AS avg_discount_pct,

    -- Tržby z přeproděje (bez provizí)
    ROUND(SUM(ask_price) FILTER (WHERE status = 'sold'), 2) AS total_resale_revenue,

    -- Plnění provizí (typicky 5-10% z prodejní ceny)
    ROUND(
        SUM(ask_price) FILTER (WHERE status = 'sold') * 0.05,
        2
    ) AS platform_commission,

    -- Medián času k prodeji v minutách (pro aktivně prodávané inzeráty)
    ROUND(
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY time_to_sell_minutes),
        0
    )::INTEGER AS median_time_to_sell_minutes

FROM resale_metrics;
