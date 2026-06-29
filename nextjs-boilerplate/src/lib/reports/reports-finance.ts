import type { ReportDef } from './types';
import { DATE_PARAMS, from, to, BASE_SALES_SQL } from './helpers';

export const REPORTS_FINANCE: ReportDef[] = [
  {
    id: 'finance_trzby_period', title: 'Celkové tržby za období', category: 'finance',
    description: 'Součet hrubých tržeb, refundů a čistých tržeb za zvolené období.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'hrube_czk', label: 'Hrubé tržby (Kč)', type: 'currency_czk' },
      { key: 'refundy_czk', label: 'Refundy (Kč)', type: 'currency_czk' },
      { key: 'ciste_czk', label: 'Čisté tržby (Kč)', type: 'currency_czk' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT
              ROUND(COALESCE(SUM(o.total_amount) FILTER (WHERE o.status='paid'),0)/100.0,2)::numeric AS hrube_czk,
              ROUND(COALESCE(SUM(o.total_amount) FILTER (WHERE o.status='refunded'),0)/100.0,2)::numeric AS refundy_czk,
              ROUND((COALESCE(SUM(o.total_amount) FILTER (WHERE o.status='paid'),0)
                   - COALESCE(SUM(o.total_amount) FILTER (WHERE o.status='refunded'),0))/100.0,2)::numeric AS ciste_czk,
              COUNT(*) FILTER (WHERE o.status='paid')::int AS objednavky
            FROM orders.orders o JOIN catalog.events e ON e.id = o.event_id
            WHERE e.promoter_id = $1
              AND o.paid_at::date BETWEEN $2 AND $3`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'finance_refundy_prehled', title: 'Přehled refundů', category: 'finance',
    description: 'Denní počet a výše refundů.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'den', label: 'Den', type: 'date' },
      { key: 'pocet', label: 'Počet', type: 'number' },
      { key: 'castka_czk', label: 'Částka (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT o.updated_at::date::text AS den,
                   COUNT(*)::int AS pocet,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS castka_czk
            FROM orders.orders o JOIN catalog.events e ON e.id = o.event_id
            WHERE e.promoter_id = $1 AND o.status = 'refunded'
              AND o.updated_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1 LIMIT 2000`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'finance_refundy_dle_akce', title: 'Refundy dle akce', category: 'finance',
    description: 'Akce s nejvíce refundacemi.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'refundy', label: 'Refundy', type: 'number' },
      { key: 'castka_czk', label: 'Částka (Kč)', type: 'currency_czk' },
      { key: 'refund_rate', label: 'Refund %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT e.title AS akce,
                   COUNT(*) FILTER (WHERE o.status='refunded')::int AS refundy,
                   ROUND(SUM(o.total_amount) FILTER (WHERE o.status='refunded')/100.0,2)::numeric AS castka_czk,
                   ROUND(100.0*COUNT(*) FILTER (WHERE o.status='refunded')
                     /NULLIF(COUNT(*) FILTER (WHERE o.status IN ('paid','refunded')),0),1)::numeric AS refund_rate
            FROM orders.orders o JOIN catalog.events e ON e.id = o.event_id
            WHERE e.promoter_id = $1
              AND o.created_at::date BETWEEN $2 AND $3
            GROUP BY e.id, e.title ORDER BY refundy DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'finance_platba_metody', title: 'Tržby dle platební metody', category: 'finance',
    description: 'Objem a podíl každé platební brány za zvolené období.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'metoda', label: 'Metoda', type: 'badge' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
      { key: 'podil_pct', label: 'Podíl %', type: 'pct' },
    ],
    buildQuery: (pid, p) => ({
      sql: `WITH totals AS (SELECT SUM(total_amount) AS celkem FROM orders.orders o
              JOIN catalog.events e ON e.id=o.event_id
              WHERE e.promoter_id=$1 AND o.status='paid'
              AND o.paid_at::date BETWEEN $2 AND $3)
            SELECT COALESCE(o.payment_provider,'neznámo') AS metoda,
                   COUNT(*)::int AS objednavky,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk,
                   ROUND(100.0*SUM(o.total_amount)/NULLIF((SELECT celkem FROM totals),0),1)::numeric AS podil_pct
            FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
            WHERE e.promoter_id=$1 AND o.status='paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY trzby_czk DESC`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'finance_avg_order', title: 'Průměrná hodnota objednávky', category: 'finance',
    description: 'Průměrná výše objednávky (AOV) dle dne.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'den', label: 'Den', type: 'date' },
      { key: 'aov_czk', label: 'AOV (Kč)', type: 'currency_czk' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT o.paid_at::date::text AS den,
                   ROUND(AVG(o.total_amount)/100.0,2)::numeric AS aov_czk,
                   COUNT(*)::int AS objednavky
            ${BASE_SALES_SQL}
            GROUP BY 1 ORDER BY 1 LIMIT 2000`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'finance_sleva_rozpad', title: 'Rozpad slev', category: 'finance',
    description: 'Celková výše slev poskytnutých přes promo kódy.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'den', label: 'Den', type: 'date' },
      { key: 'slevy_czk', label: 'Slevy celkem (Kč)', type: 'currency_czk' },
      { key: 'objednavky', label: 'Obj. se slevou', type: 'number' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT o.paid_at::date::text AS den,
                   ROUND(SUM(o.discount_halire)/100.0,2)::numeric AS slevy_czk,
                   COUNT(*)::int AS objednavky
            ${BASE_SALES_SQL}
              AND o.discount_halire > 0
            GROUP BY 1 ORDER BY 1 LIMIT 2000`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'finance_dpH', title: 'DPH výkaz', category: 'finance',
    description: 'Základ daně a DPH po sazbách za zvolené období.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'sazba', label: 'DPH sazba', type: 'text' },
      { key: 'zaklad_czk', label: 'Základ (Kč)', type: 'currency_czk' },
      { key: 'dpH_czk', label: 'DPH (Kč)', type: 'currency_czk' },
      { key: 'celkem_czk', label: 'Celkem (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT pr.vat_rate_pct::text || ' %' AS sazba,
                   ROUND(SUM(o.total_amount) / (1 + pr.vat_rate_pct/100.0) / 100.0, 2)::numeric AS zaklad_czk,
                   ROUND(SUM(o.total_amount) * (pr.vat_rate_pct/100.0) / (1 + pr.vat_rate_pct/100.0) / 100.0, 2)::numeric AS dpH_czk,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS celkem_czk
            FROM orders.orders o
            JOIN catalog.events e ON e.id = o.event_id
            JOIN platform.promoters pr ON pr.id = e.promoter_id
            WHERE e.promoter_id = $1 AND o.status = 'paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY pr.vat_rate_pct ORDER BY pr.vat_rate_pct`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'finance_mena_rozpad', title: 'Tržby dle měny', category: 'finance',
    description: 'Kolik bylo vybráno v každé měně.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'mena', label: 'Měna', type: 'badge' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
      { key: 'trzby', label: 'Tržby (native)', type: 'number' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT o.currency AS mena, COUNT(*)::int AS objednavky,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby
            ${BASE_SALES_SQL}
            GROUP BY 1 ORDER BY trzby DESC`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'finance_kumulativni', title: 'Kumulativní tržby (finance)', category: 'finance',
    description: 'Narůstající součet čistých tržeb (paid - refunded) po měsících.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Měsíc', type: 'date' },
      { key: 'mesicni_czk', label: 'Měsíční (Kč)', type: 'currency_czk' },
      { key: 'kumulativ_czk', label: 'Kumulativ (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `WITH m AS (
              SELECT DATE_TRUNC('month', o.paid_at)::date AS mes,
                ROUND((COALESCE(SUM(o.total_amount) FILTER (WHERE o.status='paid'),0)
                     - COALESCE(SUM(o.total_amount) FILTER (WHERE o.status='refunded'),0))/100.0,2) AS mesicni
              FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
              WHERE e.promoter_id=$1 AND o.paid_at::date BETWEEN $2 AND $3
              GROUP BY 1
            )
            SELECT mes::text AS mesic, mesicni AS mesicni_czk,
                   ROUND(SUM(mesicni) OVER (ORDER BY mes),2)::numeric AS kumulativ_czk
            FROM m ORDER BY mes`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'finance_affiliate_komise', title: 'Affiliate provize', category: 'finance',
    description: 'Provize affiliate partnerům za zvolené období.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'kod', label: 'Kód', type: 'text' },
      { key: 'konverze', label: 'Konverze', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
      { key: 'provize_czk', label: 'Provize (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT af.code AS kod,
                   COUNT(DISTINCT o.id)::int AS konverze,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk,
                   ROUND(SUM(o.total_amount) * af.commission_pct / 100.0 / 100.0,2)::numeric AS provize_czk
            FROM orders.orders o
            JOIN catalog.events e ON e.id = o.event_id
            JOIN marketing.affiliates af ON af.id = o.affiliate_id
            WHERE e.promoter_id = $1 AND o.status = 'paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY af.id, af.code ORDER BY trzby_czk DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'finance_pojistka', title: 'Pojistka prémie', category: 'finance',
    description: 'Celkový výnos z pojišťovacích prémií.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Měsíc', type: 'date' },
      { key: 'premie_czk', label: 'Prémie (Kč)', type: 'currency_czk' },
      { key: 'pojistky', label: 'Pojistky', type: 'number' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT DATE_TRUNC('month', o.paid_at)::date::text AS mesic,
                   ROUND(SUM(ins.premium_amount)/100.0,2)::numeric AS premie_czk,
                   COUNT(ins.id)::int AS pojistky
            FROM orders.order_insurance ins
            JOIN orders.orders o ON o.id = ins.order_id
            JOIN catalog.events e ON e.id = o.event_id
            WHERE e.promoter_id = $1 AND o.status = 'paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1 LIMIT 200`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'finance_pending_orders', title: 'Nevyřízené objednávky', category: 'finance',
    description: 'Objednávky ve stavu pending (čekají na platbu) za zvolené období.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'den', label: 'Den', type: 'date' },
      { key: 'pending', label: 'Pending', type: 'number' },
      { key: 'castka_czk', label: 'Potenciál (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT o.created_at::date::text AS den,
                   COUNT(*)::int AS pending,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS castka_czk
            FROM orders.orders o JOIN catalog.events e ON e.id = o.event_id
            WHERE e.promoter_id = $1 AND o.status = 'pending'
              AND o.created_at::date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1 LIMIT 2000`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'finance_nejvetsi_objednavky', title: 'Největší objednávky', category: 'finance',
    description: 'Top 100 objednávek dle hodnoty za zvolené období.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'order_id', label: 'Objednávka', type: 'text' },
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'zakaznik', label: 'Zákazník', type: 'text' },
      { key: 'castka_czk', label: 'Částka (Kč)', type: 'currency_czk' },
      { key: 'datum', label: 'Datum', type: 'datetime' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT o.variable_symbol AS order_id, e.title AS akce,
                   u.email AS zakaznik,
                   ROUND(o.total_amount/100.0,2)::numeric AS castka_czk,
                   o.paid_at::text AS datum
            FROM orders.orders o
            JOIN catalog.events e ON e.id = o.event_id
            JOIN identity.users u ON u.id = o.user_id
            WHERE e.promoter_id = $1 AND o.status = 'paid'
              AND o.paid_at::date BETWEEN $2 AND $3
            ORDER BY o.total_amount DESC LIMIT 100`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'finance_platba_metody_trendy', title: 'Platební metody trendem', category: 'finance',
    description: 'Podíl platebních metod po měsících.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Měsíc', type: 'date' },
      { key: 'metoda', label: 'Metoda', type: 'badge' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT DATE_TRUNC('month', o.paid_at)::date::text AS mesic,
                   COALESCE(o.payment_provider,'neznámo') AS metoda,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk,
                   COUNT(*)::int AS objednavky
            ${BASE_SALES_SQL}
            GROUP BY 1,2 ORDER BY 1,trzby_czk DESC LIMIT 1000`,
      values: [pid, from(p), to(p)],
    }),
  },
  {
    id: 'finance_chargebacky', title: 'Chargebacky', category: 'finance',
    description: 'Chargebacky (spory u platební brány) za zvolené období.',
    scope: 'promoter', params: DATE_PARAMS,
    columns: [
      { key: 'order_id', label: 'Objednávka', type: 'text' },
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'zakaznik', label: 'Zákazník', type: 'text' },
      { key: 'castka_czk', label: 'Částka (Kč)', type: 'currency_czk' },
      { key: 'stav', label: 'Stav', type: 'badge' },
      { key: 'datum', label: 'Datum', type: 'date' },
    ],
    buildQuery: (pid, p) => ({
      sql: `SELECT o.variable_symbol AS order_id, e.title AS akce,
                   u.email AS zakaznik,
                   ROUND(cb.amount_halire/100.0,2)::numeric AS castka_czk,
                   cb.status AS stav, cb.created_at::date::text AS datum
            FROM orders.chargebacks cb
            JOIN orders.orders o ON o.id = cb.order_id
            JOIN catalog.events e ON e.id = o.event_id
            JOIN identity.users u ON u.id = o.user_id
            WHERE e.promoter_id = $1
              AND cb.created_at::date BETWEEN $2 AND $3
            ORDER BY cb.created_at DESC LIMIT 200`,
      values: [pid, from(p), to(p)],
    }),
  },
];
