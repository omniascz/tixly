import type { ReportParam, ReportColumn } from './types';

export const DATE_PARAMS: ReportParam[] = [
  { key: 'dateFrom', label: 'Od data', type: 'date', required: true },
  { key: 'dateTo', label: 'Do data', type: 'date', required: true },
];

export function from(p: Record<string, string>): string {
  return p.dateFrom ?? new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
}

export function to(p: Record<string, string>): string {
  return p.dateTo ?? new Date().toISOString().slice(0, 10);
}

export const SALES_COLS: ReportColumn[] = [
  { key: 'objednavky', label: 'Objednávky', type: 'number' },
  { key: 'vstupenek', label: 'Vstupenek', type: 'number' },
  { key: 'trzby_czk', label: 'Tržby (Kč)', type: 'currency_czk' },
  { key: 'prumer_czk', label: 'Průměr/obj. (Kč)', type: 'currency_czk' },
];

export const BASE_SALES_SQL = `
  FROM orders.orders o
  JOIN catalog.events e ON e.id = o.event_id
  LEFT JOIN orders.order_items oi ON oi.order_id = o.id
  WHERE e.promoter_id = $1 AND o.status = 'paid'
    AND o.paid_at::date BETWEEN $2 AND $3`;

export function timeSalesQuery(period: string) {
  return (pid: string, p: Record<string, string>) => ({
    sql: `SELECT
            DATE_TRUNC('${period}', o.paid_at AT TIME ZONE 'Europe/Prague')::date::text AS obdobi,
            COUNT(DISTINCT o.id)::int AS objednavky,
            COALESCE(SUM(oi.quantity),0)::int AS vstupenek,
            ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk,
            ROUND(AVG(o.total_amount)/100.0,2)::numeric AS prumer_czk
          ${BASE_SALES_SQL}
          GROUP BY 1 ORDER BY 1 ASC LIMIT 2000`,
    values: [pid, from(p), to(p)],
  });
}

export function dimSalesQuery(
  dimExpr: string,
  dimLabel: string,
  joinSql = '',
  extraWhere = '',
  orderBy = 'trzby_czk DESC',
  limitN = 200,
) {
  return (pid: string, p: Record<string, string>) => ({
    sql: `SELECT
            ${dimExpr} AS ${dimLabel},
            COUNT(DISTINCT o.id)::int AS objednavky,
            COALESCE(SUM(oi.quantity),0)::int AS vstupenek,
            ROUND(SUM(o.total_amount)/100.0,2)::numeric AS trzby_czk,
            ROUND(AVG(o.total_amount)/100.0,2)::numeric AS prumer_czk
          FROM orders.orders o
          JOIN catalog.events e ON e.id = o.event_id
          LEFT JOIN orders.order_items oi ON oi.order_id = o.id
          ${joinSql}
          WHERE e.promoter_id = $1 AND o.status = 'paid'
            AND o.paid_at::date BETWEEN $2 AND $3
            ${extraWhere}
          GROUP BY 1 ORDER BY ${orderBy} LIMIT ${limitN}`,
    values: [pid, from(p), to(p)],
  });
}
