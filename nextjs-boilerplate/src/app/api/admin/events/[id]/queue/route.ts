/**
 * GET  /api/admin/events/[id]/queue  → stats + token list
 * PATCH /api/admin/events/[id]/queue → toggle queue_enabled, set max_concurrent
 * POST /api/admin/events/[id]/queue  → admit next N tokens
 */
import { NextRequest, NextResponse } from 'next/server';
import { runAsPromoter } from '@/lib/admin-auth';
import { db } from '@/lib/db/rls-pool';
import { z } from 'zod';
import { redisAvailable, admitNextRedis } from '@/lib/queue/redis-queue';

interface QueueToken {
  id: string;
  user_id: string | null;
  user_email: string | null;
  fingerprint: string | null;
  status: string;
  joined_at: string;
  admitted_at: string | null;
  expires_at: string | null;
}

interface EventRow {
  id: string;
  title: string;
  queue_enabled: boolean;
  queue_max_concurrent: number;
  queue_mode: string;
  promoter_id: string;
}

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsPromoter(req, async (ctx) => {
    const evR = await db().query<EventRow>(
      `SELECT id, title, queue_enabled, queue_max_concurrent, queue_mode, promoter_id
       FROM catalog.events WHERE id = $1`,
      [params.id],
    );
    const ev = evR.rows[0];
    if (!ev) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (ev.promoter_id !== ctx.promoterId)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const [waitingR, activeR, recentR] = await Promise.all([
      db().query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM platform.queue_tokens
         WHERE event_id = $1 AND status = 'waiting'`,
        [params.id],
      ),
      db().query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM platform.queue_tokens
         WHERE event_id = $1 AND status = 'admitted'
           AND (expires_at IS NULL OR expires_at > NOW())`,
        [params.id],
      ),
      db().query<QueueToken>(
        `SELECT t.id, t.user_id, u.email AS user_email, t.fingerprint,
                t.status, t.joined_at, t.admitted_at, t.expires_at
         FROM platform.queue_tokens t
         LEFT JOIN identity.users u ON u.id = t.user_id
         WHERE t.event_id = $1
         ORDER BY
           CASE t.status WHEN 'waiting' THEN 0 WHEN 'admitted' THEN 1 ELSE 2 END,
           t.joined_at ASC
         LIMIT 200`,
        [params.id],
      ),
    ]);

    const waiting = Number(waitingR.rows[0]?.count ?? 0);
    const active  = Number(activeR.rows[0]?.count ?? 0);

    return NextResponse.json({
      eventId: ev.id,
      eventTitle: ev.title,
      queueEnabled: ev.queue_enabled,
      maxConcurrent: ev.queue_max_concurrent,
      queueMode: ev.queue_mode,
      waiting,
      active,
      slotsAvailable: Math.max(0, ev.queue_max_concurrent - active),
      estimatedWaitSeconds: waiting > 0 ? waiting * 5 : 0,
      tokens: recentR.rows.map((t) => ({
        id: t.id,
        email: t.user_email ?? (t.fingerprint ? t.fingerprint.slice(0, 8) + '…' : '—'),
        status: t.status,
        joinedAt: t.joined_at,
        admittedAt: t.admitted_at,
        expiresAt: t.expires_at,
      })),
    });
  });
}

const patchSchema = z.object({
  queueEnabled:  z.boolean().optional(),
  maxConcurrent: z.number().int().min(1).max(5000).optional(),
  queueMode:     z.enum(['fifo', 'random']).optional(),
});

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsPromoter(req, async (ctx) => {
    const evR = await db().query<{ promoter_id: string }>(
      `SELECT promoter_id FROM catalog.events WHERE id = $1`,
      [params.id],
    );
    if (!evR.rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (evR.rows[0].promoter_id !== ctx.promoterId)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 422 });

    const updates: string[] = [];
    const vals: unknown[] = [params.id];

    if (parsed.data.queueEnabled !== undefined) {
      vals.push(parsed.data.queueEnabled);
      updates.push(`queue_enabled = $${vals.length}`);
    }
    if (parsed.data.maxConcurrent !== undefined) {
      vals.push(parsed.data.maxConcurrent);
      updates.push(`queue_max_concurrent = $${vals.length}`);
    }
    if (parsed.data.queueMode !== undefined) {
      vals.push(parsed.data.queueMode);
      updates.push(`queue_mode = $${vals.length}`);
    }

    if (updates.length > 0) {
      await db().query(`UPDATE catalog.events SET ${updates.join(', ')} WHERE id = $1`, vals);
    }

    return NextResponse.json({ ok: true });
  });
}

const admitSchema = z.object({ count: z.number().int().min(1).max(500).default(10) });

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsPromoter(req, async (ctx) => {
    const evR = await db().query<{ promoter_id: string }>(
      `SELECT promoter_id FROM catalog.events WHERE id = $1`,
      [params.id],
    );
    if (!evR.rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (evR.rows[0].promoter_id !== ctx.promoterId)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = admitSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 422 });

    let redisAdmitted: string[] = [];
    if (await redisAvailable()) {
      redisAdmitted = await admitNextRedis(params.id, parsed.data.count, 600);
    }

    const r = await db().query<{ id: string }>(
      `UPDATE platform.queue_tokens
       SET status = 'admitted',
           admitted_at = NOW(),
           expires_at = NOW() + INTERVAL '10 minutes'
       WHERE id IN (
         SELECT id FROM platform.queue_tokens
         WHERE event_id = $1 AND status = 'waiting'
         ORDER BY joined_at ASC
         LIMIT $2
       )
       RETURNING id`,
      [params.id, parsed.data.count],
    );

    const allAdmitted = [...new Set([...redisAdmitted, ...r.rows.map((x) => x.id)])];
    return NextResponse.json({ ok: true, admitted: allAdmitted.length });
  });
}
