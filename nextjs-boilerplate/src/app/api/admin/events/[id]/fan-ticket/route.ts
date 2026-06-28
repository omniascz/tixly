/**
 * GET  /api/admin/events/[id]/fan-ticket  — načíst nastavení Fan Ticket
 * PATCH /api/admin/events/[id]/fan-ticket — uložit nastavení (enabled, artwork_url)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const r = await runWithServiceContext(() =>
      db().query(
        `SELECT fan_ticket_enabled, fan_artwork_url
         FROM catalog.events WHERE id=$1 AND promoter_id=$2 LIMIT 1`,
        [params.id, ctx.promoterId],
      ),
    );
    if (r.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(r.rows[0]);
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const b = await req.json() as {
      fan_ticket_enabled?: boolean;
      fan_artwork_url?: string | null;
    };

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (b.fan_ticket_enabled !== undefined) {
      fields.push(`fan_ticket_enabled=$${i++}`);
      values.push(b.fan_ticket_enabled);
    }
    if ('fan_artwork_url' in b) {
      fields.push(`fan_artwork_url=$${i++}`);
      values.push(b.fan_artwork_url ?? null);
    }

    if (fields.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

    values.push(params.id, ctx.promoterId);
    const r = await runWithServiceContext(() =>
      db().query(
        `UPDATE catalog.events SET ${fields.join(',')}
         WHERE id=$${i} AND promoter_id=$${i + 1}
         RETURNING fan_ticket_enabled, fan_artwork_url`,
        values,
      ),
    );

    if (r.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(r.rows[0]);
  });
}
