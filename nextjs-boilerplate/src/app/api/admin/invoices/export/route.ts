/**
 * GET /api/admin/invoices/export?from=YYYY-MM-DD&to=YYYY-MM-DD&format=csv
 *
 * CSV pro účetnictví: invoice_number, issue_date, customer, subtotal, vat_rate, vat_amount, total, currency.
 * Default range: aktuální měsíc.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoterNonStaff } from '@/lib/admin-auth';


function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoterNonStaff(req, async (promoter) => {
  const url = req.nextUrl;
  const from = url.searchParams.get('from') ?? new Date().toISOString().slice(0, 8) + '01';
  const to = url.searchParams.get('to') ?? new Date().toISOString().slice(0, 10);

  const r = await db().query<{
    invoice_number: string;
    issue_date: string;
    due_date: string;
    customer_name: string;
    customer_ico: string | null;
    customer_dic: string | null;
    subtotal_minor: number;
    vat_rate_pct: number;
    vat_amount_minor: number;
    total_minor: number;
    currency: string;
    paid_at: string | null;
  }>(
    `SELECT invoice_number, issue_date, due_date, customer_name, customer_ico, customer_dic,
            subtotal_minor, vat_rate_pct, vat_amount_minor, total_minor, currency, paid_at
     FROM orders.invoices
     WHERE promoter_id = $1 AND issue_date BETWEEN $2 AND $3
     ORDER BY issue_date DESC, invoice_number DESC`,
    [promoter.promoterId, from, to],
  );

  const header = [
    'invoice_number',
    'issue_date',
    'due_date',
    'customer_name',
    'customer_ico',
    'customer_dic',
    'subtotal_minor',
    'vat_rate_pct',
    'vat_amount_minor',
    'total_minor',
    'currency',
    'paid_at',
  ].join(',');

  const lines = r.rows.map((row) =>
    [
      row.invoice_number,
      row.issue_date,
      row.due_date,
      row.customer_name,
      row.customer_ico ?? '',
      row.customer_dic ?? '',
      row.subtotal_minor,
      row.vat_rate_pct,
      row.vat_amount_minor,
      row.total_minor,
      row.currency,
      row.paid_at ?? '',
    ]
      .map(csvEscape)
      .join(','),
  );

  const csv = [header, ...lines].join('\n');
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="tixly-invoices-${from}-to-${to}.csv"`,
    },
  });

  });
}
