/**
 * POST /api/admin/corporate-orders/[id]/paid { paidOn: 'YYYY-MM-DD', paymentReference } — pořadatel označí fakturu
 * firemní objednávky jako zaplacenou (kolo 8 / krok 6). Teprve potom vzniknou vstupenky; kontaktu firmy odejdou
 * jedním e-mailem: společné PDF se všemi vstupenkami i každá vstupenka zvlášť.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { db } from '@/lib/db/rls-pool';
import { CorporateError, markCorporatePaid } from '@/lib/theatre/corporate';

export const dynamic = 'force-dynamic';
const schema = z.object({ paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), paymentReference: z.string().trim().min(1).max(100) });

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
    const client = await db().connect();
    let res: Awaited<ReturnType<typeof markCorporatePaid>>;
    try {
      await client.query('BEGIN');
      res = await markCorporatePaid(client, promoter.promoterId, params.id, parsed.data);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (err instanceof CorporateError) return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
      throw err;
    } finally {
      client.release();
    }
    const { sendOrderTickets } = await import('@/lib/email/send-order-tickets');
    const mail = await sendOrderTickets(res.orderId, { toOverride: res.contactEmail, individualPdfs: true }).catch((e: unknown) => {
      console.error('[corporate-orders/paid] e-mail se vstupenkami selhal', e);
      return null;
    });
    return NextResponse.json({ ok: true, tickets: res.tickets, ticketsEmailed: mail?.sent ?? false, emailedTo: res.contactEmail });
  });
}
