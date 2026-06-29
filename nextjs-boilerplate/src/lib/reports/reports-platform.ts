import type { ReportDef } from './types';
import { DATE_PARAMS, from, to } from './helpers';

export const REPORTS_PLATFORM: ReportDef[] = [
  {
    id: 'platform_promoteri_trzby', title: 'Promotéři dle tržeb', category: 'platform',
    description: 'Přehled všech promotérů seřazených dle celkových tržeb za období.',
    scope: 'platform', params: DATE_PARAMS,
    columns: [
      { key: 'promoter', label: 'Promotér', type: 'text' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
      { key: 'akci', label: 'Akcí', type: 'number' },
    ],
    buildQuery: (_pid, p) => ({
      sql: `SELECT pr.name AS promoter,
                   COUNT(DISTINCT o.id)::int AS objednavky,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk,
                   COUNT(DISTINCT e.id)::int AS akci
            FROM platform.promoters pr
            JOIN catalog.events e ON e.promoter_id = pr.id
            JOIN orders.orders o ON o.event_id = e.id
            WHERE o.status='paid'
              AND o.paid_at::date BETWEEN $1 AND $2
            GROUP BY pr.id, pr.name ORDER BY trzby_czk DESC LIMIT 200`,
      values: [from(p), to(p)],
    }),
  },
  {
    id: 'platform_novi_promoteri', title: 'Noví promotéři', category: 'platform',
    description: 'Promotéři registrovaní v daném období.',
    scope: 'platform', params: DATE_PARAMS,
    columns: [
      { key: 'promoter', label: 'Promotér', type: 'text' },
      { key: 'email', label: 'E-mail', type: 'text' },
      { key: 'registrace', label: 'Registrace', type: 'date' },
      { key: 'stav', label: 'Stav', type: 'badge' },
    ],
    buildQuery: (_pid, p) => ({
      sql: `SELECT pr.name AS promoter, u.email,
                   pr.created_at::date::text AS registrace,
                   pr.status AS stav
            FROM platform.promoters pr
            JOIN identity.users u ON u.id = pr.owner_user_id
            WHERE pr.created_at::date BETWEEN $1 AND $2
            ORDER BY pr.created_at DESC LIMIT 200`,
      values: [from(p), to(p)],
    }),
  },
  {
    id: 'platform_platform_revenue', title: 'Platform revenue (service fees)', category: 'platform',
    description: 'Příjmy platformy Tixly z service fee za zvolené období.',
    scope: 'platform', params: DATE_PARAMS,
    columns: [
      { key: 'den', label: 'Den', type: 'date' },
      { key: 'service_fee_czk', label: 'Service fee (Kč)', type: 'currency_czk' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
    ],
    buildQuery: (_pid, p) => ({
      sql: `SELECT o.paid_at::date::text AS den,
                   ROUND(SUM(COALESCE(o.service_fee_minor,0))/100.0,2)::numeric AS service_fee_czk,
                   COUNT(*)::int AS objednavky
            FROM orders.orders o
            WHERE o.status='paid'
              AND o.paid_at::date BETWEEN $1 AND $2
            GROUP BY 1 ORDER BY 1 LIMIT 2000`,
      values: [from(p), to(p)],
    }),
  },
  {
    id: 'platform_celkem_vstupenky', title: 'Celkem vstupenek na platformě', category: 'platform',
    description: 'Počet vstupenek prodaných celé platformou dle měsíce.',
    scope: 'platform', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Měsíc', type: 'date' },
      { key: 'vstupenek', label: 'Vstupenek', type: 'number' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (_pid, p) => ({
      sql: `SELECT DATE_TRUNC('month', o.paid_at)::date::text AS mesic,
                   COALESCE(SUM(oi.quantity),0)::int AS vstupenek,
                   COUNT(DISTINCT o.id)::int AS objednavky,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk
            FROM orders.orders o
            LEFT JOIN orders.order_items oi ON oi.order_id=o.id
            WHERE o.status='paid'
              AND o.paid_at::date BETWEEN $1 AND $2
            GROUP BY 1 ORDER BY 1 LIMIT 36`,
      values: [from(p), to(p)],
    }),
  },
  {
    id: 'platform_celkem_zakaznici', title: 'Celkem zákazníků na platformě', category: 'platform',
    description: 'Růst zákaznické základny celé platformy.',
    scope: 'platform', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Měsíc', type: 'date' },
      { key: 'novi_zakaznici', label: 'Noví zákazníci', type: 'number' },
      { key: 'kumulativ', label: 'Kumulativ', type: 'number' },
    ],
    buildQuery: (_pid, p) => ({
      sql: `WITH fc AS (
              SELECT user_id, DATE_TRUNC('month', MIN(paid_at))::date AS prvni_mes
              FROM orders.orders WHERE status='paid' GROUP BY user_id
            )
            SELECT prvni_mes::text AS mesic,
                   COUNT(*)::int AS novi_zakaznici,
                   SUM(COUNT(*)) OVER (ORDER BY prvni_mes)::int AS kumulativ
            FROM fc WHERE prvni_mes BETWEEN $1 AND $2
            GROUP BY prvni_mes ORDER BY prvni_mes`,
      values: [from(p), to(p)],
    }),
  },
  {
    id: 'platform_top_akce', title: 'Top akce na celé platformě', category: 'platform',
    description: 'Nejvýdělečnější akce přes všechny promotéry.',
    scope: 'platform', params: DATE_PARAMS,
    columns: [
      { key: 'akce', label: 'Akce', type: 'text' },
      { key: 'promoter', label: 'Promotér', type: 'text' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
    ],
    buildQuery: (_pid, p) => ({
      sql: `SELECT e.title AS akce, pr.name AS promoter,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk,
                   COUNT(DISTINCT o.id)::int AS objednavky
            FROM orders.orders o
            JOIN catalog.events e ON e.id=o.event_id
            JOIN platform.promoters pr ON pr.id=e.promoter_id
            WHERE o.status='paid'
              AND o.paid_at::date BETWEEN $1 AND $2
            GROUP BY e.id, e.title, pr.name ORDER BY trzby_czk DESC LIMIT 50`,
      values: [from(p), to(p)],
    }),
  },
  {
    id: 'platform_refund_rate_global', title: 'Globální refund rate', category: 'platform',
    description: 'Refund rate celé platformy dle měsíce.',
    scope: 'platform', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Měsíc', type: 'date' },
      { key: 'zaplacene', label: 'Zaplacené', type: 'number' },
      { key: 'refundovane', label: 'Refundované', type: 'number' },
      { key: 'refund_rate', label: 'Refund %', type: 'pct' },
    ],
    buildQuery: (_pid, p) => ({
      sql: `SELECT DATE_TRUNC('month', o.created_at)::date::text AS mesic,
                   COUNT(*) FILTER (WHERE o.status='paid')::int AS zaplacene,
                   COUNT(*) FILTER (WHERE o.status='refunded')::int AS refundovane,
                   ROUND(100.0*COUNT(*) FILTER (WHERE o.status='refunded')
                     /NULLIF(COUNT(*) FILTER (WHERE o.status IN ('paid','refunded')),0),1)::numeric AS refund_rate
            FROM orders.orders o
            WHERE o.created_at::date BETWEEN $1 AND $2
            GROUP BY 1 ORDER BY 1 LIMIT 36`,
      values: [from(p), to(p)],
    }),
  },
  {
    id: 'platform_dle_zeme', title: 'Revenue dle země', category: 'platform',
    description: 'Tržby platformy dle fakturační země zákazníka.',
    scope: 'platform', params: DATE_PARAMS,
    columns: [
      { key: 'zeme', label: 'Země', type: 'badge' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
    ],
    buildQuery: (_pid, p) => ({
      sql: `SELECT COALESCE(o.billing_country_code, u.country_code, 'N/A') AS zeme,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk,
                   COUNT(DISTINCT o.id)::int AS objednavky
            FROM orders.orders o
            JOIN identity.users u ON u.id=o.user_id
            WHERE o.status='paid'
              AND o.paid_at::date BETWEEN $1 AND $2
            GROUP BY 1 ORDER BY trzby_czk DESC LIMIT 100`,
      values: [from(p), to(p)],
    }),
  },
  {
    id: 'platform_dpH_summary', title: 'DPH summary (celá platforma)', category: 'platform',
    description: 'Souhrnný DPH výkaz pro celou platformu dle sazby.',
    scope: 'platform', params: [
      { key: 'month', label: 'Měsíc (YYYY-MM)', type: 'month', required: true },
    ],
    columns: [
      { key: 'promoter', label: 'Promotér', type: 'text' },
      { key: 'sazba', label: 'DPH sazba', type: 'text' },
      { key: 'zaklad_czk', label: 'Základ (Kč)', type: 'currency_czk' },
      { key: 'dpH_czk', label: 'DPH (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (_pid, p) => ({
      sql: `SELECT pr.name AS promoter,
                   pr.vat_rate_pct::text || ' %' AS sazba,
                   ROUND(SUM(o.total_amount)/(1+pr.vat_rate_pct/100.0)/100.0,2)::numeric AS zaklad_czk,
                   ROUND(SUM(o.total_amount)*(pr.vat_rate_pct/100.0)/(1+pr.vat_rate_pct/100.0)/100.0,2)::numeric AS dpH_czk
            FROM orders.orders o
            JOIN catalog.events e ON e.id=o.event_id
            JOIN platform.promoters pr ON pr.id=e.promoter_id
            WHERE o.status='paid'
              AND TO_CHAR(o.paid_at,'YYYY-MM') = $1
            GROUP BY pr.id, pr.name, pr.vat_rate_pct
            ORDER BY zaklad_czk DESC`,
      values: [p.month ?? new Date().toISOString().slice(0, 7)],
    }),
  },
  {
    id: 'platform_daily_kpi', title: 'Denní KPI (platforma)', category: 'platform',
    description: 'Denní přehled klíčových metrik celé platformy.',
    scope: 'platform', params: DATE_PARAMS,
    columns: [
      { key: 'den', label: 'Den', type: 'date' },
      { key: 'objednavky', label: 'Objednávky', type: 'number' },
      { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
      { key: 'zakaznici', label: 'Unikátní zákazníci', type: 'number' },
      { key: 'promoteri', label: 'Aktivní promotéři', type: 'number' },
    ],
    buildQuery: (_pid, p) => ({
      sql: `SELECT o.paid_at::date::text AS den,
                   COUNT(DISTINCT o.id)::int AS objednavky,
                   ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk,
                   COUNT(DISTINCT o.user_id)::int AS zakaznici,
                   COUNT(DISTINCT e.promoter_id)::int AS promoteri
            FROM orders.orders o JOIN catalog.events e ON e.id=o.event_id
            WHERE o.status='paid'
              AND o.paid_at::date BETWEEN $1 AND $2
            GROUP BY 1 ORDER BY 1 LIMIT 2000`,
      values: [from(p), to(p)],
    }),
  },
  {
    id: 'platform_chargebacky_dle_promotera', title: 'Chargebacky dle promotéra', category: 'platform',
    description: 'Přehled chargeback rate pro každého promotéra.',
    scope: 'platform', params: DATE_PARAMS,
    columns: [
      { key: 'promoter', label: 'Promotér', type: 'text' },
      { key: 'chargebacky', label: 'Chargebacky', type: 'number' },
      { key: 'castka_czk', label: 'Částka (Kč)', type: 'currency_czk' },
    ],
    buildQuery: (_pid, p) => ({
      sql: `SELECT pr.name AS promoter,
                   COUNT(cb.id)::int AS chargebacky,
                   ROUND(SUM(cb.amount_halire)/100.0,2)::numeric AS castka_czk
            FROM orders.chargebacks cb
            JOIN orders.orders o ON o.id=cb.order_id
            JOIN catalog.events e ON e.id=o.event_id
            JOIN platform.promoters pr ON pr.id=e.promoter_id
            WHERE cb.created_at::date BETWEEN $1 AND $2
            GROUP BY pr.id, pr.name ORDER BY chargebacky DESC LIMIT 100`,
      values: [from(p), to(p)],
    }),
  },
  {
    id: 'platform_avg_ticket_price_global', title: 'Průměrná cena vstupenky (platforma)', category: 'platform',
    description: 'Průměrná cena vstupenky dle měsíce přes celou platformu.',
    scope: 'platform', params: DATE_PARAMS,
    columns: [
      { key: 'mesic', label: 'Měsíc', type: 'date' },
      { key: 'avg_cena_czk', label: 'Průměrná cena (Kč)', type: 'currency_czk' },
      { key: 'vstupenek', label: 'Vstupenek', type: 'number' },
    ],
    buildQuery: (_pid, p) => ({
      sql: `SELECT DATE_TRUNC('month', o.paid_at)::date::text AS mesic,
                   ROUND(AVG(oi.unit_price)/100.0,2)::numeric AS avg_cena_czk,
                   SUM(oi.quantity)::int AS vstupenek
            FROM orders.order_items oi
            JOIN orders.orders o ON o.id=oi.order_id
            WHERE o.status='paid'
              AND o.paid_at::date BETWEEN $1 AND $2
            GROUP BY 1 ORDER BY 1 LIMIT 36`,
      values: [from(p), to(p)],
    }),
  },
];
