/**
 * Pojmenované blokace míst termínu (kolo 8 / krok 3).
 *   GET  — přehled: blokace | míst celkem | uvolněno | vydáno | prodáno | zbývá blokováno + místa pro plánek (barvy)
 *   POST — nová blokace { name, note?, color?, seatIds? | sector? } nad volnými místy
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { db } from '@/lib/db/rls-pool';
import { assertEventOwned, BlockError, blockOverview, createBlock } from '@/lib/theatre/blocks';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!UUID.test(params.id)) return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
    try {
      await assertEventOwned(db(), promoter.promoterId, params.id);
    } catch (e) {
      if (e instanceof BlockError) return NextResponse.json({ error: e.code }, { status: e.status });
      throw e;
    }
    return NextResponse.json(await blockOverview(db(), promoter.promoterId, params.id));
  });
}

const schema = z.object({
  name: z.string().trim().min(1).max(100),
  note: z.string().max(1000).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  seatIds: z.array(z.string().uuid()).max(2000).optional(),
  sector: z.string().min(1).max(100).nullable().optional(),
}).refine((v) => (v.seatIds && v.seatIds.length > 0) || v.sector, { message: 'seatIds nebo sector' });

export async function POST(req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!UUID.test(params.id)) return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      const r = await createBlock(client, promoter, params.id, parsed.data);
      await client.query('COMMIT');
      return NextResponse.json(r, { status: 201 });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (e instanceof BlockError) return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
      throw e;
    } finally {
      client.release();
    }
  });
}
