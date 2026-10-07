/**
 * GET /api/queue/[eventId]/status/[token]
 *
 * Vrátí position v queue, ETA, status.
 *
 * Side-effect: zároveň "admit-on-poll" — když je free slot a tento token je top-of-queue,
 * povýšíme ho na 'admitted'. Tohle by v produkci dělal cron / Redis worker, v demu je
 * to OK na poll endpointu (volá se každé 2-3 s z UI).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import {
  redisAvailable,
  getQueueStatusRedis,
  admitNextRedis,
  getActiveCountRedis,
} from '@/lib/queue/redis-queue';


const ADMISSION_TTL_MIN = 10;

interface TokenRow {
  id: string;
  event_id: string;
  status: string;
  joined_at: string;
  admitted_at: string | null;
  expires_at: string | null;
  queue_max_concurrent: number;
  queue_mode: string;
  draw_seed: number;
}

export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ eventId: string; token: string }> }
): Promise<Response> {
  const params = await props.params;
  return runWithServiceContext(async () => {

  if (!/^[0-9a-f-]{36}$/i.test(params.token) || !/^[0-9a-f-]{36}$/i.test(params.eventId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
  }

  const r = await db().query<TokenRow>(
    `SELECT t.id, t.event_id, t.status, t.joined_at, t.admitted_at, t.expires_at,
            t.draw_seed, e.queue_max_concurrent, e.queue_mode
     FROM platform.queue_tokens t
     JOIN catalog.events e ON e.id = t.event_id
     WHERE t.id = $1 AND t.event_id = $2`,
    [params.token, params.eventId],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'Token not found' }, { status: 404 });
  }
  const token = r.rows[0];
  const isRandom = token.queue_mode === 'random';

  // Try Redis fast-path — pouze pro FIFO. Random mód řadí dle draw_seed v DB
  // (Redis udržuje jen FCFS pořadí), proto pro random jdeme přímo DB cestou.
  try {
    if (!isRandom && (await redisAvailable())) {
      const rs = await getQueueStatusRedis(params.eventId, params.token);
      if (rs.status === 'admitted') {
        // Sync DB pokud ještě není
        if (token.status !== 'admitted') {
          await db().query(
            `UPDATE platform.queue_tokens
             SET status = 'admitted', admitted_at = NOW(),
                 expires_at = to_timestamp($2 / 1000.0)
             WHERE id = $1 AND status = 'waiting'`,
            [params.token, rs.expiresAt ?? Date.now() + 600_000],
          );
        }
        return NextResponse.json({
          status: 'admitted',
          admittedAt: token.admitted_at ?? new Date().toISOString(),
          expiresAt: new Date(rs.expiresAt ?? Date.now() + 600_000).toISOString(),
          message: 'Můžeš přejít do checkoutu.',
          source: 'redis',
        });
      }
      if (rs.status === 'waiting' && rs.position !== undefined) {
        // Try admit-on-poll via Redis
        const active = await getActiveCountRedis(params.eventId);
        const slotsFree = token.queue_max_concurrent - active;
        if (slotsFree > 0 && rs.position <= slotsFree) {
          const admitted = await admitNextRedis(
            params.eventId,
            Math.min(slotsFree, rs.position),
            600,
          );
          if (admitted.includes(params.token)) {
            await db().query(
              `UPDATE platform.queue_tokens
               SET status = 'admitted', admitted_at = NOW(),
                   expires_at = NOW() + INTERVAL '10 minutes'
               WHERE id = $1 AND status = 'waiting'`,
              [params.token],
            );
            return NextResponse.json({
              status: 'admitted',
              admittedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 600_000).toISOString(),
              message: 'Můžeš přejít do checkoutu.',
              source: 'redis',
            });
          }
        }
        const etaSeconds = Math.max(0, (rs.position - slotsFree) * 5);
        return NextResponse.json({
          status: 'waiting',
          position: rs.position,
          ahead: rs.ahead ?? rs.position - 1,
          activeBuyers: active,
          maxConcurrent: token.queue_max_concurrent,
          etaSeconds,
          source: 'redis',
          // Transparentní fér fronta — fanoušek vidí pravidlo i svůj auditovatelný klíč.
          fairness: {
            mode: 'fifo',
            rule: 'Pořadí striktně podle času příchodu do fronty — kdo dřív přišel, jde dřív. Žádné skryté priority.',
            yourJoinedAt: token.joined_at,
            botProtection: true,
          },
        });
      }
    }
  } catch (err) {
    console.error('[queue status] redis path failed, falling back to DB', err);
  }
  // Fallback: DB-based path (Phase H.1, original)

  // Already admitted? Check TTL.
  if (token.status === 'admitted') {
    const expired = token.expires_at && new Date(token.expires_at).getTime() < Date.now();
    if (expired) {
      await db().query(
        `UPDATE platform.queue_tokens SET status = 'expired' WHERE id = $1 AND status = 'admitted'`,
        [token.id],
      );
      return NextResponse.json({
        status: 'expired',
        message: 'Slot v queue vypršel — připoj se znovu.',
      });
    }
    return NextResponse.json({
      status: 'admitted',
      admittedAt: token.admitted_at,
      expiresAt: token.expires_at,
      message: 'Můžeš přejít do checkoutu.',
    });
  }

  if (token.status === 'completed' || token.status === 'cancelled' || token.status === 'expired') {
    return NextResponse.json({ status: token.status });
  }

  // Status='waiting': spočítej position + zkus admit-on-poll.
  // Random mód (AXS "Fair AXS"): pořadí dle draw_seed (čas příchodu nerozhoduje),
  // tie-break joined_at. FIFO: dle joined_at.
  const aheadCount = isRandom
    ? await db().query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM platform.queue_tokens
         WHERE event_id = $1 AND status = 'waiting'
           AND (draw_seed < $2 OR (draw_seed = $2 AND joined_at < $3))`,
        [token.event_id, token.draw_seed, token.joined_at],
      )
    : await db().query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM platform.queue_tokens
         WHERE event_id = $1 AND status = 'waiting' AND joined_at < $2`,
        [token.event_id, token.joined_at],
      );
  const position = Number(aheadCount.rows[0]?.count ?? 0) + 1;

  const activeCount = await db().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM platform.queue_tokens
     WHERE event_id = $1 AND status = 'admitted'
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [token.event_id],
  );
  const active = Number(activeCount.rows[0]?.count ?? 0);
  const slotsFree = token.queue_max_concurrent - active;

  // Můžu být admitnut?
  if (slotsFree > 0 && position <= slotsFree) {
    const upd = await db().query<{ id: string; admitted_at: string; expires_at: string }>(
      `UPDATE platform.queue_tokens
       SET status = 'admitted',
           admitted_at = NOW(),
           expires_at = NOW() + INTERVAL '${ADMISSION_TTL_MIN} minutes'
       WHERE id = $1 AND status = 'waiting'
       RETURNING id, admitted_at, expires_at`,
      [token.id],
    );
    if (upd.rows.length > 0) {
      return NextResponse.json({
        status: 'admitted',
        admittedAt: upd.rows[0].admitted_at,
        expiresAt: upd.rows[0].expires_at,
        message: 'Můžeš přejít do checkoutu.',
      });
    }
  }

  // Stále čekáš
  const etaSeconds = Math.max(0, (position - slotsFree) * 5);

  // Transparentní fér fronta — celkový počet čekajících + auditovatelné pravidlo pořadí.
  const totalWaitingRes = await db().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM platform.queue_tokens
     WHERE event_id = $1 AND status = 'waiting'`,
    [token.event_id],
  );
  const totalWaiting = Number(totalWaitingRes.rows[0]?.count ?? 0);
  const fairness = isRandom
    ? {
        mode: 'random' as const,
        rule: 'Férové losování: každý dostal náhodné číslo losu, nižší číslo jde dřív. Čas příchodu nerozhoduje — přijít v první vteřině nezvýhodňuje.',
        yourDrawNumber: token.draw_seed,
        botProtection: true,
      }
    : {
        mode: 'fifo' as const,
        rule: 'Pořadí striktně podle času příchodu do fronty — kdo dřív přišel, jde dřív. Žádné skryté priority.',
        yourJoinedAt: token.joined_at,
        botProtection: true,
      };

  return NextResponse.json({
    status: 'waiting',
    position,
    ahead: position - 1,
    totalWaiting,
    activeBuyers: active,
    maxConcurrent: token.queue_max_concurrent,
    etaSeconds,
    fairness,
  });

  });
}
