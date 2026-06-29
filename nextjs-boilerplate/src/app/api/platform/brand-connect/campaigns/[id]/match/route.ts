/**
 * POST /api/platform/brand-connect/campaigns/[id]/match
 *
 * Auto-match: najde budoucí akce odpovídající targetingu kampaně
 * a vytvoří 'proposed' event_partnership pro každou.
 *
 * Body (optional): { event_ids: string[] } pro manuální výběr.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPlatformAdmin } from '@/lib/platform-auth';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPlatformAdmin(req, async () => {
    const body = await req.json().catch(() => ({})) as { event_ids?: string[] };

    const campR = await db().query(
      `SELECT c.*, a.company_name
       FROM brands.campaigns c
       JOIN brands.advertisers a ON a.id = c.advertiser_id
       WHERE c.id = $1`,
      [params.id],
    );

    if (campR.rows.length === 0) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    const camp = campR.rows[0] as {
      id: string; name: string; status: string;
      fee_per_event_czk: number; tixly_cut_pct: number;
      target_event_categories: string[] | null;
      target_cities: string[] | null;
      target_min_capacity: number | null;
      budget_czk: number | null; budget_spent_czk: number;
    };

    if (camp.status !== 'active') {
      return NextResponse.json({ error: 'Campaign must be active to match' }, { status: 400 });
    }

    if (camp.budget_czk != null && camp.budget_spent_czk >= camp.budget_czk) {
      return NextResponse.json({ error: 'Campaign budget exhausted' }, { status: 400 });
    }

    let eventIds: string[] = body.event_ids ?? [];

    if (eventIds.length === 0) {
      const conditions: string[] = [
        `e.status = 'published'`,
        `e.date_start > NOW()`,
        `NOT EXISTS (
           SELECT 1 FROM brands.event_partnerships ep
           WHERE ep.campaign_id = $1 AND ep.event_id = e.id
             AND ep.status NOT IN ('declined','expired','cancelled')
         )`,
      ];
      const queryParams: unknown[] = [camp.id];

      if (camp.target_event_categories?.length) {
        queryParams.push(camp.target_event_categories);
        conditions.push(`e.event_type = ANY($${queryParams.length}::text[])`);
      }
      if (camp.target_cities?.length) {
        queryParams.push(camp.target_cities);
        conditions.push(`v.city ILIKE ANY($${queryParams.length}::text[])`);
      }
      if (camp.target_min_capacity) {
        queryParams.push(camp.target_min_capacity);
        conditions.push(`v.capacity >= $${queryParams.length}`);
      }

      const eventsR = await db().query(
        `SELECT e.id FROM catalog.events e
         LEFT JOIN catalog.venues v ON v.id = e.venue_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY e.date_start ASC LIMIT 50`,
        queryParams,
      );
      eventIds = (eventsR.rows as Array<{ id: string }>).map((r) => r.id);
    }

    if (eventIds.length === 0) {
      return NextResponse.json({ ok: true, proposed: 0, message: 'No matching events found' });
    }

    const tixlyFee = Math.round(camp.fee_per_event_czk * (camp.tixly_cut_pct / 100));
    const promoterFee = camp.fee_per_event_czk - tixlyFee;
    let proposed = 0;

    for (const eventId of eventIds) {
      const prR = await db().query(
        `SELECT promoter_id FROM catalog.events WHERE id=$1 LIMIT 1`,
        [eventId],
      );
      if (prR.rows.length === 0) continue;
      const promoterId = (prR.rows[0] as { promoter_id: string }).promoter_id;

      await db().query(
        `INSERT INTO brands.event_partnerships
           (campaign_id, event_id, promoter_id, status, fee_czk, tixly_fee_czk,
            expires_at, placement)
         VALUES ($1,$2,$3,'proposed',$4,$5, NOW() + INTERVAL '14 days', '{"order_confirmation"}')
         ON CONFLICT (campaign_id, event_id) DO UPDATE SET
           status = CASE
             WHEN brands.event_partnerships.status IN ('declined','expired','cancelled') THEN 'proposed'
             ELSE brands.event_partnerships.status
           END,
           proposed_at = CASE
             WHEN brands.event_partnerships.status IN ('declined','expired','cancelled') THEN NOW()
             ELSE brands.event_partnerships.proposed_at
           END,
           expires_at = CASE
             WHEN brands.event_partnerships.status IN ('declined','expired','cancelled')
             THEN NOW() + INTERVAL '14 days'
             ELSE brands.event_partnerships.expires_at
           END`,
        [camp.id, eventId, promoterId, promoterFee, tixlyFee],
      );
      proposed++;
    }

    return NextResponse.json({ ok: true, proposed });
  });
}
