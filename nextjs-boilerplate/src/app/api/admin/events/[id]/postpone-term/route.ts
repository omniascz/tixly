/**
 * POST /api/admin/events/[id]/postpone-term { newStart, reason, refundDays? } — přesun termínu (kolo 8 / krok 7, C-14).
 * Vstupenky zůstávají platné; kupci dostanou e-mail s novým datem a odkazem na vrácení platným do lhůty
 * (výchozí 14 dní). Žádost o vrácení jde existující cestou /api/reschedule/[token] → refund.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAsPromoterNonStaff } from '@/lib/admin-auth';
import { db } from '@/lib/db/rls-pool';
import { postponeTerm, TermError } from '@/lib/theatre/term-lifecycle';

export const dynamic = 'force-dynamic';
const schema = z.object({
  newStart: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(2).max(1000),
  refundDays: z.number().int().min(1).max(90).optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return runAsPromoterNonStaff(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
    try {
      const r = await postponeTerm(db() as never, { promoterId: promoter.promoterId, userId: promoter.userId }, params.id, parsed.data);
      return NextResponse.json({ ok: true, ...r });
    } catch (err) {
      if (err instanceof TermError) return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
      throw err;
    }
  });
}
