/**
 * GET /api/events/[id]/seats/stream
 *
 * Server-Sent Events stream pro real-time updates dostupnosti sedadel.
 *
 * Protokol:
 *   event: snapshot   → { seats: [{id, status}] }  (initial full state)
 *   event: delta      → { seats: [{id, status}] }  (změny od poslední zprávy)
 *   event: ping       → keepalive (každých 25 s)
 *
 * Strategie: polling event_seats každé 2 s, push jen seaty s updated_at > lastSeen.
 * Také interpretuje hold_until <= NOW() jako 'available' (auto-expire holdy).
 *
 * Disconnect: req.signal.aborted → cleanup interval.
 */

import { NextRequest } from 'next/server';
import { db } from '@/lib/db/rls-pool';


const POLL_MS = 2000;
const PING_MS = 25_000;
const MAX_STREAM_MS = 30 * 60 * 1000; // 30 min max

interface SeatRow {
  id: string;
  status: string;
  updated_at: string;
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return new Response('Invalid id', { status: 422 });
  }
  const eventDayId = req.nextUrl.searchParams.get('eventDayId');

  const args: unknown[] = [params.id];
  let dayClause = `AND event_day_id IS NULL`;
  if (eventDayId) {
    if (!/^[0-9a-f-]{36}$/i.test(eventDayId)) {
      return new Response('Invalid eventDayId', { status: 422 });
    }
    args.push(eventDayId);
    dayClause = `AND (event_day_id = $2 OR event_day_id IS NULL)`;
  }

  const encoder = new TextEncoder();
  let lastSeen = new Date(0).toISOString();
  let lastSent = Date.now();
  const startedAt = Date.now();

  function effectiveStatus(row: { status: string; hold_until: string | null }): string {
    if (row.status === 'held' && row.hold_until && new Date(row.hold_until).getTime() <= Date.now()) {
      return 'available';
    }
    return row.status;
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const close = (): void => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      req.signal.addEventListener('abort', close);

      try {
        // Initial snapshot
        const init = await db().query<{
          id: string;
          status: string;
          hold_until: string | null;
          updated_at: string;
        }>(
          `SELECT id, status, hold_until, updated_at
           FROM catalog.event_seats
           WHERE event_id = $1 ${dayClause}`,
          args,
        );
        const snapshot = init.rows.map((r) => ({ id: r.id, status: effectiveStatus(r) }));
        const maxUpdated = init.rows.reduce(
          (m, r) => (r.updated_at > m ? r.updated_at : m),
          lastSeen,
        );
        lastSeen = maxUpdated;
        controller.enqueue(encoder.encode(sseEvent('snapshot', { seats: snapshot })));
        lastSent = Date.now();
      } catch (err) {
        controller.enqueue(
          encoder.encode(sseEvent('error', { message: (err as Error).message })),
        );
        close();
        return;
      }

      const poll = async (): Promise<void> => {
        if (closed) return;
        if (Date.now() - startedAt > MAX_STREAM_MS) {
          controller.enqueue(encoder.encode(sseEvent('end', { reason: 'max_duration' })));
          close();
          return;
        }
        try {
          const res = await db().query<SeatRow & { hold_until: string | null }>(
            `SELECT id, status, hold_until, updated_at
             FROM catalog.event_seats
             WHERE event_id = $1 ${dayClause} AND updated_at > $${args.length + 1}`,
            [...args, lastSeen],
          );
          if (res.rows.length > 0) {
            const delta = res.rows.map((r) => ({ id: r.id, status: effectiveStatus(r) }));
            const maxUpdated = res.rows.reduce(
              (m, r) => (r.updated_at > m ? r.updated_at : m),
              lastSeen,
            );
            lastSeen = maxUpdated;
            controller.enqueue(encoder.encode(sseEvent('delta', { seats: delta })));
            lastSent = Date.now();
          } else if (Date.now() - lastSent > PING_MS) {
            controller.enqueue(encoder.encode(`event: ping\ndata: {}\n\n`));
            lastSent = Date.now();
          }
        } catch (err) {
          controller.enqueue(
            encoder.encode(sseEvent('error', { message: (err as Error).message })),
          );
        }
        if (!closed) setTimeout(() => void poll(), POLL_MS);
      };

      setTimeout(() => void poll(), POLL_MS);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
