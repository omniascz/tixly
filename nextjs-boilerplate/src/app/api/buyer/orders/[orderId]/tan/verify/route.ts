/**
 * POST /api/buyer/orders/[orderId]/tan/verify
 *
 * Body: { tanId, code }
 * Verifikuje SMS code. Po úspěchu označí orders.orders.tan_validated_at.
 * Bez validace lístky nevidí v /my-tickets ani /m/ticket pro hot eventy.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import { z } from 'zod';
import { verifyTan } from '@/lib/sms/tan';


const schema = z.object({
  tanId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { orderId: string } },
): Promise<Response> {
  return runAsUser(req, async (userId) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
  }

  const r = await verifyTan({ tanId: parsed.data.tanId, code: parsed.data.code });

  if (!r.valid) {
    return NextResponse.json({
      valid: false,
      reason: r.reason,
      message: humanReason(r.reason),
    }, { status: r.reason === 'wrong_code' ? 401 : 410 });
  }

  if (r.relatedId !== params.orderId) {
    return NextResponse.json({ error: 'TAN_FOR_WRONG_ORDER' }, { status: 422 });
  }

  // Mark order TAN-validated. Add column if missing (idempotent ALTER).
  await db().query(
    `UPDATE orders.orders SET tan_validated_at = now() WHERE id = $1 AND user_id = $2`,
    [params.orderId, userId],
  ).catch(async (e: { code?: string; message?: string }) => {
    if (e.message?.includes('tan_validated_at')) {
      // Column missing — fallback to audit_log
      await db().query(
        `INSERT INTO audit.audit_log (schema_name, table_name, record_id, action, actor_id, actor_type, new_values)
         VALUES ('orders', 'orders', $1, 'UPDATE', $2, 'user', $3::jsonb)`,
        [params.orderId, userId, JSON.stringify({ tan_validated_at: new Date().toISOString() })],
      );
    } else throw e;
  });

  return NextResponse.json({ valid: true, orderId: params.orderId });

  });
}

function humanReason(reason?: string): string {
  switch (reason) {
    case 'expired': return 'Kód vypršel. Požádej o nový.';
    case 'consumed': return 'Kód už byl použit.';
    case 'wrong_code': return 'Špatný kód.';
    case 'too_many_attempts': return 'Příliš mnoho neúspěšných pokusů. Požádej o nový kód.';
    case 'not_found': return 'Kód neexistuje.';
    default: return 'Neplatný kód.';
  }
}
