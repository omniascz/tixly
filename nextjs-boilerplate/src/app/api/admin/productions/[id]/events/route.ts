import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';

interface EventRow {
  id: string;
  title: string;
  date_start: string;
  status: string;
}

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
      return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
    }

    const prod = await db().query<{ promoter_id: string }>(
      `SELECT promoter_id FROM catalog.productions WHERE id = $1`,
      [params.id],
    );
    if (prod.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    if (prod.rows[0].promoter_id !== promoter.promoterId) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    const r = await db().query<EventRow>(
      `SELECT id, title, date_start::text AS date_start, status
         FROM catalog.events
        WHERE production_id = $1
        ORDER BY date_start ASC`,
      [params.id],
    );
    return NextResponse.json({ events: r.rows });
  });
}

const postSchema = z.object({
  eventId: z.string().uuid(),
});

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
      return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
    }

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
    }

    const prod = await db().query<{ promoter_id: string }>(
      `SELECT promoter_id FROM catalog.productions WHERE id = $1`,
      [params.id],
    );
    if (prod.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    if (prod.rows[0].promoter_id !== promoter.promoterId) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    const ev = await db().query<{ promoter_id: string }>(
      `SELECT promoter_id FROM catalog.events WHERE id = $1`,
      [parsed.data.eventId],
    );
    if (ev.rows.length === 0) {
      return NextResponse.json({ error: 'EVENT_NOT_FOUND' }, { status: 404 });
    }
    if (ev.rows[0].promoter_id !== promoter.promoterId) {
      return NextResponse.json({ error: 'EVENT_FORBIDDEN' }, { status: 403 });
    }

    await db().query(
      `UPDATE catalog.events SET production_id = $1, updated_at = NOW() WHERE id = $2`,
      [params.id, parsed.data.eventId],
    );

    return NextResponse.json({ ok: true });
  });
}

const deleteSchema = z.object({
  eventId: z.string().uuid(),
});

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
      return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
    }

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
    }

    const prod = await db().query<{ promoter_id: string }>(
      `SELECT promoter_id FROM catalog.productions WHERE id = $1`,
      [params.id],
    );
    if (prod.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    if (prod.rows[0].promoter_id !== promoter.promoterId) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    await db().query(
      `UPDATE catalog.events
          SET production_id = NULL, updated_at = NOW()
        WHERE id = $1 AND promoter_id = $2`,
      [parsed.data.eventId, promoter.promoterId],
    );

    return NextResponse.json({ ok: true });
  });
}
