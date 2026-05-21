/**
 * GET /api/cron/pricing-engine
 *
 * Vercel cron handler. Periodicky (každých 15 min) evaluuje pricing rules
 * pro každý aktivní ticket_type a aplikuje nové ceny pokud se změnily.
 *
 * Authorization: x-vercel-cron header (Vercel auto-injects). Pro lokální
 * testování přidat header `x-cron-secret: $CRON_SECRET`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { evaluatePricing, applyPricing } from '@/lib/pricing/rules-engine';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest): Promise<Response> {
  // Vercel cron sends x-vercel-cron header
  const isVercelCron = req.headers.get('x-vercel-cron') !== null;
  const secret = req.headers.get('x-cron-secret');
  if (!isVercelCron && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  // Najdi všechny aktivní ticket_types z events s datum_start v budoucnosti
  // nebo recently active (last 24h).
  const ticketTypes = await db().query<{ id: string; event_id: string }>(
    `SELECT tt.id, tt.event_id
       FROM catalog.ticket_types tt
       JOIN catalog.events e ON e.id = tt.event_id
      WHERE tt.visibility = 'public'
        AND tt.remaining_qty > 0
        AND e.date_start > now() - INTERVAL '24 hours'
      LIMIT 5000`,
  );

  const results = {
    evaluated: 0,
    changed: 0,
    errors: 0,
    samples: [] as { ticketTypeId: string; oldPrice?: number; newPrice: number; sources: string[] }[],
  };

  for (const tt of ticketTypes.rows) {
    try {
      const evalResult = await evaluatePricing(tt.id);
      const apply = await applyPricing(tt.id, evalResult, null);
      results.evaluated++;
      if (apply.changed) {
        results.changed++;
        if (results.samples.length < 20) {
          results.samples.push({
            ticketTypeId: tt.id,
            newPrice: evalResult.finalPrice,
            sources: evalResult.sources.map((s) => `${s.source}: ${s.description}`),
          });
        }
      }
    } catch (e) {
      results.errors++;
      console.error('[pricing-engine] error for tt', tt.id, e);
    }
  }

  return NextResponse.json({
    ok: true,
    runAt: new Date().toISOString(),
    ...results,
  });
}
