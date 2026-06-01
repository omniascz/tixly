/**
 * GET /api/admin/sales-stream
 *
 * Server-Sent Events (SSE) — real-time sales stream pro promotéra.
 *
 * Klient otevře EventSource, server posílá `data:` events každé 3 sekundy
 * s novými prodejmi a aggregated counters.
 *
 * TM Parity Fáze 3 — TM1 Sales real-time dashboard.
 *
 * Event types:
 *   - "sale" — nový prodej (order paid)
 *   - "stats" — aggregated counters per minute
 *
 * Vercel Edge function timeout: 30 min. Klient by měl reconnect při disconnect.
 */
import { NextRequest } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';


const POLL_INTERVAL_MS = 3000;
const MAX_STREAM_DURATION_MS = 25 * 60 * 1000; // 25 min — pod Vercel limit

interface SaleEvent {
  id: number;
  event_id: string;
  event_title: string;
  order_id: string;
  amount_halire: number;
  currency: string;
  ticket_count: number;
  buyer_country: string | null;
  created_at: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  const promoterId = promoter.promoterId;

  // Cursor: largest sales_stream.id sent so far
  let lastCursor = 0;
  const startedAt = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      function send(eventType: string, data: unknown) {
        const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(payload));
      }

      // Initial: send heartbeat + last 10 sales
      send('hello', { promoterId, time: new Date().toISOString() });

      try {
        const initialRes = await db().query<SaleEvent>(
          `SELECT id, event_id, event_title, order_id,
                  amount_halire, currency, ticket_count, buyer_country,
                  created_at::text
             FROM revenue.sales_stream
            WHERE promoter_id = $1
            ORDER BY id DESC
            LIMIT 10`,
          [promoterId],
        );
        // Reverse pro chronologický display
        const initial = initialRes.rows.reverse();
        for (const sale of initial) {
          send('sale', sale);
          if (sale.id > lastCursor) lastCursor = sale.id;
        }
      } catch {
        // Tabulka mohla neexistovat (migration not applied) — silent
      }

      // Stats first time
      void sendStats();

      // Polling loop
      const interval = setInterval(() => {
        void pollAndSend();
      }, POLL_INTERVAL_MS);

      const statsInterval = setInterval(() => {
        void sendStats();
      }, 30_000); // Every 30s

      // Auto-close after timeout
      const timeout = setTimeout(() => {
        clearInterval(interval);
        clearInterval(statsInterval);
        controller.close();
      }, MAX_STREAM_DURATION_MS);

      async function pollAndSend(): Promise<void> {
        if (Date.now() - startedAt > MAX_STREAM_DURATION_MS) return;
        try {
          const r = await db().query<SaleEvent>(
            `SELECT id, event_id, event_title, order_id,
                    amount_halire, currency, ticket_count, buyer_country,
                    created_at::text
               FROM revenue.sales_stream
              WHERE promoter_id = $1 AND id > $2
              ORDER BY id ASC
              LIMIT 50`,
            [promoterId, lastCursor],
          );
          for (const sale of r.rows) {
            send('sale', sale);
            if (sale.id > lastCursor) lastCursor = sale.id;
          }
        } catch {
          // ignore
        }
      }

      async function sendStats(): Promise<void> {
        try {
          const r = await db().query<{
            count_today: string;
            revenue_today: string;
            count_hour: string;
            revenue_hour: string;
          }>(
            `SELECT
               COUNT(*) FILTER (WHERE created_at >= date_trunc('day', NOW()))::text AS count_today,
               COALESCE(SUM(amount_halire) FILTER (WHERE created_at >= date_trunc('day', NOW())), 0)::text AS revenue_today,
               COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 hour')::text AS count_hour,
               COALESCE(SUM(amount_halire) FILTER (WHERE created_at >= NOW() - INTERVAL '1 hour'), 0)::text AS revenue_hour
              FROM revenue.sales_stream
             WHERE promoter_id = $1`,
            [promoterId],
          );
          if (r.rows.length > 0) {
            send('stats', {
              countToday: Number(r.rows[0].count_today),
              revenueToday: Number(r.rows[0].revenue_today),
              countHour: Number(r.rows[0].count_hour),
              revenueHour: Number(r.rows[0].revenue_hour),
            });
          }
        } catch {
          // ignore
        }
      }

      // Heartbeat každých 15s (browser keep-alive)
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(': heartbeat\n\n'));
      }, 15_000);

      // Cleanup on cancel
      req.signal.addEventListener('abort', () => {
        clearInterval(interval);
        clearInterval(statsInterval);
        clearInterval(heartbeat);
        clearTimeout(timeout);
        controller.close();
      });
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

  });
}
