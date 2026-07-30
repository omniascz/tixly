-- Velký DB health check — komplet stav po všech parita sessions.
-- Read-only, žádné side-effects.

\echo === TIXLY DB HEALTH CHECK ===
\echo

\echo --- 1. Migrace aplikovány ---
SELECT
  COUNT(*) AS total_migrations,
  MAX(filename) AS latest_migration
FROM public.schema_migrations
WHERE filename ~ '^(28[0-9]|29[0-9]|30[0-9])';

\echo
\echo --- 2. Schémata + počet tabulek ---
SELECT
  n.nspname AS schema,
  COUNT(c.oid) AS tables
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
GROUP BY n.nspname
HAVING COUNT(c.oid) >= 3
ORDER BY n.nspname;

\echo
\echo --- 3. RLS pokrytí ---
SELECT
  COUNT(*) FILTER (WHERE rowsecurity) AS with_rls,
  COUNT(*) FILTER (WHERE NOT rowsecurity) AS without_rls,
  ROUND(100.0 * COUNT(*) FILTER (WHERE rowsecurity) / COUNT(*), 1) AS pct_with_rls
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog','information_schema');

\echo
\echo --- 4. Duplikátní FK (mělo by být 0) ---
SELECT COUNT(*) AS duplicate_fk_count
FROM (
  SELECT conrelid, conkey, confrelid
    FROM pg_constraint
   WHERE contype='f'
   GROUP BY conrelid, conkey, confrelid
  HAVING COUNT(*) > 1
) x;

\echo
\echo --- 5. Orphan check (critical tables) ---
SELECT 'orders.user_id orphans' AS check, COUNT(*) AS cnt
  FROM orders.orders o
  LEFT JOIN identity.users u ON u.id = o.user_id
 WHERE u.id IS NULL
UNION ALL
SELECT 'orders.event_id orphans', COUNT(*)
  FROM orders.orders o
  LEFT JOIN catalog.events e ON e.id = o.event_id
 WHERE o.event_id IS NOT NULL AND e.id IS NULL
UNION ALL
SELECT 'tickets.order_id orphans', COUNT(*)
  FROM tickets.tickets t
  LEFT JOIN orders.orders o ON o.id = t.order_id
 WHERE o.id IS NULL
UNION ALL
SELECT 'tickets.owner_id orphans', COUNT(*)
  FROM tickets.tickets t
  LEFT JOIN identity.users u ON u.id = t.owner_id
 WHERE u.id IS NULL
UNION ALL
SELECT 'tickets.ticket_type_id orphans', COUNT(*)
  FROM tickets.tickets t
  LEFT JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
 WHERE tt.id IS NULL;

\echo
\echo --- 6. Multi-tenant integrity (promoter ownership consistency) ---
SELECT 'venues z jiných promotérů použity v eventech' AS check,
       COUNT(*) AS cnt
  FROM catalog.events e
  JOIN catalog.venues v ON v.id = e.venue_id
 WHERE v.promoter_id IS NOT NULL AND v.promoter_id != e.promoter_id
UNION ALL
SELECT 'ticket_types z jiného eventu v orders',
       COUNT(*)
  FROM tickets.tickets t
  JOIN orders.orders o ON o.id = t.order_id
  JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
 WHERE o.event_id IS NOT NULL AND tt.event_id != o.event_id;

\echo
\echo --- 7. Nové features rozsah (po Fázích TM1-8, EB1-3) ---
SELECT 'Smart Queue events' AS feature, COUNT(*) FROM waiting_room.queues
UNION ALL
SELECT 'Verified Fan registrations', COUNT(*) FROM verified_fan.registrations
UNION ALL
SELECT 'Event Groups', COUNT(*) FROM event_groups.groups
UNION ALL
SELECT 'Pricing scenarios', COUNT(*) FROM revenue.price_scenarios
UNION ALL
SELECT 'Wallet passes issued', COUNT(*) FROM tickets.wallet_passes
UNION ALL
SELECT 'NFC taps', COUNT(*) FROM tickets.nfc_taps
UNION ALL
SELECT 'Group discount tiers', COUNT(*) FROM catalog.group_discount_tiers
UNION ALL
SELECT 'Custom checkout fields', COUNT(*) FROM catalog.event_custom_fields
UNION ALL
SELECT 'Sales channels', COUNT(*) FROM catalog.sales_channels
UNION ALL
SELECT 'Channel price overrides', COUNT(*) FROM catalog.ticket_type_channel_prices
UNION ALL
SELECT 'Insurance plans', COUNT(*) FROM catalog.insurance_plans
UNION ALL
SELECT 'OAuth clients', COUNT(*) FROM b2b.oauth_clients
UNION ALL
SELECT 'Dashboard widgets', COUNT(*) FROM platform.dashboard_widgets
UNION ALL
SELECT 'Event templates', COUNT(*) FROM catalog.event_templates
UNION ALL
SELECT 'Sandbox fixtures', COUNT(*) FROM b2b.sandbox_fixtures
UNION ALL
SELECT 'Inventory mat view rows', COUNT(*) FROM catalog.mv_event_inventory_status;

\echo
\echo --- 8. Hot event mode flag distribution ---
SELECT
  COUNT(*) FILTER (WHERE hot_event_mode) AS hot_events,
  COUNT(*) FILTER (WHERE require_phone_binding) AS require_phone,
  COUNT(*) FILTER (WHERE require_tan_validation) AS require_tan,
  COUNT(*) FILTER (WHERE no_gifting_mode) AS no_gifting,
  COUNT(*) FILTER (WHERE qr_reveal_minutes_before > 0) AS hidden_qr,
  COUNT(*) FILTER (WHERE postponed_at IS NOT NULL) AS postponed,
  COUNT(*) AS total_events
FROM catalog.events
WHERE status = 'published';

\echo
\echo --- 9. Delivery methods config ---
SELECT
  COUNT(*) FILTER (WHERE 'mobile' = ANY(delivery_methods)) AS mobile,
  COUNT(*) FILTER (WHERE 'pdf' = ANY(delivery_methods)) AS pdf,
  COUNT(*) FILTER (WHERE 'will_call' = ANY(delivery_methods)) AS will_call,
  COUNT(*) FILTER (WHERE 'wallet' = ANY(delivery_methods)) AS wallet
FROM catalog.events
WHERE status = 'published';

\echo
\echo --- 10. Resale eligibility view sanity ---
SELECT
  is_eligible,
  COUNT(*) AS tickets
FROM resale.vw_ticket_resale_eligibility
GROUP BY is_eligible
ORDER BY is_eligible DESC;

\echo
\echo --- 11. Demografie sample size (users s birth_year) ---
SELECT
  COUNT(*) FILTER (WHERE birth_year IS NOT NULL) AS has_birth_year,
  COUNT(*) FILTER (WHERE gender IS NOT NULL) AS has_gender,
  COUNT(*) FILTER (WHERE country_code IS NOT NULL) AS has_country,
  COUNT(*) AS total_users
FROM identity.users
WHERE anonymized_at IS NULL;

\echo
\echo --- 12. Trigger health (jméno sync) ---
SELECT
  COUNT(*) FILTER (WHERE name IS NOT NULL AND first_name IS NULL) AS legacy_name_only,
  COUNT(*) FILTER (WHERE first_name IS NOT NULL AND last_name IS NOT NULL AND name != TRIM(first_name || ' ' || last_name)) AS sync_drift,
  COUNT(*) AS total
FROM identity.users
WHERE anonymized_at IS NULL;

\echo
\echo === HEALTH CHECK DONE ===
