/**
 * POST /api/admin/events/[id]/seats/refresh — znovu převzít aktuální plánek sálu do NEPRODANÉHO termínu
 * (kolo 8 / krok 2). Termín s prodaným / drženým místem nebo objednávkou → 409 HAS_SALES (prodaný termín
 * se úpravou plánku sálu nemění).
 */
import { NextRequest, NextResponse } from 'next/server';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { db } from '@/lib/db/rls-pool';
import { refreshEventSeatsFromChart, SeatRefreshError } from '@/lib/seats/copy-layout-to-event-seats';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      const ev = await client.query(`SELECT id FROM catalog.events WHERE id = $1 AND promoter_id = $2 FOR UPDATE`, [params.id, promoter.promoterId]);
      if (ev.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
      }
      const r = await refreshEventSeatsFromChart(client, params.id);
      await client.query('COMMIT');
      return NextResponse.json({ ok: true, seats: r.insertedSeats, chartId: r.chartId ?? null });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (err instanceof SeatRefreshError) return NextResponse.json({ error: err.code, message: err.message }, { status: 409 });
      throw err;
    } finally {
      client.release();
    }
  });
}
