/**
 * POST /api/admin/orders/[orderId]/send-tickets
 *
 * Pošle vstupenky k objednávce — znovu, nebo poprvé.
 *
 * Kvůli tomuhle to hlavně vzniklo: objednávky placené **na fakturu nebo
 * bankovním převodem** e-mail se vstupenkami nikdy nedostaly, protože ho
 * odesílalo jen dokončení platby kartou. Stejně tak vstupenky vydané zdarma.
 * Teď je pošle obsluha jedním klikem, a když kupující e-mail ztratí, pošle
 * se znovu.
 *
 * Body: { toOverride?, note? }
 *   toOverride — poslat na jinou adresu (kupující nadiktuje jinou po telefonu)
 *   note       — věta navíc do e-mailu
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { sendOrderTickets } from '@/lib/email/send-order-tickets';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  toOverride: z.string().email().max(320).optional(),
  note: z.string().max(500).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { orderId: string } },
): Promise<Response> {
  // Kolo 5: jen AKTIVNÍ pořadatel — routa rozesílá vstupenky (i na toOverride), pozastavený je nesmí vyvést.
  return runAsActivePromoter(req, async (ctx) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.orderId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const raw: unknown = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'BAD_INPUT', issues: parsed.error.issues }, { status: 422 });
    }

    // Objednávka musí patřit k akci tohoto pořadatele.
    const own = await db().query<{ status: string }>(
      `SELECT o.status
       FROM orders.orders o
       JOIN catalog.events e ON e.id = o.event_id
       WHERE o.id = $1 AND e.promoter_id = $2`,
      [params.orderId, ctx.promoterId],
    );
    const order = own.rows[0];
    if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Nezaplacenou objednávku neposíláme — vstupenka bez platby by prošla branou.
    if (order.status !== 'paid' && order.status !== 'completed') {
      return NextResponse.json(
        {
          error: 'ORDER_NOT_PAID',
          message: `Objednávka není zaplacená (stav ${order.status}). Vstupenky se posílají až po úhradě.`,
        },
        { status: 409 },
      );
    }

    const result = await runWithServiceContext(() =>
      sendOrderTickets(params.orderId, {
        toOverride: parsed.data.toOverride ?? null,
        note: parsed.data.note ?? null,
      }),
    );

    if (!result.sent) {
      return NextResponse.json(
        { ok: false, error: 'SEND_FAILED', message: result.reason ?? 'E-mail se nepodařilo odeslat.' },
        { status: 422 },
      );
    }

    // Odeslání vstupenek je dohledatelná akce — obsluha jím může poslat
    // vstupenku na cizí adresu, takže musí být v auditním logu.
    await db().query(
      `INSERT INTO audit.audit_log
         (schema_name, table_name, record_id, action, actor_id, actor_type, new_values)
       VALUES ('orders','orders',$1,'UPDATE',$2,'user',$3::jsonb)`,
      [
        params.orderId,
        ctx.userId,
        JSON.stringify({
          kind: 'tickets_resend',
          to: result.to,
          ticket_count: result.ticketCount,
          pdf: result.pdfAttached,
        }),
      ],
    );

    return NextResponse.json({
      ok: true,
      to: result.to,
      ticketCount: result.ticketCount,
      pdfAttached: result.pdfAttached,
      message: `Odesláno ${result.ticketCount} vstupenek na ${result.to}.`,
    });
  });
}
