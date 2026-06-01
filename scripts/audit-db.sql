-- ============================================================================
-- Tixly — VELKÝ DB AUDIT (2026-06-01)
-- Spustit proti seedované baseline DB:
--   docker exec -i tixly-postgres psql -U tixly -d tixly < scripts/audit-db.sql
-- Každá sekce vypíše jen PROBLÉMY (prázdný výstup = OK).
-- ============================================================================

\pset pager off
\echo '==================== 1. STRUKTURA SCHÉMATU ===================='

\echo '--- 1a. Tabulky BEZ primárního klíče (datová integrita / replikace) ---'
SELECT n.nspname AS schema, c.relname AS tabulka
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname NOT IN ('pg_catalog','information_schema')
  AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'p')
ORDER BY 1,2;

\echo '--- 1b. RLS ZAPNUTO ale ŽÁDNÁ policy (app role = total lockout deny-all) ---'
SELECT n.nspname AS schema, c.relname AS tabulka
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r' AND c.relrowsecurity = true
  AND n.nspname NOT IN ('pg_catalog','information_schema')
  AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
ORDER BY 1,2;

\echo '--- 1c. Tabulky s tenant/PII sloupcem ale RLS VYPNUTO (tenant leak risk) ---'
SELECT DISTINCT n.nspname AS schema, c.relname AS tabulka,
       string_agg(DISTINCT a.attname, ',') AS tenant_cols
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
WHERE c.relkind = 'r' AND c.relrowsecurity = false
  AND n.nspname NOT IN ('pg_catalog','information_schema','audit','public')
  AND a.attname IN ('promoter_id','user_id','organizer_id')
GROUP BY 1,2
ORDER BY 1,2;

\echo '--- 1d. FK sloupec BEZ podpůrného indexu (perf + lock contention) ---'
SELECT conrelid::regclass AS tabulka, conname AS fk
FROM pg_constraint c
WHERE contype = 'f'
  AND array_length(conkey,1) = 1
  AND NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1]
  )
ORDER BY 1 LIMIT 60;

\echo '--- 1e. Duplicitní indexy (stejná tabulka + stejné sloupce) ---'
SELECT indrelid::regclass AS tabulka, array_agg(indexrelid::regclass) AS indexy
FROM pg_index
GROUP BY indrelid, indkey
HAVING count(*) > 1
ORDER BY 1 LIMIT 40;

\echo '==================== 2. DATOVÁ INTEGRITA (seed) ===================='

\echo '--- 2a. ticket_types: nevalidní množství/ceny ---'
SELECT id, event_id, name, base_price, total_qty, remaining_qty
FROM catalog.ticket_types
WHERE base_price < 0 OR total_qty < 0 OR remaining_qty < 0 OR remaining_qty > total_qty
ORDER BY 1 LIMIT 40;

\echo '--- 2b. event_seats: ticket_type patří k jinému eventu než sedadlo (cross-event leak) ---'
SELECT es.id AS seat_id, es.event_id AS seat_event, tt.event_id AS tt_event
FROM catalog.event_seats es
JOIN catalog.ticket_types tt ON tt.id = es.ticket_type_id
WHERE tt.event_id <> es.event_id
LIMIT 40;

\echo '--- 2c. ticket_type.total_qty NESEDÍ s počtem event_seats v zóně (seated) ---'
SELECT tt.event_id, tt.zone, tt.total_qty AS deklarovano,
       COUNT(es.id) AS realnych_sedadel
FROM catalog.ticket_types tt
LEFT JOIN catalog.event_seats es ON es.ticket_type_id = tt.id
WHERE tt.is_seated = true
GROUP BY tt.id, tt.event_id, tt.zone, tt.total_qty
HAVING tt.total_qty <> COUNT(es.id)
ORDER BY 1 LIMIT 40;

\echo '--- 2d. orders: total_amount != suma order_items (total_price) ---'
SELECT o.id, o.total_amount AS order_total, COALESCE(SUM(oi.total_price),0) AS items_total
FROM orders.orders o
LEFT JOIN orders.order_items oi ON oi.order_id = o.id
GROUP BY o.id, o.total_amount
HAVING o.total_amount <> COALESCE(SUM(oi.total_price),0)
ORDER BY 1 LIMIT 40;

\echo '--- 2e. orders: záporné částky ---'
SELECT id, status, total_amount FROM orders.orders WHERE total_amount < 0 LIMIT 40;

\echo '--- 2f. Publikované eventy BEZ jediného ticket_type ---'
SELECT e.id, e.title, e.status
FROM catalog.events e
WHERE e.status = 'published'
  AND NOT EXISTS (SELECT 1 FROM catalog.ticket_types tt WHERE tt.event_id = e.id)
ORDER BY 1 LIMIT 40;

\echo '--- 2g. Seated eventy (mají seated ticket_type) ale 0 event_seats (nelze koupit) ---'
SELECT DISTINCT e.id, e.title, e.status
FROM catalog.events e
JOIN catalog.ticket_types tt ON tt.event_id = e.id AND tt.is_seated = true
WHERE e.status = 'published'
  AND NOT EXISTS (SELECT 1 FROM catalog.event_seats es WHERE es.event_id = e.id)
ORDER BY 1 LIMIT 40;

\echo '--- 2h. event_seats: nevalidní status (mimo očekávanou množinu) ---'
SELECT status, COUNT(*) FROM catalog.event_seats
WHERE status NOT IN ('available','reserved','sold','held','blocked','unavailable')
GROUP BY status LIMIT 20;

\echo '==================== 3. CROSS-FEATURE LOGIKA ===================='

\echo '--- 3a. Seating chart total_seats != skutečný počet sedadel v layoutu ---'
SELECT vsc.id, vsc.name, vsc.total_seats AS deklarovano,
       (SELECT COALESCE(SUM((SELECT COUNT(*) FROM jsonb_array_elements(sec->'rows') r,
                                                 jsonb_array_elements(r->'seats') s)),0)
        FROM jsonb_array_elements(vsc.layout->'sectors') sec) AS v_layoutu
FROM catalog.venue_seating_charts vsc
WHERE vsc.layout ? 'sectors'
  AND vsc.total_seats <> (SELECT COALESCE(SUM((SELECT COUNT(*) FROM jsonb_array_elements(sec->'rows') r,
                                                 jsonb_array_elements(r->'seats') s)),0)
        FROM jsonb_array_elements(vsc.layout->'sectors') sec)
ORDER BY 1 LIMIT 40;

\echo '--- 3b. Více než 1 AKTIVNÍ seating chart na venue (nejednoznačnost) ---'
SELECT venue_id, COUNT(*) AS aktivnich_chartu
FROM catalog.venue_seating_charts
WHERE active = true
GROUP BY venue_id
HAVING COUNT(*) > 1
ORDER BY 1 LIMIT 40;

\echo '--- 3c. Venue capacity výrazně menší než aktivní chart (špatně zadaná kapacita) ---'
SELECT v.id, v.name, v.capacity, vsc.total_seats AS chart_seats
FROM catalog.venues v
JOIN catalog.venue_seating_charts vsc ON vsc.venue_id = v.id AND vsc.active = true
WHERE v.capacity IS NOT NULL AND vsc.total_seats > v.capacity
ORDER BY 1 LIMIT 40;

\echo '--- 3d. Publikované eventy s NULOVOU dostupnou inventory (remaining_qty=0 všude) ---'
SELECT e.id, e.title
FROM catalog.events e
WHERE e.status = 'published'
  AND EXISTS (SELECT 1 FROM catalog.ticket_types tt WHERE tt.event_id = e.id)
  AND NOT EXISTS (SELECT 1 FROM catalog.ticket_types tt WHERE tt.event_id = e.id AND tt.remaining_qty > 0)
ORDER BY 1 LIMIT 40;

\echo '==================== 4. BEZPEČNOST / CITLIVÁ DATA ===================='

\echo '--- 4a. Sloupce hesel / tajemství, které jsou NULLABLE (měly by být NOT NULL) ---'
SELECT table_schema, table_name, column_name
FROM information_schema.columns
WHERE column_name IN ('password_hash','totp_secret','totp_secret_iv')
  AND is_nullable = 'YES'
ORDER BY 1,2,3 LIMIT 40;

\echo '--- 4b. Tabulky s PII (email/phone) bez RLS (info — posoudit) ---'
SELECT DISTINCT n.nspname AS schema, c.relname AS tabulka
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
WHERE c.relkind = 'r' AND c.relrowsecurity = false
  AND n.nspname NOT IN ('pg_catalog','information_schema','audit','public')
  AND a.attname IN ('email','phone','phone_number')
ORDER BY 1,2 LIMIT 60;

\echo '==================== KONEC AUDITU ===================='
