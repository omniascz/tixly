/**
 * POST /api/admin/events/[id]/blocks/[blockId]/release { seatIds? } — uvolnit vybraná (nebo všechna) místa blokace
 * do prodeje (kolo 8 / krok 3). Pod zámkem míst → souběžný nákup místo prodá nejvýš jednou.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { db } from '@/lib/db/rls-pool';
import { BlockError, releaseBlockSeats } from '@/lib/theatre/blocks';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f-]{36}$/i;
const schema = z.object({ seatIds: z.array(z.string().uuid()).max(2000).optional() });

export async function POST(req: NextRequest, { params }: { params: { id: string; blockId: string } }): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!UUID.test(params.id) || !UUID.test(params.blockId)) return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      const r = await releaseBlockSeats(client, promoter, params.id, params.blockId, parsed.data.seatIds);
      await client.query('COMMIT');
      return NextResponse.json(r);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (e instanceof BlockError) return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
      throw e;
    } finally {
      client.release();
    }
  });
}
