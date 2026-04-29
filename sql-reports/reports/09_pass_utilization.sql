-- =============================================================================
-- REPORT: Využití permanentek a sezónních karet
-- =============================================================================
-- Analýza aktivních permanentek, jejich využití a obnovovacího potenciálu.
-- Zaměření na monthly recurring revenue (MRR) pro business model.
--
-- Spuštění:
--   psql -v organizer_id="'550e8400-e29b-41d4-a716-446655440000'" -f reports/09_pass_utilization.sql
--
-- Parametr:
--   :organizer_id - UUID organizátora
--
-- Výstup sloupců:
--   pass_type_name, active_passes, total_uses, avg_uses_per_pass, unused_passes,
--   renewal_rate_pct, monthly_recurring_revenue
--
-- Poznámka: Pokud tabulka passes.season_passes není plně populována, vrátí se NULL/0.
-- =============================================================================

\pset pager off
\timing on

\set organizer_id NULL

-- Poznámka: Tento report předpokládá existenci tabulek v schématu 'passes'.
-- Pokud nejsou k dispozici, upravit dotaz nebo vytvořit placeholder.

WITH pass_types_by_organizer AS (
    -- Filtrujeme permanentky pro daného organizátora
    -- Mapování: season_passes → season_pass_types → events → organizer_id
    SELECT
        spt.id,
        spt.name,
        spt.billing_cycle,
        spt.monthly_price
    FROM passes.season_pass_types spt
    LEFT JOIN catalog.events e ON e.id = spt.event_id
    WHERE e.organizer_id = :organizer_id::UUID
        OR spt.organizer_id = :organizer_id::UUID
),
pass_usage_stats AS (
    -- Agregujeme data o aktivních permanentkách a jejich použití
    SELECT
        spt.id AS pass_type_id,
        spt.name AS pass_type_name,
        spt.billing_cycle,
        spt.monthly_price,
        COUNT(DISTINCT sp.id) AS active_passes,
        COALESCE(SUM(pu.usage_count), 0) AS total_uses,
        COALESCE(
            ROUND(SUM(pu.usage_count)::NUMERIC / NULLIF(COUNT(DISTINCT sp.id), 0), 2),
            0
        ) AS avg_uses_per_pass,
        COUNT(DISTINCT CASE WHEN pu.usage_count = 0 OR pu.usage_count IS NULL
            THEN sp.id ELSE NULL END) AS unused_passes,
        -- Renewal rate: procento pasů které byly obnoveny
        COALESCE(
            ROUND(
                COUNT(DISTINCT CASE WHEN sp.renewed_at IS NOT NULL THEN sp.id ELSE NULL END)::NUMERIC
                / NULLIF(COUNT(DISTINCT sp.id), 0) * 100,
                2
            ),
            0
        ) AS renewal_rate_pct
    FROM pass_types_by_organizer spt
    LEFT JOIN passes.season_passes sp ON sp.season_pass_type_id = spt.id
        AND sp.status = 'active'
    LEFT JOIN passes.pass_usages pu ON pu.pass_id = sp.id
    GROUP BY spt.id, spt.name, spt.billing_cycle, spt.monthly_price
)
SELECT
    pass_type_name,
    active_passes,
    total_uses::BIGINT,
    avg_uses_per_pass,
    unused_passes,
    renewal_rate_pct,
    -- MRR: součin aktivních monthly pasů × monthly_price
    ROUND(
        CASE
            WHEN billing_cycle = 'monthly'
                THEN active_passes * monthly_price
            ELSE 0
        END,
        2
    ) AS monthly_recurring_revenue

FROM pass_usage_stats
ORDER BY monthly_recurring_revenue DESC NULLS LAST,
         pass_type_name ASC;
