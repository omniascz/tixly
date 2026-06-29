/**
 * POST /api/internal/pricing/recalculate
 *
 * Spustí přepočet dynamických cen pro všechny akce s aktivním DP,
 * nebo pro konkrétní event (?event_id=...).
 *
 * Chráněno CRON_SECRET (nebo volitelně konkrétním event_id pro admin manuální trigger).
 * Vercel cron: crontab entry v vercel.json nebo manuálně.
 */

import { NextRequest, NextResponse } from 'next/server';
import { runWithServiceContext, db } from '@/lib/db/rls-pool';
import { recalculateEvent } from '@/lib/pricing/dynamic-engine';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');

  // Accept either CRON_SECRET token or internal x-internal-token
  const internalToken = req.headers.get('x-internal-token');
  const isAuthorized =
    (cronSecret && authHeader === `Bearer ${cronSecret}`) ||
    (internalToken && internalToken === process.env.INTERNAL_API_SECRET);

  if (!isAuthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const specificEventId = req.nextUrl.searchParams.get('event_id');

  // Get events that need recalculation
  let eventIds: string[];

  if (specificEventId) {
    eventIds = [specificEventId];
  } else {
    // Find all future events with dynamic_pricing_enabled and at least one rule
    const eventsR = await runWithServiceContext(() =>
      db().query(
        `SELECT DISTINCT e.id
         FROM catalog.events e
         JOIN pricing.dynamic_pricing_rules r ON r.event_id = e.id AND r.is_active = true
         WHERE e.dynamic_pricing_enabled = true
           AND e.status = 'published'
           AND e.date_start > NOW()
           AND e.date_start < NOW() + INTERVAL '90 days'
         ORDER BY e.id`,
        [],
      ),
    );
    eventIds = (eventsR.rows as Array<{ id: string }>).map((r) => r.id);
  }

  if (eventIds.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, results: [] });
  }

  const results: Array<{
    event_id: string;
    updated: number;
    demand_score: number;
    error?: string;
  }> = [];

  for (const eventId of eventIds) {
    try {
      const { updated, metrics } = await recalculateEvent(eventId);
      results.push({ event_id: eventId, updated, demand_score: metrics.demand_score });
    } catch (err) {
      console.error(`[pricing/recalculate] event ${eventId}:`, err);
      results.push({
        event_id: eventId,
        updated: 0,
        demand_score: 0,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  const totalUpdated = results.reduce((s, r) => s + r.updated, 0);
  console.log(`[pricing/recalculate] ${eventIds.length} events, ${totalUpdated} ticket types updated`);

  return NextResponse.json({
    ok: true,
    processed: eventIds.length,
    total_updated: totalUpdated,
    results,
  });
}
