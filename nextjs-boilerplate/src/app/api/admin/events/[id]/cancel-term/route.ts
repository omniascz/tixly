/**
 * Zrušení termínu (kolo 8 / krok 7, C-14).
 *   POST { reason } — zastaví prodej i rezervace, rozpracované nákupy zruší, online platby vrátí přes bránu (sdílená
 *        cesta hromadného refundu, dobropis k dokladu), zneplatní vstupenky, pošle kupcům e-mail; vrací souhrn a seznam
 *        plateb k ručnímu vrácení (pokladna, firemní faktury, selhané refundy).
 *   GET  — seznam plateb k ručnímu vrácení (i později, po dořešení).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAsPromoterNonStaff } from '@/lib/admin-auth';
import { db } from '@/lib/db/rls-pool';
import { cancelTerm, manualRefundList, TermError } from '@/lib/theatre/term-lifecycle';

export const dynamic = 'force-dynamic';
const schema = z.object({ reason: z.string().trim().min(2).max(1000) });

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsPromoterNonStaff(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
    const ev = (await db().query<{ status: string; cancelled_at: string | null; cancellation_reason: string | null }>(
      `SELECT status, cancelled_at, cancellation_reason FROM catalog.events WHERE id = $1 AND promoter_id = $2`, [params.id, promoter.promoterId],
    )).rows[0];
    if (!ev) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ ...ev, manualRefunds: await manualRefundList(db(), params.id) });
  });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsPromoterNonStaff(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
    try {
      const summary = await cancelTerm(db() as never, { promoterId: promoter.promoterId, userId: promoter.userId }, params.id, parsed.data.reason);
      return NextResponse.json({ ok: true, ...summary });
    } catch (err) {
      if (err instanceof TermError) return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
      throw err;
    }
  });
}
