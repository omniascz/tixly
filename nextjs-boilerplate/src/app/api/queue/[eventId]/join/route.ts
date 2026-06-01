/**
 * POST /api/queue/[eventId]/join
 *
 * Body: { fingerprint?: string }
 *
 * Buyer dorazí na akci s `queue_enabled=true` → musí přes virtual queue.
 * Vrátí token, position v queue, ETA.
 *
 * Idempotence per (event, user_id) AND per (event, fingerprint) — neúmyslné dvojité klikání
 * nevytvoří 2 tokeny.
 *
 * Pokud queue_enabled=false → vrátí null token (frontend pojede přímo na checkout).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { z } from 'zod';
import { detectBot, logDetection } from '@/lib/bot-detection/detect';
import { redisAvailable, joinQueueRedis } from '@/lib/queue/redis-queue';


const schema = z.object({
  fingerprint: z.string().min(8).max(128).optional(),
  // Honeypot — frontend nesmí nikdy vyplnit. Boti vyplní vše.
  hp_field: z.string().optional(),
  formStartedAt: z.number().int().optional(),
});

interface EventRow {
  id: string;
  queue_enabled: boolean;
  queue_max_concurrent: number;
  status: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { eventId: string } },
): Promise<Response> {
  return runWithServiceContext(async () => {

  if (!/^[0-9a-f-]{36}$/i.test(params.eventId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
  }
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 422 });
  }
  const userId = req.headers.get('x-user-id');
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const fingerprint = parsed.data.fingerprint ?? null;
  const userAgent = req.headers.get('user-agent') ?? '';

  // Bot detection gate
  const decision = await detectBot({
    honeypot: parsed.data.hp_field,
    formStartedAt: parsed.data.formStartedAt,
    fingerprint: fingerprint ?? undefined,
    ip: ip ?? undefined,
    userAgent,
  });
  if (decision.action !== 'pass') {
    await logDetection(decision, {
      eventId: params.eventId,
      userId: userId ?? undefined,
      fingerprint: fingerprint ?? undefined,
      ip: ip ?? undefined,
    });
    if (decision.action === 'block') {
      return NextResponse.json(
        { error: 'BLOCKED', reason: decision.reason },
        { status: 403 },
      );
    }
    if (decision.action === 'captcha_required') {
      return NextResponse.json(
        { error: 'CAPTCHA_REQUIRED', reason: decision.reason },
        { status: 429 },
      );
    }
    // rate_limit → 429
    if (decision.action === 'rate_limit') {
      return NextResponse.json(
        { error: 'RATE_LIMITED', reason: decision.reason },
        { status: 429 },
      );
    }
  }

  const ev = await db().query<EventRow>(
    `SELECT id, queue_enabled, queue_max_concurrent, status
     FROM catalog.events WHERE id = $1`,
    [params.eventId],
  );
  if (ev.rows.length === 0 || ev.rows[0].status !== 'published') {
    return NextResponse.json({ error: 'Event not available' }, { status: 404 });
  }
  const event = ev.rows[0];

  if (!event.queue_enabled) {
    return NextResponse.json({ queueEnabled: false, token: null });
  }

  // Idempotence: vrať existující token pokud je in queue
  if (userId) {
    const existing = await db().query<{ id: string; status: string }>(
      `SELECT id, status FROM platform.queue_tokens
       WHERE event_id = $1 AND user_id = $2
         AND status IN ('waiting', 'admitted')
       ORDER BY joined_at DESC LIMIT 1`,
      [event.id, userId],
    );
    if (existing.rows.length > 0) {
      return NextResponse.json({
        queueEnabled: true,
        token: existing.rows[0].id,
        existing: true,
      });
    }
  } else if (fingerprint) {
    const existing = await db().query<{ id: string }>(
      `SELECT id FROM platform.queue_tokens
       WHERE event_id = $1 AND fingerprint = $2
         AND status IN ('waiting', 'admitted')
       ORDER BY joined_at DESC LIMIT 1`,
      [event.id, fingerprint],
    );
    if (existing.rows.length > 0) {
      return NextResponse.json({
        queueEnabled: true,
        token: existing.rows[0].id,
        existing: true,
      });
    }
  }

  const r = await db().query<{ id: string }>(
    `INSERT INTO platform.queue_tokens (event_id, user_id, fingerprint, ip)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [event.id, userId, fingerprint, ip],
  );
  const tokenId = r.rows[0].id;

  // Mirror do Redis pokud dostupný (best-effort, DB stále zdroj pravdy)
  try {
    if (await redisAvailable()) {
      await joinQueueRedis(event.id, tokenId);
    }
  } catch (err) {
    console.error('[queue join] redis mirror failed', err);
  }

  return NextResponse.json({
    queueEnabled: true,
    token: tokenId,
    existing: false,
  });

  });
}
