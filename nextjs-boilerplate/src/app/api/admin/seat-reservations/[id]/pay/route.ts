/**
 * POST /api/admin/seat-reservations/[id]/pay { paymentType: 'cash' | 'card', cashTenderedMinor? } — pokladna přijme
 * platbu rezervace (kolo 8 / krok 5): objednávka zaplacená, vstupenky, daňový doklad, zápis do směny pokladny se
 * způsobem platby; lhůta rezervace se ověřuje na serveru. Vstupenky odejdou e-mailem i kupci.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { TaxDocumentError } from '@/lib/accounting/documents';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { db } from '@/lib/db/rls-pool';
import { payReservation, ReservationError } from '@/lib/theatre/reservations';

export const dynamic = 'force-dynamic';
const schema = z.object({ paymentType: z.enum(['cash', 'card']), cashTenderedMinor: z.number().int().min(0).optional() });

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
    const client = await db().connect();
    let result: Awaited<ReturnType<typeof payReservation>>;
    try {
      await client.query('BEGIN');
      result = await payReservation(client, {
        reservationId: params.id, promoterId: promoter.promoterId, cashierUserId: promoter.userId,
        paymentType: parsed.data.paymentType, cashTenderedMinor: parsed.data.cashTenderedMinor ?? null,
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (err instanceof ReservationError) return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
      if (err instanceof TaxDocumentError) return NextResponse.json({ error: err.code, message: err.message }, { status: 422 });
      throw err;
    } finally {
      client.release();
    }
    const { sendOrderTickets } = await import('@/lib/email/send-order-tickets');
    const mail = await sendOrderTickets(result.orderId).catch((e: unknown) => {
      console.error('[seat-reservations/pay] e-mail se vstupenkami selhal', e);
      return null;
    });
    return NextResponse.json({ ...result, ticketsEmailed: mail?.sent ?? false });
  });
}
