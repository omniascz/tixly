import type { ReportDef } from './types';
import { DATE_PARAMS, from, to, BASE_SALES_SQL } from './helpers';

export const REPORTS_SROVNANI: ReportDef[] = [
  {
    id: 'srov_yoy_revenue', title: 'Revenue YoY dle měsíce', category: 'srovnani',
    description: 'Tržby po měsících — letos vs. loni pro přehledné srovnání.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Měsíc', type: 'text' },
      { key: 'letos_czk', label: 'Letos (Kč)', type: 'currency_czk' },
      { key: 'loni_czk', label: 'Loni (Kč)', type: 'currency_czk' },
      { key: 'zmena_pct', label: 'Změna %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `WITH data AS (
              SELECT EXTRACT(YEAR FROM o.paid_at)::int AS rok,
                     EXTRACT(MONTH FROM o.paid_at)::int AS mes,
                     ROUND(SUM(o.total_amount)/100.0,2) AS trzby
              FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
              WHERE e.promoter_id=$1 AND o.status='paid'
                AND o.paid_at >= ($2::date - INTERVAL '1 year')
                AND o.paid_at::date <= $3
              GROUP BY 1,2
            ), years AS (SELECT EXTRACT(YEAR FROM $3::date)::int AS y)
            SELECT TO_CHAR(MAKE_DATE(2000,mes,1),'TMMonth') AS mesic,
                   COALESCE(MAX(trzby) FILTER (WHERE rok=(SELECT y FROM years)),0) AS letos_czk,
                   COALESCE(MAX(trzby) FILTER (WHERE rok=(SELECT y FROM years)-1),0) AS loni_czk,
                   ROUND(100.0*(COALESCE(MAX(trzby) FILTER (WHERE rok=(SELECT y FROM years)),0)
                     -COALESCE(MAX(trzby) FILTER (WHERE rok=(SELECT y FROM years)-1),0))
                     /NULLIF(MAX(trzby) FILTER (WHERE rok=(SELECT y FROM years)-1),0),1)::numeric AS zmena_pct
            FROM data GROUP BY mes ORDER BY mes`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'srov_mom_revenue', title: 'Revenue MoM trend', category: 'srovnani',
    description: 'Tržby každý měsíc s meziměsíčním % rozdílem.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Měsíc', type: 'date' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
      { key: 'zmena_pct', label: 'MoM %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `WITH m AS (
              SELECT DATE_TRUNC('month', o.paid_at)::date AS mes,
                     ROUND(SUM(o.total_amount)/100.0,2) AS trzby
              FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
              WHERE e.promoter_id=$1 AND o.status='paid'
                AND o.paid_at::date BETWEEN $2 AND $3
              GROUP BY 1
            )
            SELECT mes::text AS mesic, trzby AS trzby_czk,
                   ROUND(100.0*(trzby - LAG(trzby) OVER (ORDER BY mes))
                     /NULLIF(LAG(trzby) OVER (ORDER BY mes),0),1)::numeric AS zmena_pct
            FROM m ORDER BY mes`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'srov_wow_revenue', title: 'Revenue WoW trend', category: 'srovnani',
    description: 'Tržby každý týden s meziýdenním % rozdílem.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'tyden', label: 'Týden', type: 'date' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
      { key: 'zmena_pct', label: 'WoW %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `WITH w AS (
              SELECT DATE_TRUNC('week', o.paid_at)::date AS tyden,
                     ROUND(SUM(o.total_amount)/100.0,2) AS trzby
              FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
              WHERE e.promoter_id=$1 AND o.status='paid'
                AND o.paid_at::date BETWEEN $2 AND $3
              GROUP BY 1
            )
            SELECT tyden::text, trzby AS trzby_czk,
                   ROUND(100.0*(trzby-LAG(trzby) OVER (ORDER BY tyden))
                     /NULLIF(LAG(trzby) OVER (ORDER BY tyden),0),1)::numeric AS zmena_pct
            FROM w ORDER BY tyden LIMIT 104`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'srov_dny_tydne', title: 'Srovnání dní v týdnu', category: 'srovnani',
    description: 'Průměrné tržby na jednotlivé dny v týdnu.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'den', label: 'Den', type: 'text' },
      { key: 'avg_trzby_czk', label: 'Průměrné tržby (Kč)', type: 'currency_czk' },
      { key: 'celkem_czk', label: 'Celkem (Kč)', type: 'currency_czk' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT TO_CHAR(o.paid_at AT TIME ZONE 'Europe/Prague', 'ID - Day') AS den,
                   ROUND(AVG(daily.trzby),2)::numeric AS avg_trzby_czk,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS celkem_czk,
                   COUNT(*)::int AS objednavky
            FROM orders.orders o
            JOIN catalog.events e ON e.id=o.event_id
            JOIN LATERAL (
              SELECT SUM(o2.total_amount)/100.0 AS trzby
              FROM orders.orders o2 JOIN catalog.events e2 ON e2.id=o2.event_id
              WHERE e2.promoter_id=$1 AND o2.status='paid'
                AND o2.paid_at::date = o.paid_at::date
            ) daily ON true
            WHERE e.promoter_id=$1 AND o.status='paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'srov_hodiny_dne', title: 'Srovnání hodin dne', category: 'srovnani',
    description: 'Průměrné tržby a objednávky dle hodiny.',
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
            GROUP BY 1 ORDER BY 1`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'srov_fill_rate_trend', title: 'Fill rate trend', category: 'srovnani',
    description: 'Průměrný fill rate dle měsíce konání akce.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Měsíc', type: 'date' },
      { key: 'akci', label: 'Akcí', type: 'number' },
      { key: 'avg_fill_rate', label: 'Průměrný fill %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT DATE_TRUNC('month', e.date_start)::date::text AS mesic,
                   COUNT(DISTINCT e.id)::int AS akci,
                   ROUND(AVG(
                     CASE WHEN SUM(tt.total_qty) > 0
                       THEN 100.0*SUM(tt.total_qty-tt.remaining_qty)/SUM(tt.total_qty)
                       ELSE 0 END
                   ),1)::numeric AS avg_fill_rate
            FROM catalog.events e
            LEFT JOIN catalog.ticket_types tt ON tt.event_id = e.id
            WHERE e.promoter_id=$1
              AND e.date_start::date BETWEEN $2 AND $3
              AND e.status != 'draft'
            GROUP BY e.id, e.date_start, tt.event_id
            -- outer aggregation
            `,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'srov_avg_order_trend', title: 'AOV trend (průměrná objednávka)', category: 'srovnani',
    description: 'Jak se vyvíjí průměrná hodnota objednávky v čase.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Měsíc', type: 'date' },
      { key: 'aov_czk', label: 'AOV (Kč)', type: 'currency_czk' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT DATE_TRUNC('month', o.paid_at)::date::text AS mesic,
                   ROUND(AVG(o.total_amount)/100.0,2)::numeric AS aov_czk,
                   COUNT(*)::int AS objednavky
            ${BASE_SALES_SQL}
            GROUP BY 1 ORDER BY 1 LIMIT 36`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'srov_refund_trend', title: 'Refund rate trend', category: 'srovnani',
    description: 'Vývoj refund rate po měsících.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Měsíc', type: 'date' },
      { key: 'zaplacene', label: 'Zaplacené', type: 'number' },
      { key: 'refundovane', label: 'Refundované', type: 'number' },
      { key: 'refund_rate', label: 'Refund %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT DATE_TRUNC('month', o.created_at)::date::text AS mesic,
                   COUNT(*) FILTER (WHERE o.status='paid')::int AS zaplacene,
                   COUNT(*) FILTER (WHERE o.status='refunded')::int AS refundovane,
                   ROUND(100.0*COUNT(*) FILTER (WHERE o.status='refunded')
                     /NULLIF(COUNT(*) FILTER (WHERE o.status IN ('paid','refunded')),0),1)::numeric AS refund_rate
            FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
            WHERE e.promoter_id=$1
              AND o.created_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1 LIMIT 36`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'srov_new_vs_returning', title: 'Noví vs. vracející zákazníci', category: 'srovnani',
    description: 'Poměr nových a vracejících se zákazníků dle měsíce.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Měsíc', type: 'date' },
      { key: 'novi', label: 'Noví', type: 'number' },
      { key: 'vracejici', label: 'Vracející', type: 'number' },
      { key: 'novi_pct', label: 'Noví %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `WITH first_buy AS (
              SELECT user_id, MIN(paid_at) AS prvni
              FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
              WHERE e.promoter_id=$1 AND o.status='paid' GROUP BY user_id
            )
            SELECT DATE_TRUNC('month', o.paid_at)::date::text AS mesic,
                   COUNT(DISTINCT o.user_id) FILTER (WHERE o.paid_at = fb.prvni)::int AS novi,
                   COUNT(DISTINCT o.user_id) FILTER (WHERE o.paid_at != fb.prvni)::int AS vracejici,
                   ROUND(100.0*COUNT(DISTINCT o.user_id) FILTER (WHERE o.paid_at = fb.prvni)
                     /NULLIF(COUNT(DISTINCT o.user_id),0),1)::numeric AS novi_pct
            FROM orders.orders o
            JOIN catalog.events e ON e.id=o.event_id
            JOIN first_buy fb ON fb.user_id=o.user_id
            WHERE e.promoter_id=$1 AND o.status='paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1 LIMIT 36`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'srov_platebni_metody', title: 'Platební metody — trend', category: 'srovnani',
    description: 'Jak se mění podíl platebních metod v čase.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Měsíc', type: 'date' },
      { key: 'metoda', label: 'Metoda', type: 'badge' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
      { key: 'podil_pct', label: 'Podíl %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `WITH monthly AS (
              SELECT DATE_TRUNC('month', o.paid_at)::date AS mes,
                     COALESCE(o.payment_provider,'neznámo') AS metoda,
                     COUNT(*)::int AS obj
              FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
              WHERE e.promoter_id=$1 AND o.status='paid'
                AND o.paid_at::date BETWEEN $2 AND $3
              GROUP BY 1,2
            ), totals AS (
              SELECT mes, SUM(obj) AS total FROM monthly GROUP BY mes
            )
            SELECT m.mes::text AS mesic, m.metoda,
                   m.obj AS objednavky,
                   ROUND(100.0*m.obj/NULLIF(t.total,0),1)::numeric AS podil_pct
            FROM monthly m JOIN totals t ON t.mes=m.mes
            ORDER BY m.mes, m.obj DESC LIMIT 500`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'srov_sezonnost_q', title: 'Sezónnost dle čtvrtletí', category: 'srovnani',
    description: 'Tržby dle čtvrtletí — identifikace sezónních špiček.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'rok', label: 'Rok', type: 'text' },
      { key: 'q1_czk', label: 'Q1 (Kč)', type: 'currency_czk' },
      { key: 'q2_czk', label: 'Q2 (Kč)', type: 'currency_czk' },
      { key: 'q3_czk', label: 'Q3 (Kč)', type: 'currency_czk' },
      { key: 'q4_czk', label: 'Q4 (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT EXTRACT(YEAR FROM o.paid_at)::text AS rok,
                   ROUND(SUM(o.total_amount) FILTER (WHERE EXTRACT(QUARTER FROM o.paid_at)=1)/100.0,2)::numeric AS q1_czk,
                   ROUND(SUM(o.total_amount) FILTER (WHERE EXTRACT(QUARTER FROM o.paid_at)=2)/100.0,2)::numeric AS q2_czk,
                   ROUND(SUM(o.total_amount) FILTER (WHERE EXTRACT(QUARTER FROM o.paid_at)=3)/100.0,2)::numeric AS q3_czk,
                   ROUND(SUM(o.total_amount) FILTER (WHERE EXTRACT(QUARTER FROM o.paid_at)=4)/100.0,2)::numeric AS q4_czk
            ${BASE_SALES_SQL}
            GROUP BY 1 ORDER BY 1`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'srov_typy_vstupenek', title: 'Srovnání typů vstupenek', category: 'srovnani',
    description: 'Trendová data prodeje dle typů vstupenek po měsících.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Měsíc', type: 'date' },
      { key: 'typ', label: 'Typ vstupenky', type: 'text' },
      { key: 'vstupenek', label: 'Vstupenek', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT DATE_TRUNC('month', o.paid_at)::date::text AS mesic,
                   tt.name AS typ,
                   SUM(oi.quantity)::int AS vstupenek,
                   ROUND(SUM(oi.total_price)/100.0,2)::numeric AS trzby_czk
            FROM orders.order_items oi
            JOIN orders.orders o ON o.id=oi.order_id
            JOIN catalog.ticket_types tt ON tt.id=oi.ticket_type_id
            JOIN catalog.events e ON e.id=o.event_id
            WHERE e.promoter_id=$1 AND o.status='paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY 1,2 ORDER BY 1, trzby_czk DESC LIMIT 500`,
      values: [pid, from(p), to(p)],
    }),
  },
];
