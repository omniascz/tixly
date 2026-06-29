import type { ReportDef } from './types';
import { DATE_PARAMS, SALES_COLS, from, to, timeSalesQuery, dimSalesQuery, BASE_SALES_SQL } from './helpers';

export const REPORTS_PRODEJE: ReportDef[] = [
  {
    id: 'prodeje_denni', title: 'Prodeje dle dne', category: 'prodeje',
    description: 'Denní přehled objednávek, vstupenek a tržeb za zvolené období.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [{ key: 'obdobi', label: 'Den', type: 'date' }, ...SALES_COLS],
    buildQuery: timeSalesQuery('day'),
  },
  {
    id: 'prodeje_tydenni', title: 'Prodeje dle týdne', category: 'prodeje',
    description: 'Týdenní souhrn prodeje.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [{ key: 'obdobi', label: 'Týden od', type: 'date' }, ...SALES_COLS],
    buildQuery: timeSalesQuery('week'),
  },
  {
    id: 'prodeje_mesicni', title: 'Prodeje dle měsíce', category: 'prodeje',
    description: 'Měsíční souhrn prodeje.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [{ key: 'obdobi', label: 'Měsíc', type: 'date' }, ...SALES_COLS],
    buildQuery: timeSalesQuery('month'),
  },
  {
    id: 'prodeje_ctvrtletni', title: 'Prodeje dle čtvrtletí', category: 'prodeje',
    description: 'Čtvrtletní souhrn prodeje.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [{ key: 'obdobi', label: 'Čtvrtletí', type: 'date' }, ...SALES_COLS],
    buildQuery: timeSalesQuery('quarter'),
  },
  {
    id: 'prodeje_rocni', title: 'Prodeje dle roku', category: 'prodeje',
    description: 'Roční souhrn prodeje.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [{ key: 'obdobi', label: 'Rok', type: 'date' }, ...SALES_COLS],
    buildQuery: timeSalesQuery('year'),
  },
  {
    id: 'prodeje_hodinove', title: 'Prodeje dle hodiny', category: 'prodeje',
    description: 'Distribuce prodejů dle hodiny v průběhu dne.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'hodina', label: 'Hodina', type: 'text' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT EXTRACT(HOUR FROM o.paid_at AT TIME ZONE 'Europe/Prague')::int::text AS hodina,
                   COUNT(*)::int AS objednavky,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk
            ${BASE_SALES_SQL}
            GROUP BY 1 ORDER BY 1 ASC`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'prodeje_den_tydne', title: 'Prodeje dle dne v týdnu', category: 'prodeje',
    description: 'Která den v týdnu se prodává nejvíce.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'den', label: 'Den', type: 'text' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT TO_CHAR(o.paid_at AT TIME ZONE 'Europe/Prague', 'ID - Day') AS den,
                   COUNT(*)::int AS objednavky,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk
            ${BASE_SALES_SQL}
            GROUP BY 1 ORDER BY 1 ASC`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'prodeje_dle_akce', title: 'Prodeje dle akce', category: 'prodeje',
    description: 'Tržby a počty vstupenek po jednotlivých akcích.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      ...SALES_COLS,
    ],
    buildQuery: dimSalesQuery('e.title', 'akce'),
  },
  {
    id: 'prodeje_dle_typu', title: 'Prodeje dle typu vstupenky', category: 'prodeje',
    description: 'Které typy vstupenek generují nejvíce tržeb.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'typ', label: 'Typ vstupenky', type: 'text' },
      { key: 'akce', label: 'Akce', type: 'text' },
      ...SALES_COLS,
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT tt.name AS typ, e.title AS akce,
                   COUNT(DISTINCT o.id)::int AS objednavky,
                   COALESCE(SUM(oi.quantity),0)::int AS vstupenek,
                   ROUND(SUM(oi.total_price)/100.0,2)::numeric AS trzby_czk,
                   ROUND(AVG(oi.unit_price)/100.0,2)::numeric AS prumer_czk
            FROM orders.order_items oi
            JOIN orders.orders o ON o.id = oi.order_id
            JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
            JOIN catalog.events e ON e.id = o.event_id
            WHERE e.promoter_id = $1 AND o.status = 'paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY 1,2 ORDER BY trzby_czk DESC LIMIT 200`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'prodeje_dle_meny', title: 'Prodeje dle měny', category: 'prodeje',
    description: 'Rozpad tržeb dle měny (CZK, EUR, SKK…).',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [{ key: 'mena', label: 'Měna', type: 'badge' }, ...SALES_COLS],
    buildQuery: dimSalesQuery('o.currency', 'mena', '', '', 'trzby_czk DESC', 50),
  },
  {
    id: 'prodeje_dle_platby', title: 'Prodeje dle platební metody', category: 'prodeje',
    description: 'Které platební brány zákazníci preferují.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [{ key: 'metoda', label: 'Metoda', type: 'badge' }, ...SALES_COLS],
    buildQuery: dimSalesQuery('COALESCE(o.payment_provider,\'neznámo\')', 'metoda', '', '', 'trzby_czk DESC', 50),
  },
  {
    id: 'prodeje_top_akce', title: 'Top 30 akcí dle tržeb', category: 'prodeje',
    description: 'Nejlepší akce za zvolené období seřazené dle tržeb.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [{ key: 'akce', label: 'Akce', type: 'text' }, ...SALES_COLS],
    buildQuery: dimSalesQuery('e.title', 'akce', '', '', 'trzby_czk DESC', 30),
  },
  {
    id: 'prodeje_top_typy', title: 'Top 30 typů vstupenek', category: 'prodeje',
    description: 'Nejprodávanější typy vstupenek dle objemu.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'typ', label: 'Typ', type: 'text' },
      { key: 'vstupenek', label: 'Vstupenek', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT tt.name AS typ,
                   COALESCE(SUM(oi.quantity),0)::int AS vstupenek,
                   ROUND(SUM(oi.total_price)/100.0,2)::numeric AS trzby_czk
            FROM orders.order_items oi
            JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
            JOIN orders.orders o ON o.id = oi.order_id
            JOIN catalog.events e ON e.id = o.event_id
            WHERE e.promoter_id = $1 AND o.status = 'paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY vstupenek DESC LIMIT 30`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'prodeje_fill_rate', title: 'Fill rate dle akce', category: 'prodeje',
    description: 'Obsazenost kapacity pro každou akci (%).',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'prodano', label: 'Prodáno', type: 'number' },
      { key: 'kapacita', label: 'Kapacita', type: 'number' },
      { key: 'fill_rate', label: 'Fill rate %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce,
                   COALESCE(SUM(tt.total_qty - tt.remaining_qty),0)::int AS prodano,
                   COALESCE(SUM(tt.total_qty),0)::int AS kapacita,
                   CASE WHEN COALESCE(SUM(tt.total_qty),0) > 0
                     THEN ROUND(100.0*SUM(tt.total_qty-tt.remaining_qty)/NULLIF(SUM(tt.total_qty),0),1)
                     ELSE 0 END::numeric AS fill_rate
            FROM catalog.events e
            JOIN catalog.ticket_types tt ON tt.event_id = e.id
            WHERE e.promoter_id = $1
              AND e.date_start::date BETWEEN $2 AND $3
            GROUP BY e.id, e.title ORDER BY fill_rate DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'prodeje_kumulativni', title: 'Kumulativní tržby', category: 'prodeje',
    description: 'Narůstající součet tržeb den po dni.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'den', label: 'Den', type: 'date' },
      { key: 'trzby_den', label: 'Tržby den (Kč)', type: 'currency_czk' },
      { key: 'kumulativ', label: 'Kumulativ (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `WITH daily AS (
              SELECT o.paid_at::date AS den,
                     ROUND(SUM(o.total_amount)/100.0,2) AS trzby_den
              FROM orders.orders o JOIN catalog.events e ON e.id = o.event_id
              WHERE e.promoter_id = $1 AND o.status = 'paid'
                AND o.paid_at::date BETWEEN $2 AND $3
              GROUP BY 1
            )
            SELECT den::text, trzby_den,
                   ROUND(SUM(trzby_den) OVER (ORDER BY den),2)::numeric AS kumulativ
            FROM daily ORDER BY den LIMIT 2000`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'prodeje_yoy', title: 'Srovnání meziročně (YoY)', category: 'prodeje',
    description: 'Tržby po měsících — letos vs. loni.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Měsíc', type: 'text' },
      { key: 'trzby_letos', label: 'Letos (Kč)', type: 'currency_czk' },
      { key: 'trzby_loni', label: 'Loni (Kč)', type: 'currency_czk' },
      { key: 'zmena_pct', label: 'Změna %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `WITH base AS (
              SELECT EXTRACT(YEAR FROM o.paid_at)::int AS rok,
                     EXTRACT(MONTH FROM o.paid_at)::int AS mes,
                     ROUND(SUM(o.total_amount)/100.0,2) AS trzby
              FROM orders.orders o JOIN catalog.events e ON e.id = o.event_id
              WHERE e.promoter_id = $1 AND o.status = 'paid'
                AND o.paid_at::date BETWEEN ($2::date - INTERVAL '1 year') AND $3
              GROUP BY 1,2
            )
            SELECT TO_CHAR(MAKE_DATE(2000,mes,1),'TMMonth') AS mesic,
                   COALESCE(MAX(trzby) FILTER (WHERE rok = EXTRACT(YEAR FROM $3::date)::int),0) AS trzby_letos,
                   COALESCE(MAX(trzby) FILTER (WHERE rok = EXTRACT(YEAR FROM $3::date)::int - 1),0) AS trzby_loni,
                   CASE WHEN COALESCE(MAX(trzby) FILTER (WHERE rok = EXTRACT(YEAR FROM $3::date)::int - 1),0) > 0
                     THEN ROUND(100.0*(COALESCE(MAX(trzby) FILTER (WHERE rok = EXTRACT(YEAR FROM $3::date)::int),0)
                       - COALESCE(MAX(trzby) FILTER (WHERE rok = EXTRACT(YEAR FROM $3::date)::int - 1),0))
                       / MAX(trzby) FILTER (WHERE rok = EXTRACT(YEAR FROM $3::date)::int - 1),1)
                     ELSE NULL END::numeric AS zmena_pct
            FROM base GROUP BY mes ORDER BY mes`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'prodeje_konverze', title: 'Konverzní poměr', category: 'prodeje',
    description: 'Poměr zaplacených objednávek vůči všem vytvořeným (pending + paid + cancelled).',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'den', label: 'Den', type: 'date' },
      { key: 'celkem', label: 'Celkem obj.', type: 'number' },
      { key: 'zaplacene', label: 'Zaplacené', type: 'number' },
      { key: 'konverze', label: 'Konverze %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT o.created_at::date::text AS den,
                   COUNT(*)::int AS celkem,
                   COUNT(*) FILTER (WHERE o.status='paid')::int AS zaplacene,
                   ROUND(100.0*COUNT(*) FILTER (WHERE o.status='paid')/NULLIF(COUNT(*),0),1)::numeric AS konverze
            FROM orders.orders o JOIN catalog.events e ON e.id = o.event_id
            WHERE e.promoter_id = $1
              AND o.created_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1 LIMIT 2000`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'prodeje_gift', title: 'Dárkové vstupenky', category: 'prodeje',
    description: 'Prodeje označené jako dárek (is_gift).',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'den', label: 'Den', type: 'date' },
      { key: 'darky', label: 'Dárky', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT o.paid_at::date::text AS den,
                   COUNT(*)::int AS darky,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk
            FROM orders.orders o JOIN catalog.events e ON e.id = o.event_id
            WHERE e.promoter_id = $1 AND o.status = 'paid'
              AND o.is_gift = true
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1 LIMIT 2000`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'prodeje_dle_kategorie', title: 'Prodeje dle kategorie akce', category: 'prodeje',
    description: 'Tržby po kategoriích akcí (hudba, divadlo, sport…).',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [{ key: 'kategorie', label: 'Kategorie', type: 'badge' }, ...SALES_COLS],
    buildQuery: dimSalesQuery('COALESCE(e.category,\'other\')', 'kategorie', '', '', 'trzby_czk DESC', 20),
  },
  {
    id: 'prodeje_promo_vs_organic', title: 'Promo vs. organické', category: 'prodeje',
    description: 'Srovnání objednávek s promo kódem vs. bez.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'typ', label: 'Typ', type: 'badge' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT CASE WHEN o.promo_code_id IS NOT NULL THEN 'S promo kódem' ELSE 'Organické' END AS typ,
                   COUNT(*)::int AS objednavky,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk
            ${BASE_SALES_SQL}
            GROUP BY 1 ORDER BY 1`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'prodeje_pojistka', title: 'Prodeje s pojistkou', category: 'prodeje',
    description: 'Objednávky s připojenou pojistkou — attach rate a prémiový příjem.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'den', label: 'Den', type: 'date' },
      { key: 's_pojistkou', label: 'S pojistkou', type: 'number' },
      { key: 'bez_pojistky', label: 'Bez pojistky', type: 'number' },
      { key: 'attach_pct', label: 'Attach %', type: 'pct' },
      { key: 'premie_czk', label: 'Prémie (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT o.paid_at::date::text AS den,
                   COUNT(*) FILTER (WHERE oi2.id IS NOT NULL)::int AS s_pojistkou,
                   COUNT(*) FILTER (WHERE oi2.id IS NULL)::int AS bez_pojistky,
                   ROUND(100.0*COUNT(*) FILTER (WHERE oi2.id IS NOT NULL)/NULLIF(COUNT(*),0),1)::numeric AS attach_pct,
                   ROUND(COALESCE(SUM(oi2.premium_amount),0)/100.0,2)::numeric AS premie_czk
            FROM orders.orders o
            JOIN catalog.events e ON e.id = o.event_id
            LEFT JOIN orders.order_insurance oi2 ON oi2.order_id = o.id
            WHERE e.promoter_id = $1 AND o.status = 'paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1 LIMIT 2000`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'prodeje_last_minute', title: 'Last-minute prodeje', category: 'prodeje',
    description: 'Objednávky zaplacené méně než 24 hodin před začátkem akce.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'datum_akce', label: 'Datum akce', type: 'date' },
      { key: 'last_minute', label: 'Last-minute obj.', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce, e.date_start::date::text AS datum_akce,
                   COUNT(*)::int AS last_minute,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk
            FROM orders.orders o
            JOIN catalog.events e ON e.id = o.event_id
            WHERE e.promoter_id = $1 AND o.status = 'paid'
              AND o.paid_at BETWEEN (e.date_start - INTERVAL '24 hours') AND e.date_start
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY e.id, e.title, e.date_start ORDER BY last_minute DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'prodeje_refund_rate_dle_dne', title: 'Refund rate dle dne', category: 'prodeje',
    description: 'Denní refund rate — kolik % zaplacených objednávek bylo refundováno.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'den', label: 'Den', type: 'date' },
      { key: 'zaplacene', label: 'Zaplacené', type: 'number' },
      { key: 'refundovane', label: 'Refundované', type: 'number' },
      { key: 'refund_rate', label: 'Refund %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT o.created_at::date::text AS den,
                   COUNT(*) FILTER (WHERE o.status='paid')::int AS zaplacene,
                   COUNT(*) FILTER (WHERE o.status='refunded')::int AS refundovane,
                   ROUND(100.0*COUNT(*) FILTER (WHERE o.status='refunded')
                     /NULLIF(COUNT(*) FILTER (WHERE o.status IN ('paid','refunded')),0),1)::numeric AS refund_rate
            FROM orders.orders o JOIN catalog.events e ON e.id = o.event_id
            WHERE e.promoter_id = $1
              AND o.created_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1 LIMIT 2000`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'prodeje_mom', title: 'Srovnání měsíc/měsíc (MoM)', category: 'prodeje',
    description: 'Porovnání tržeb každého měsíce s předchozím měsícem.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Měsíc', type: 'date' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
      { key: 'predchozi_czk', label: 'Předchozí (Kč)', type: 'currency_czk' },
      { key: 'zmena_pct', label: 'Změna %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `WITH monthly AS (
              SELECT DATE_TRUNC('month', o.paid_at)::date AS mes,
                     ROUND(SUM(o.total_amount)/100.0,2) AS trzby
              FROM orders.orders o JOIN catalog.events e ON e.id = o.event_id
              WHERE e.promoter_id = $1 AND o.status = 'paid'
                AND o.paid_at::date BETWEEN $2 AND $3
              GROUP BY 1
            )
            SELECT mes::text AS mesic, trzby AS trzby_czk,
                   LAG(trzby) OVER (ORDER BY mes) AS predchozi_czk,
                   ROUND(100.0*(trzby - LAG(trzby) OVER (ORDER BY mes))
                     /NULLIF(LAG(trzby) OVER (ORDER BY mes),0),1)::numeric AS zmena_pct
            FROM monthly ORDER BY mes`,
      values: [pid, from(p), to(p)],
    }),
  },
];
