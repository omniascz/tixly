/**
 * Faktury provize platformy pořadatelům (kolo 7, C-54) — dřív jen stub.
 *   GET  /api/platform/admin/invoices            seznam faktur provize
 *   POST /api/platform/admin/invoices {payoutId} vystaví (idempotentně) fakturu provize k výplatě
 * Dodavatel = platform.billing_identity (bez vyplnění 503 PLATFORM_BILLING_NOT_CONFIGURED).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { CommissionInvoiceError, issueCommissionInvoice } from '@/lib/accounting/commission';
import { asSystemInTx, db } from '@/lib/db/rls-pool';
import { runAsPlatformAdmin } from '@/lib/platform-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPlatformAdmin(req, async () => {
    const r = await db().query(
      `SELECT ci.id, ci.invoice_number, ci.issue_date::text, ci.promoter_id, p.name AS promoter_name,
              ci.total_minor::int AS total_minor, ci.vat_minor::int AS vat_minor, ci.currency, ci.payout_id
         FROM platform.commission_invoices ci JOIN platform.promoters p ON p.id = ci.promoter_id
        ORDER BY ci.issue_date DESC, ci.invoice_number DESC LIMIT 500`,
    );
    return NextResponse.json({ invoices: r.rows });
  });
}

const postSchema = z.object({ payoutId: z.string().uuid() });

export async function POST(req: NextRequest): Promise<Response> {
  return runAsPlatformAdmin(req, async () => {
    const parsed = postSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'BAD_INPUT', issues: parsed.error.issues }, { status: 422 });
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      const r = await asSystemInTx(client, () => issueCommissionInvoice(client, parsed.data.payoutId));
      await client.query('COMMIT');
      return NextResponse.json(r, { status: r.created ? 201 : 200 });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (err instanceof CommissionInvoiceError) {
        const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'PLATFORM_BILLING_NOT_CONFIGURED' ? 503 : 422;
        return NextResponse.json({ error: err.code, message: err.message }, { status });
      }
      throw err;
    } finally {
      client.release();
    }
  });
}
