/**
 * POST /api/admin/corporate-orders/[id]/cancel { reason } — zrušení firemní objednávky (kolo 8 / krok 6), i ruční
 * uvolnění míst nezaplacené objednávky po splatnosti: opravný daňový doklad (dobropis), zneplatnění vstupenek,
 * místa zpět do blokace, odkud přišla, jinak do prodeje.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { db } from '@/lib/db/rls-pool';
import { cancelCorporateOrder, CorporateError } from '@/lib/theatre/corporate';

export const dynamic = 'force-dynamic';
const schema = z.object({ reason: z.string().trim().min(1).max(500) });

export async function POST(req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      const res = await cancelCorporateOrder(client, promoter.promoterId, params.id, parsed.data.reason);
      await client.query('COMMIT');
      return NextResponse.json({ ok: true, ...res });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (err instanceof CorporateError) return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
      throw err;
    } finally {
      client.release();
    }
  });
}
