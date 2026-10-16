/**
 * GET /api/admin/events/[id]/stream  — načti stream nastavení
 * PUT /api/admin/events/[id]/stream  — nastav / aktualizuj stream (streaming_url, provider, …)
 *
 * Auth: promotér musí být vlastníkem akce (runAsActivePromoter + RLS).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  streaming_url:          z.string().url().max(1000).nullable().optional(),
  streaming_provider:     z.enum(['youtube', 'vimeo', 'zoom', 'custom']).nullable().optional(),
  stream_chat_url:        z.string().url().max(1000).nullable().optional(),
  stream_recording_url:   z.string().url().max(1000).nullable().optional(),
  stream_replay_days:     z.number().int().min(0).max(365).optional(),
});

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    const r = await db().query<{
      streaming_url:        string | null;
      streaming_provider:   string | null;
      stream_chat_url:      string | null;
      stream_recording_url: string | null;
      stream_replay_days:   number;
      event_type:           string | null;
    }>(
      `SELECT streaming_url, streaming_provider, stream_chat_url,
              stream_recording_url, stream_replay_days, event_type
       FROM catalog.events
       WHERE id = $1 AND promoter_id = $2`,
      [params.id, promoter.promoterId],
    );

    if (r.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    return NextResponse.json({ stream: r.rows[0] });
  });
}

export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    const body   = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY', detail: parsed.error.issues }, { status: 422 });
    }

    const d = parsed.data;

    const r = await db().query(
      `UPDATE catalog.events SET
         streaming_url        = COALESCE($3, streaming_url),
         streaming_provider   = COALESCE($4, streaming_provider),
         stream_chat_url      = COALESCE($5, stream_chat_url),
         stream_recording_url = COALESCE($6, stream_recording_url),
         stream_replay_days   = COALESCE($7, stream_replay_days)
       WHERE id = $1 AND promoter_id = $2
       RETURNING id`,
      [
        params.id,
        promoter.promoterId,
        d.streaming_url     ?? null,
        d.streaming_provider ?? null,
        d.stream_chat_url   ?? null,
        d.stream_recording_url ?? null,
        d.stream_replay_days ?? null,
      ],
    );

    if ((r.rowCount ?? 0) === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  });
}
