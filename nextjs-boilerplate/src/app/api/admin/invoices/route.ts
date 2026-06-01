/**
 * GET  /api/admin/invoices — list všech faktur promotéra
 * POST /api/admin/invoices — issue invoice for order or hospitality_inquiry
 *
 * Body: { orderId?: uuid } OR { hospitalityInquiryId?: uuid }
 *
 * Auto-spočítá VAT podle promoter.vat_rate_pct, vygeneruje invoice_number
 * (formát: YYYY-NNNN, sekvenční per promotér).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter, runAsActivePromoterNonStaff } from '@/lib/admin-auth';
import { z } from 'zod';


const postSchema = z
  .object({
    orderId: z.string().uuid().optional(),
    hospitalityInquiryId: z.string().uuid().optional(),
    customerName: z.string().min(1).max(200),
    customerAddress: z.string().max(500).optional(),
    customerIco: z.string().max(20).optional(),
    customerDic: z.string().max(30).optional(),
    customerEmail: z.string().email().max(200).optional(),
  })
  .refine((d) => d.orderId !== undefined || d.hospitalityInquiryId !== undefined, {
    message: 'orderId nebo hospitalityInquiryId povinný',
  });

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  const r = await db().query<{
    id: string;
    invoice_number: string;
    issue_date: string;
    due_date: string;
    subtotal_minor: number;
    vat_amount_minor: number;
    total_minor: number;
    currency: string;
    customer_name: string;
    paid_at: string | null;
  }>(
    `SELECT id, invoice_number, issue_date, due_date,
            subtotal_minor, vat_amount_minor, total_minor, currency,
            customer_name, paid_at
     FROM orders.invoices
     WHERE promoter_id = $1
     ORDER BY issue_date DESC, created_at DESC
     LIMIT 200`,
    [promoter.promoterId],
  );
  return NextResponse.json({ invoices: r.rows });

  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoterNonStaff(req, async (promoter) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    // Get promoter VAT settings
    const promRes = await client.query<{ vat_rate_pct: number; vat_payer: boolean }>(
      `SELECT vat_rate_pct, vat_payer FROM platform.promoters WHERE id = $1`,
      [promoter.promoterId],
    );
    const vatRate = promRes.rows[0].vat_rate_pct;

    // Resolve total + currency from order or hospitality inquiry
    let totalGross: number;
    let currency: string;
    if (parsed.data.orderId) {
      const r = await client.query<{ total_amount: number; currency: string; promoter_id: string }>(
        `SELECT o.total_amount, o.currency, e.promoter_id
         FROM orders.orders o
         JOIN catalog.events e ON e.id = o.event_id
         WHERE o.id = $1 FOR UPDATE`,
        [parsed.data.orderId],
      );
      if (r.rows.length === 0 || r.rows[0].promoter_id !== promoter.promoterId) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      totalGross = r.rows[0].total_amount;
      currency = r.rows[0].currency;
    } else {
      const r = await client.query<{ total_amount_minor: number; currency: string; promoter_id: string }>(
        `SELECT i.total_amount_minor, i.currency, e.promoter_id
         FROM orders.hospitality_inquiries i
         JOIN catalog.hospitality_packages p ON p.id = i.package_id
         JOIN catalog.events e ON e.id = p.event_id
         WHERE i.id = $1 FOR UPDATE`,
        [parsed.data.hospitalityInquiryId],
      );
      if (r.rows.length === 0 || r.rows[0].promoter_id !== promoter.promoterId) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      totalGross = r.rows[0].total_amount_minor;
      currency = r.rows[0].currency;
    }

    // VAT extraction (gross → net + VAT)
    const subtotal = Math.round((totalGross * 100) / (100 + vatRate));
    const vatAmount = totalGross - subtotal;

    // Generate invoice number — yearly sequential per promotér
    const year = new Date().getFullYear();
    const seq = await client.query<{ next: string }>(
      `SELECT COALESCE(
         (SELECT MAX(SPLIT_PART(invoice_number, '-', 2)::int)::text
          FROM orders.invoices
          WHERE promoter_id = $1 AND invoice_number LIKE $2),
         '0'
       ) AS next`,
      [promoter.promoterId, `${year}-%`],
    );
    const nextNum = String(Number(seq.rows[0].next) + 1).padStart(4, '0');
    const invoiceNumber = `${year}-${nextNum}`;

    // Due date: 14 days
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 14);

    const r = await client.query<{ id: string }>(
      `INSERT INTO orders.invoices
         (order_id, hospitality_inquiry_id, promoter_id, invoice_number, due_date,
          subtotal_minor, vat_rate_pct, vat_amount_minor, total_minor, currency,
          customer_name, customer_email, customer_address, customer_ico, customer_dic)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id`,
      [
        parsed.data.orderId ?? null,
        parsed.data.hospitalityInquiryId ?? null,
        promoter.promoterId,
        invoiceNumber,
        dueDate.toISOString().slice(0, 10),
        subtotal,
        vatRate,
        vatAmount,
        totalGross,
        currency,
        parsed.data.customerName,
        parsed.data.customerEmail ?? null,
        parsed.data.customerAddress ?? null,
        parsed.data.customerIco ?? null,
        parsed.data.customerDic ?? null,
      ],
    );

    await client.query('COMMIT');
    return NextResponse.json(
      {
        id: r.rows[0].id,
        invoiceNumber,
        subtotal,
        vatAmount,
        total: totalGross,
        vatRate,
      },
      { status: 201 },
    );
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[invoice issue]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
