#!/usr/bin/env bash
# Kolo 20 / krok 1.5 — DB pro golden-path-buyer a golden-path-benefit (potřebují staré „rich demo": Romeo a Julie / Hamlet
# 0000…0401/0402, admin@tixly.cz, theatre@hranice.cz, anna.nova@example.cz — repo nemá seed, který by šel na schéma z migrací).
#   1) ${R20_RICH_DB:-r20rich} v lokálním fix-pg OD NULY z migrací (.github/scripts/build-db-from-migrations.sh)
#   2) data demo tabulek se jen ČTOU z lokální vývojové DB tixly-postgres/tixly (COPY TO STDOUT; nic se tam nezapisuje)
#      a vloží se do r20rich přes průnik sloupců (session_replication_role=replica — bez FK/triggerů, jako restore dumpu).
# Aplikace pak běží pod tixly_app (NOBYPASSRLS) s RLS. Jen localhost.
set -euo pipefail
D=${R20_RICH_DB:-r20rich}
T=/c/Users/omnia/Documents/tixly
MSYS_NO_PATHCONV=1 docker run --rm --network container:fix-pg -v "$T:/repo" -w /repo postgres:17 \
  bash .github/scripts/build-db-from-migrations.sh postgresql://neondb_owner:fixowner@localhost:5432/postgres "$D" fixapp | tail -2
SRC="docker exec tixly-postgres psql -U tixly -d tixly -v ON_ERROR_STOP=1 -At"
DST="docker exec -i fix-pg psql -U neondb_owner -d $D -v ON_ERROR_STOP=1 -At"
for t in identity.users identity.user_secrets platform.promoters platform.promoter_members catalog.venue_places catalog.venues catalog.venue_seating_charts \
         catalog.productions catalog.events catalog.ticket_types catalog.event_seats; do
  s=${t%.*}; n=${t#*.}
  q="select string_agg(quote_ident(column_name), ',' order by column_name) from information_schema.columns where table_schema='$s' and table_name='$n'"
  srccols=$($SRC -c "select column_name from information_schema.columns where table_schema='$s' and table_name='$n'" | sort)
  [ -n "$srccols" ] || { echo "$t: ve vývojové DB neexistuje — přeskočeno"; continue; }
  dstcols=$($DST -c "select column_name from information_schema.columns c join pg_attribute a on a.attrelid='$t'::regclass and a.attname=c.column_name where table_schema='$s' and table_name='$n' and a.attgenerated=''" | sort)
  cols=$(comm -12 <(echo "$srccols") <(echo "$dstcols") | sed 's/.*/"&"/' | paste -sd,)
  onlysrc=$(comm -23 <(echo "$srccols") <(echo "$dstcols") | paste -sd' ')
  $SRC -c "COPY (SELECT $cols FROM $t) TO STDOUT" | $DST -c "SET session_replication_role = replica; COPY $t ($cols) FROM STDIN" >/dev/null
  echo "$t: $($DST -c "select count(*) from $t") řádků; sloupce jen ve vývojové DB (vynechány): ${onlysrc:-žádné}"
done
# 3) termíny vývojové DB jsou z června 2026 (minulost) → všechny časové sloupce akcí a typů vstupenek (kromě created/updated)
#    se posunou o stejný počet dní tak, aby Romeo a Julie (0401) byl 30 dní v budoucnu. Asserty specy se nemění.
$DST <<'SQL'
DO $$
DECLARE off interval; t text; sets text;
BEGIN
  SELECT (date_trunc('day', now()) + interval '30 days') - date_trunc('day', date_start) INTO off
    FROM catalog.events WHERE id = '00000000-0000-4000-a000-000000000401';
  FOREACH t IN ARRAY ARRAY['events', 'ticket_types'] LOOP
    SELECT string_agg(format('%1$I = %1$I + $1', column_name), ', ') INTO sets FROM information_schema.columns
     WHERE table_schema = 'catalog' AND table_name = t AND data_type LIKE 'timestamp%' AND column_name NOT IN ('created_at', 'updated_at');
    EXECUTE format('ALTER TABLE catalog.%I DISABLE TRIGGER USER', t);
    EXECUTE format('UPDATE catalog.%I SET %s', t, sets) USING off;
    EXECUTE format('ALTER TABLE catalog.%I ENABLE TRIGGER USER', t);
  END LOOP;
  RAISE NOTICE 'posun termínů: %', off;
END $$;
SQL
$DST -c "select title, date_start from catalog.events where id in ('00000000-0000-4000-a000-000000000401','00000000-0000-4000-a000-000000000402') order by 1"
