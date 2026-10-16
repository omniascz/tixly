/**
 * POST /api/internal/cron/expire-date-holds
 *
 * Opce s prošlou lhůtou označí jako propadlé a posune pořadí — druhá v řadě
 * se stane první. Bez toho by termín držel někdo, kdo se neozval, a další
 * zájemce by čekal navždy.
 *
 * Spouštět jednou za hodinu; lhůty se počítají na dny, minuta sem tam nevadí.
 */

import { NextRequest, NextResponse } from 'next/server';
import { reorderAfterRelease, type DateHold } from '@/lib/booking/date-holds';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { verifyInternalToken } from '@/lib/internal-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  const auth = verifyInternalToken(req.headers.get('x-internal-token'));
  if (!auth.ok) {
    console.error('[expire-date-holds] odmítnuto:', auth.reason);
    return NextResponse.json({ error: 'Forbidden', reason: auth.reason }, { status: 403 });
  }

  return runWithServiceContext(async () => {
    // Nejdřív zjistíme, které opce propadly — potřebujeme vědět, na kterých
    // termínech pak přepočítat pořadí.
    const expired = await db().query<{ id: string; venue_id: string; hold_date: string }>(
      `UPDATE catalog.venue_date_holds
       SET status = 'expired', updated_at = NOW()
       WHERE status = 'held' AND expires_at IS NOT NULL AND expires_at < NOW()
       RETURNING id, venue_id, hold_date::text AS hold_date`,
    );

    const promoted: string[] = [];
    const seen = new Set<string>();

    for (const e of expired.rows) {
      const key = `${e.venue_id}|${e.hold_date}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const siblings = await db().query<{ id: string; option_rank: number; status: string }>(
        `SELECT id, option_rank, status
         FROM catalog.venue_date_holds
         WHERE venue_id = $1 AND hold_date = $2::date`,
        [e.venue_id, e.hold_date],
      );

      const changes = reorderAfterRelease(
        siblings.rows.map(
          (h): DateHold => ({
            id: h.id,
            optionRank: h.option_rank,
            status: h.status as DateHold['status'],
          }),
        ),
      );

      for (const c of changes) {
        await db().query(
          `UPDATE catalog.venue_date_holds SET option_rank = $2, updated_at = NOW() WHERE id = $1`,
          [c.id, c.toRank],
        );
        if (c.becamePrimary) promoted.push(c.id);
      }
    }

    return NextResponse.json({
      expiredCount: expired.rows.length,
      /** Opce, které se posunuly na první místo — jejich držitelům se má ozvat. */
      promotedToPrimary: promoted,
      ts: new Date().toISOString(),
    });
  });
}
