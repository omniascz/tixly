/**
 * Doplňkové reporty — prodeje, finance, zákazníci (2. sada)
 */
import type { ReportDef } from './types';
import { DATE_PARAMS, from, to, BASE_SALES_SQL, SALES_COLS } from './helpers';

export const REPORTS_EXTRA_1: ReportDef[] = [
  // ── PRODEJE extra ──────────────────────────────────────────────────────────
  {
    id: 'prodeje_24h', title: 'Prodeje posledních 24 hodin', category: 'prodeje',
    description: 'Hodinový přehled prodeje za posledních 24 hodin.',
    scope: 'promoter', params: [],
    columns: [
      { key: 'hodina', label: 'Hodina', type: 'datetime' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid) => ({
      sql: `SELECT DATE_TRUNC('hour', o.paid_at)::text AS hodina,
                   COUNT(*)::int AS objednavky,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk
            FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
            WHERE e.promoter_id=$1 AND o.status='paid'
              AND o.paid_at >= NOW() - INTERVAL '24 hours'
            GROUP BY 1 ORDER BY 1`,
      values: [pid],
    }),
  },
  {
    id: 'prodeje_7d', title: 'Prodeje posledních 7 dní', category: 'prodeje',
    description: 'Denní souhrn prodeje za poslední týden.',
    scope: 'promoter', params: [],
    columns: [{ key: 'den', label: 'Den', type: 'date' }, ...SALES_COLS],
    buildQuery: (pid) => ({
      sql: `SELECT o.paid_at::date::text AS den,
                   COUNT(DISTINCT o.id)::int AS objednavky,
                   COALESCE(SUM(oi.quantity),0)::int AS vstupenek,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk,
                   ROUND(AVG(o.total_amount)/100.0,2)::numeric AS prumer_czk
            FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
            LEFT JOIN orders.order_items oi ON oi.order_id=o.id
            WHERE e.promoter_id=$1 AND o.status='paid'
              AND o.paid_at >= NOW() - INTERVAL '7 days'
            GROUP BY 1 ORDER BY 1`,
      values: [pid],
    }),
  },
  {
    id: 'prodeje_seated_vs_general', title: 'Seated vs. General Admission', category: 'prodeje',
    description: 'Porovnání tržeb ze sedaných vs. volných vstupenek.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'typ', label: 'Typ', type: 'badge' },
      { key: 'vstupenek', label: 'Vstupenek', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT CASE WHEN tt.is_seated THEN 'Sedaná místa' ELSE 'Volný vstup' END AS typ,
                   SUM(oi.quantity)::int AS vstupenek,
                   ROUND(SUM(oi.total_price)/100.0,2)::numeric AS trzby_czk
            FROM orders.order_items oi
            JOIN orders.orders o ON o.id=oi.order_id
            JOIN catalog.ticket_types tt ON tt.id=oi.ticket_type_id
            JOIN catalog.events e ON e.id=o.event_id
            WHERE e.promoter_id=$1 AND o.status='paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY trzby_czk DESC`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'prodeje_addony', title: 'Add-on prodeje', category: 'prodeje',
    description: 'Tržby z add-onů (catering, parking, merchandise…).',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'den', label: 'Den', type: 'date' },
      { key: 'addony', label: 'Add-ony', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT o.paid_at::date::text AS den,
                   COUNT(DISTINCT oa.id)::int AS addony,
                   ROUND(SUM(oa.subtotal_halire)/100.0,2)::numeric AS trzby_czk
            FROM public.order_addons oa
            JOIN orders.orders o ON o.id=oa.order_id
            JOIN catalog.events e ON e.id=o.event_id
            WHERE e.promoter_id=$1 AND o.status='paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1 LIMIT 2000`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'prodeje_skupinove', title: 'Skupinové slevy', category: 'prodeje',
    description: 'Objednávky s group discount (3+ vstupenek).',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'skupin', label: 'Skupin', type: 'number' },
      { key: 'vstupenek', label: 'Vstupenek', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce,
                   COUNT(DISTINCT o.id)::int AS skupin,
                   SUM(oi.quantity)::int AS vstupenek,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk
            FROM orders.orders o
            JOIN catalog.events e ON e.id=o.event_id
            JOIN orders.order_items oi ON oi.order_id=o.id
            WHERE e.promoter_id=$1 AND o.status='paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY e.id, e.title HAVING SUM(oi.quantity) >= 3
            ORDER BY vstupenek DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'prodeje_cenova_distribuce', title: 'Distribuce cen vstupenek', category: 'prodeje',
    description: 'Kolik vstupenek bylo prodáno v různých cenových pásmech.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'pasmo', label: 'Cenové pásmo', type: 'text' },
      { key: 'vstupenek', label: 'Vstupenek', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT CASE
                WHEN oi.unit_price < 20000 THEN '0–200 Kč'
                WHEN oi.unit_price < 50000 THEN '200–500 Kč'
                WHEN oi.unit_price < 100000 THEN '500–1 000 Kč'
                WHEN oi.unit_price < 200000 THEN '1 000–2 000 Kč'
                ELSE '2 000 Kč+'
              END AS pasmo,
              SUM(oi.quantity)::int AS vstupenek,
              ROUND(SUM(oi.total_price)/100.0,2)::numeric AS trzby_czk
            FROM orders.order_items oi
            JOIN orders.orders o ON o.id=oi.order_id
            JOIN catalog.events e ON e.id=o.event_id
            WHERE e.promoter_id=$1 AND o.status='paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY MIN(oi.unit_price)`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'prodeje_first_day', title: 'First-day prodeje po akci', category: 'prodeje',
    description: 'Prodeje v první den po vyhlášení akce (spike prodeje).',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'prvni_prodej', label: 'První prodej', type: 'date' },
      { key: 'prvni_den_trzby', label: '1. den (Kč)', type: 'currency_czk' },
      { key: 'celkem_trzby', label: 'Celkem (Kč)', type: 'currency_czk' },
      { key: 'first_day_pct', label: '1. den %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `WITH first_sales AS (
              SELECT o.event_id, MIN(o.paid_at::date) AS prvni_den
              FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
              WHERE e.promoter_id=$1 AND o.status='paid' GROUP BY o.event_id
            )
            SELECT e.title AS akce, fs.prvni_den::text AS prvni_prodej,
                   ROUND(SUM(o.total_amount) FILTER (WHERE o.paid_at::date=fs.prvni_den)/100.0,2)::numeric AS prvni_den_trzby,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS celkem_trzby,
                   ROUND(100.0*SUM(o.total_amount) FILTER (WHERE o.paid_at::date=fs.prvni_den)
                     /NULLIF(SUM(o.total_amount),0),1)::numeric AS first_day_pct
            FROM orders.orders o
            JOIN catalog.events e ON e.id=o.event_id
            JOIN first_sales fs ON fs.event_id=o.event_id
            WHERE e.promoter_id=$1 AND o.status='paid'
              AND e.date_start::date BETWEEN $2 AND $3
            GROUP BY e.id, e.title, fs.prvni_den ORDER BY first_day_pct DESC LIMIT 50`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'prodeje_dle_venue', title: 'Prodeje dle místa konání', category: 'prodeje',
    description: 'Tržby agregované dle venue.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'venue', label: 'Místo', type: 'text' },
      { key: 'akci', label: 'Akcí', type: 'number' },
      ...SALES_COLS,
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT COALESCE(v.name, 'Online') AS venue,
                   COUNT(DISTINCT e.id)::int AS akci,
                   COUNT(DISTINCT o.id)::int AS objednavky,
                   COALESCE(SUM(oi.quantity),0)::int AS vstupenek,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk,
                   ROUND(AVG(o.total_amount)/100.0,2)::numeric AS prumer_czk
            FROM orders.orders o
            JOIN catalog.events e ON e.id=o.event_id
            LEFT JOIN catalog.venues v ON v.id=e.venue_id
            LEFT JOIN orders.order_items oi ON oi.order_id=o.id
            WHERE e.promoter_id=$1 AND o.status='paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY trzby_czk DESC LIMIT 50`,
      values: [pid, from(p), to(p)],
    }),
  },
  // ── FINANCE extra ───────────────────────────────────────────────────────────
  {
    id: 'finance_b2b_kredit', title: 'B2B kredit transakce', category: 'finance',
    description: 'Použití B2B kreditního účtu na objednávky.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'firma', label: 'Firma', type: 'text' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
      { key: 'kredit_czk', label: 'Kredit (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT bc.company_name AS firma,
                   COUNT(DISTINCT o.id)::int AS objednavky,
                   ROUND(SUM(bt.amount_halire)/100.0,2)::numeric AS kredit_czk
            FROM platform.b2b_credit_transactions bt
            JOIN orders.orders o ON o.id=bt.order_id
            JOIN platform.b2b_credit_accounts bc ON bc.id=bt.account_id
            JOIN catalog.events e ON e.id=o.event_id
            WHERE e.promoter_id=$1
              AND bt.created_at::date BETWEEN $2 AND $3
            GROUP BY bc.id, bc.company_name ORDER BY kredit_czk DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'finance_addony_trzby', title: 'Add-on tržby dle měsíce', category: 'finance',
    description: 'Měsíční vývoj tržeb z add-onů.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Měsíc', type: 'date' },
      { key: 'addony', label: 'Add-ony', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT DATE_TRUNC('month', o.paid_at)::date::text AS mesic,
                   COUNT(DISTINCT oa.id)::int AS addony,
                   ROUND(SUM(oa.subtotal_halire)/100.0,2)::numeric AS trzby_czk
            FROM public.order_addons oa
            JOIN orders.orders o ON o.id=oa.order_id
            JOIN catalog.events e ON e.id=o.event_id
            WHERE e.promoter_id=$1 AND o.status='paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1 LIMIT 36`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'finance_voucher_redemption', title: 'Gift voucher redemption', category: 'finance',
    description: 'Uplatněné dárkové poukazy za zvolené období.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'den', label: 'Den', type: 'date' },
      { key: 'uplatneno', label: 'Uplatněno', type: 'number' },
      { key: 'hodnota_czk', label: 'Hodnota (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT o.paid_at::date::text AS den,
                   COUNT(DISTINCT o.id)::int AS uplatneno,
                   ROUND(SUM(o.discount_halire)/100.0,2)::numeric AS hodnota_czk
            FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
            WHERE e.promoter_id=$1 AND o.status='paid'
              AND o.voucher_code IS NOT NULL
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1 LIMIT 2000`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'finance_bundles', title: 'Bundle tržby', category: 'finance',
    description: 'Příjmy z bundle balíčků vstupenek.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Měsíc', type: 'date' },
      { key: 'bundles', label: 'Bundlů', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT DATE_TRUNC('month', o.paid_at)::date::text AS mesic,
                   COUNT(DISTINCT o.id)::int AS bundles,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk
            ${BASE_SALES_SQL}
              AND o.is_bundle = true
            GROUP BY 1 ORDER BY 1 LIMIT 36`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'finance_avg_order_trend', title: 'AOV trend (finance)', category: 'finance',
    description: 'Jak se mění průměrná výše objednávky každý měsíc.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Měsíc', type: 'date' },
      { key: 'aov_czk', label: 'AOV (Kč)', type: 'currency_czk' },
      { key: 'zmena_pct', label: 'Změna %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `WITH m AS (
              SELECT DATE_TRUNC('month', o.paid_at)::date AS mes,
                     ROUND(AVG(o.total_amount)/100.0,2) AS aov
              FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
              WHERE e.promoter_id=$1 AND o.status='paid'
                AND o.paid_at::date BETWEEN $2 AND $3
              GROUP BY 1
            )
            SELECT mes::text AS mesic, aov AS aov_czk,
                   ROUND(100.0*(aov-LAG(aov) OVER (ORDER BY mes))
                     /NULLIF(LAG(aov) OVER (ORDER BY mes),0),1)::numeric AS zmena_pct
            FROM m ORDER BY mes`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'finance_expiry_orders', title: 'Expirované objednávky', category: 'finance',
    description: 'Objednávky, které zanikly bez zaplacení — ztracený potenciál.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Měsíc', type: 'date' },
      { key: 'expiry', label: 'Expirované', type: 'number' },
      { key: 'ztraceno_czk', label: 'Ztraceno (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT DATE_TRUNC('month', o.created_at)::date::text AS mesic,
                   COUNT(*)::int AS expiry,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS ztraceno_czk
            FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
            WHERE e.promoter_id=$1 AND o.status='cancelled'
              AND o.created_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1 LIMIT 36`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'finance_partial_payments', title: 'Částečné platby (Party Pay)', category: 'finance',
    description: 'Skupinové platby — kolik bylo dokončeno vs. nedokončeno.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Měsíc', type: 'date' },
      { key: 'sessions', label: 'Sessions', type: 'number' },
      { key: 'dokoncene', label: 'Dokončené', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT DATE_TRUNC('month', pss.created_at)::date::text AS mesic,
                   COUNT(*)::int AS sessions,
                   COUNT(*) FILTER (WHERE pss.status='complete')::int AS dokoncene,
                   ROUND(SUM(pss.per_slot_amount*pss.total_slots) FILTER (WHERE pss.status='complete')/100.0,2)::numeric AS trzby_czk
            FROM orders.party_split_sessions pss
            JOIN catalog.events e ON e.id=pss.event_id
            WHERE e.promoter_id=$1
              AND pss.created_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1 LIMIT 36`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'finance_prognoza_mesic', title: 'Prognóza — příští měsíc', category: 'finance',
    description: 'Odhadované tržby příštího měsíce na základě průměru posledních 3 měsíců.',
    scope: 'promoter', params: [],
    columns: [
      { key: 'mesic', label: 'Měsíc', type: 'date' },
      { key: 'avg_3m_czk', label: 'Průměr 3M (Kč)', type: 'currency_czk' },
      { key: 'prognoza_czk', label: 'Prognóza (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid) => ({
      sql: `WITH recent AS (
              SELECT ROUND(SUM(o.total_amount)/100.0/3,2) AS avg3m
              FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
              WHERE e.promoter_id=$1 AND o.status='paid'
                AND o.paid_at >= NOW() - INTERVAL '90 days'
            )
            SELECT DATE_TRUNC('month', NOW() + INTERVAL '1 month')::date::text AS mesic,
                   avg3m AS avg_3m_czk,
                   avg3m AS prognoza_czk
            FROM recent`,
      values: [pid],
    }),
  },
  {
    id: 'finance_loyalty_vydano', title: 'Loyalty body — vydané (finance)', category: 'finance',
    description: 'Peněžní hodnota vydaných loyalty bodů za měsíc.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Měsíc', type: 'date' },
      { key: 'body', label: 'Body', type: 'number' },
      { key: 'hodnota_czk', label: 'Hodnota (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT DATE_TRUNC('month', lt.created_at)::date::text AS mesic,
                   SUM(lt.points)::int AS body,
                   ROUND(SUM(lt.points)*lt.point_value_halire/100.0,2)::numeric AS hodnota_czk
            FROM marketing.loyalty_transactions lt
            JOIN orders.orders o ON o.id=lt.order_id
            JOIN catalog.events e ON e.id=o.event_id
            WHERE e.promoter_id=$1 AND lt.type='earn'
              AND lt.created_at::date BETWEEN $2 AND $3
            GROUP BY 1, lt.point_value_halire ORDER BY 1 LIMIT 36`,
      values: [pid, from(p), to(p)],
    }),
  },
  // ── ZÁKAZNÍCI extra ────────────────────────────────────────────────────────
  {
    id: 'zakaznici_gift_sender', title: 'Dárci vstupenek', category: 'zakaznici',
    description: 'Zákazníci, kteří nakoupili vstupenku jako dárek (is_gift).',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'email', label: 'Dárce', type: 'text' },
      { key: 'darky', label: 'Darů', type: 'number' },
      { key: 'hodnota_czk', label: 'Celková hodnota (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT u.email, COUNT(DISTINCT o.id)::int AS darky,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS hodnota_czk
            FROM orders.orders o
            JOIN catalog.events e ON e.id=o.event_id
            JOIN identity.users u ON u.id=o.user_id
            WHERE e.promoter_id=$1 AND o.status='paid' AND o.is_gift=true
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY u.id, u.email ORDER BY darky DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'zakaznici_newsletter', title: 'Newsletter opt-in', category: 'zakaznici',
    description: 'Podíl zákazníků, kteří souhlasili s newsletterem.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Měsíc', type: 'date' },
      { key: 'celkem', label: 'Zákazníků', type: 'number' },
      { key: 'opt_in', label: 'Newsletter opt-in', type: 'number' },
      { key: 'opt_in_pct', label: 'Opt-in %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT DATE_TRUNC('month', o.paid_at)::date::text AS mesic,
                   COUNT(DISTINCT u.id)::int AS celkem,
                   COUNT(DISTINCT u.id) FILTER (WHERE u.marketing_opt_in=true)::int AS opt_in,
                   ROUND(100.0*COUNT(DISTINCT u.id) FILTER (WHERE u.marketing_opt_in=true)
                     /NULLIF(COUNT(DISTINCT u.id),0),1)::numeric AS opt_in_pct
            FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
            JOIN identity.users u ON u.id=o.user_id
            WHERE e.promoter_id=$1 AND o.status='paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1 LIMIT 36`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'zakaznici_b2b', title: 'B2B zákazníci', category: 'zakaznici',
    description: 'Firmy nakupující přes B2B kredit účty.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'firma', label: 'Firma', type: 'text' },
      { key: 'kontakt', label: 'Kontakt', type: 'text' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
      { key: 'utrata_czk', label: 'Útrata (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT bc.company_name AS firma, u.email AS kontakt,
                   COUNT(DISTINCT o.id)::int AS objednavky,
                   ROUND(SUM(bt.amount_halire)/100.0,2)::numeric AS utrata_czk
            FROM platform.b2b_credit_accounts bc
            JOIN platform.b2b_credit_transactions bt ON bt.account_id=bc.id
            JOIN orders.orders o ON o.id=bt.order_id
            JOIN catalog.events e ON e.id=o.event_id
            JOIN identity.users u ON u.id=bc.owner_user_id
            WHERE e.promoter_id=$1
              AND bt.created_at::date BETWEEN $2 AND $3
            GROUP BY bc.id, bc.company_name, u.email ORDER BY utrata_czk DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'zakaznici_loyalty', title: 'Loyalty zákazníci', category: 'zakaznici',
    description: 'Zákazníci s nejvíce loyalty body.',
    scope: 'promoter', params: [],
    columns: [
      { key: 'email', label: 'E-mail', type: 'text' },
      { key: 'body', label: 'Body celkem', type: 'number' },
      { key: 'aktivita', label: 'Posl. aktivita', type: 'date' },
    ],
    buildQuery: (pid) => ({
      sql: `SELECT u.email,
                   SUM(CASE WHEN lt.type='earn' THEN lt.points ELSE -lt.points END)::int AS body,
                   MAX(lt.created_at)::date::text AS aktivita
            FROM marketing.loyalty_transactions lt
            JOIN orders.orders o ON o.id=lt.order_id
            JOIN catalog.events e ON e.id=o.event_id
            JOIN identity.users u ON u.id=o.user_id
            WHERE e.promoter_id=$1
            GROUP BY u.id, u.email
            HAVING SUM(CASE WHEN lt.type='earn' THEN lt.points ELSE -lt.points END) > 0
            ORDER BY body DESC LIMIT 200`,
      values: [pid],
    }),
  },
  {
    id: 'zakaznici_phone_verify', title: 'Phone verification rate', category: 'zakaznici',
    description: 'Jaký podíl zákazníků má ověřené telefonní číslo.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Měsíc', type: 'date' },
      { key: 'zakaznici', label: 'Zákazníků', type: 'number' },
      { key: 'overeno', label: 'Ověřeno tel.', type: 'number' },
      { key: 'pct', label: 'Ověřeno %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT DATE_TRUNC('month', o.paid_at)::date::text AS mesic,
                   COUNT(DISTINCT u.id)::int AS zakaznici,
                   COUNT(DISTINCT u.id) FILTER (WHERE u.phone_verified=true)::int AS overeno,
                   ROUND(100.0*COUNT(DISTINCT u.id) FILTER (WHERE u.phone_verified=true)
                     /NULLIF(COUNT(DISTINCT u.id),0),1)::numeric AS pct
            FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
            JOIN identity.users u ON u.id=o.user_id
            WHERE e.promoter_id=$1 AND o.status='paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1 LIMIT 36`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'zakaznici_retence_90d', title: 'Retence 90-denní', category: 'zakaznici',
    description: 'Kolik % zákazníků nakoupilo znovu do 90 dní od první koupě.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Kohorta', type: 'date' },
      { key: 'novi', label: 'Noví', type: 'number' },
      { key: 'retence_90d', label: 'Vrátili se do 90d', type: 'number' },
      { key: 'pct', label: 'Retence %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `WITH first_buy AS (
              SELECT user_id, MIN(paid_at) AS prvni
              FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
              WHERE e.promoter_id=$1 AND o.status='paid' GROUP BY user_id
            )
            SELECT DATE_TRUNC('month', fb.prvni)::date::text AS mesic,
                   COUNT(DISTINCT fb.user_id)::int AS novi,
                   COUNT(DISTINCT o2.user_id)::int AS retence_90d,
                   ROUND(100.0*COUNT(DISTINCT o2.user_id)/NULLIF(COUNT(DISTINCT fb.user_id),0),1)::numeric AS pct
            FROM first_buy fb
            LEFT JOIN orders.orders o2 ON o2.user_id=fb.user_id
              AND o2.status='paid' AND o2.paid_at > fb.prvni AND o2.paid_at <= fb.prvni + INTERVAL '90 days'
            WHERE fb.prvni::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1 LIMIT 36`,
      values: [pid, from(p), to(p)],
    }),
  },
  // VYRAZENO (R-35): chybi tabulka marketing.verified_fan_registrations. Definice zustava — SQL bude platit,
  // az tabulka vznikne. Viz DISABLED_REPORTS v registry.ts.
  {
    id: 'zakaznici_verified_fan', title: 'Verified Fan přehled', category: 'zakaznici',
    description: 'Zákazníci schváleni přes Verified Fan program.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'prihlasenych', label: 'Přihlášených', type: 'number' },
      { key: 'schvalenych', label: 'Schválených', type: 'number' },
      { key: 'nakoupilo', label: 'Nakoupilo', type: 'number' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce,
                   COUNT(DISTINCT vf.user_id)::int AS prihlasenych,
                   COUNT(DISTINCT vf.user_id) FILTER (WHERE vf.status='approved')::int AS schvalenych,
                   COUNT(DISTINCT o.user_id) FILTER (WHERE o.status='paid')::int AS nakoupilo
            FROM marketing.verified_fan_registrations vf
            JOIN catalog.events e ON e.id=vf.event_id
            LEFT JOIN orders.orders o ON o.event_id=e.id AND o.user_id=vf.user_id
            WHERE e.promoter_id=$1
              AND vf.created_at::date BETWEEN $2 AND $3
            GROUP BY e.id, e.title ORDER BY prihlasenych DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'zakaznici_waitlist_konverze', title: 'Waitlist konverze', category: 'zakaznici',
    description: 'Kolik % zákazníků z čekacích listin nakonec koupilo.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'waitlist', label: 'Na waitlistu', type: 'number' },
      { key: 'nakoupilo', label: 'Nakoupilo', type: 'number' },
      { key: 'konverze', label: 'Konverze %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce,
                   COUNT(DISTINCT wl.user_id)::int AS waitlist,
                   COUNT(DISTINCT o.user_id) FILTER (WHERE o.status='paid')::int AS nakoupilo,
                   ROUND(100.0*COUNT(DISTINCT o.user_id) FILTER (WHERE o.status='paid')
                     /NULLIF(COUNT(DISTINCT wl.user_id),0),1)::numeric AS konverze
            FROM orders.waiting_list wl
            JOIN catalog.events e ON e.id=wl.event_id
            LEFT JOIN orders.orders o ON o.event_id=e.id AND o.user_id=wl.user_id
            WHERE e.promoter_id=$1
              AND wl.created_at::date BETWEEN $2 AND $3
            GROUP BY e.id, e.title HAVING COUNT(DISTINCT wl.user_id) > 0
            ORDER BY waitlist DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
];
