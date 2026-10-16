/**
 * GET /api/cron/pricing-engine
 *
 * Vercel cron handler. Periodicky (každých 15 min) evaluuje pricing rules
 * pro každý aktivní ticket_type a aplikuje nové ceny pokud se změnily.
 *
 * Authorization: `Authorization: Bearer $CRON_SECRET` (Vercel cron) nebo
 * `x-cron-secret: $CRON_SECRET`. Hlavička x-vercel-cron se NEUZNÁVÁ (podvrhnutelná).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { isCronAuthorized } from '@/lib/security/cron-auth';
import { evaluatePricing, applyPricing } from '@/lib/pricing/rules-engine';


export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {

  // Kolo 2: `x-vercel-cron` pošle kdokoli → dřív stačilo k běhu cronu bez tajemství.
  if (!isCronAuthorized(req)) {
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

  });
}
