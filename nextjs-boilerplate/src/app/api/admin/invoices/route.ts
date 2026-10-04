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
import { z } from 'zod';
import { issueHospitalityDocument, issueOrderDocument, loadTaxDocument, TaxDocumentError } from '@/lib/accounting/documents';
import { runAsPromoterNonStaff, runAsActivePromoterNonStaff } from '@/lib/admin-auth';
import { asSystemInTx, db } from '@/lib/db/rls-pool';


const postSchema = z
  .object({
    orderId: z.string().uuid().optional(),
    hospitalityInquiryId: z.string().uuid().optional(),
    customerName: z.string().min(1).max(200),
    customerAddress: z.string().max(500).optional(),
    customerIco: z.string().max(20).optional(),
    customerDic: z.string().max(30).optional(),
    customerEmail: z.string().email().max(200).optional(),
    // Kolo 7 (C-54): sazba DPH u hospitality dokladu (u objednávky se bere z typů vstupenek).
    vatRateCode: z.string().max(40).optional(),
  })
  .refine((d) => d.orderId !== undefined || d.hospitalityInquiryId !== undefined, {
    message: 'orderId nebo hospitalityInquiryId povinný',
  });

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoterNonStaff(req, async (promoter) => {
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

  // Kolo 7 (C-54): sdílená služba dokladů — sazby z typů vstupenek (u hospitality zadané), rozpis
  // po sazbách, neplátce bez DPH, číslo z řady bez děr. Dřív sazba pořadatele a číslo MAX+1.
  const customer = {
    name: parsed.data.customerName,
    email: parsed.data.customerEmail ?? null,
    address: parsed.data.customerAddress ?? null,
    ico: parsed.data.customerIco ?? null,
    dic: parsed.data.customerDic ?? null,
  };
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    let invoiceId: string;
    if (parsed.data.orderId) {
      const r = await client.query<{ promoter_id: string }>(
        `SELECT e.promoter_id FROM orders.orders o JOIN catalog.events e ON e.id = o.event_id WHERE o.id = $1`,
        [parsed.data.orderId],
      );
      if (r.rows.length === 0 || r.rows[0].promoter_id !== promoter.promoterId) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      invoiceId = (await asSystemInTx(client, () => issueOrderDocument(client, parsed.data.orderId as string, customer))).invoiceId;
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
      invoiceId = await asSystemInTx(client, () =>
        issueHospitalityDocument(client, {
          promoterId: promoter.promoterId,
          hospitalityInquiryId: parsed.data.hospitalityInquiryId as string,
          totalMinor: r.rows[0].total_amount_minor,
          currency: r.rows[0].currency,
          vatRateCode: parsed.data.vatRateCode ?? null,
          customer,
          paid: false,
        }),
      );
    }
    const doc = await asSystemInTx(client, () => loadTaxDocument(client, invoiceId));
    await client.query('COMMIT');
    return NextResponse.json(
      {
        id: invoiceId,
        invoiceNumber: doc?.number,
        vatPayer: doc?.supplier.vatPayer,
        vatLines: doc?.vatLines ?? [],
        total: doc?.totalMinor,
      },
      { status: 201 },
    );
  } catch (err) {
    await client.query('ROLLBACK');
    if (err instanceof TaxDocumentError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: 422 });
    }
    console.error('[invoice issue]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
