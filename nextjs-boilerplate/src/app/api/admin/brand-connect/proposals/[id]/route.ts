/**
 * PATCH /api/admin/brand-connect/proposals/[id]
 * Body: { action: 'accept' | 'decline' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (ctx) => {
    const b = await req.json() as { action: 'accept' | 'decline' };
    if (!['accept','decline'].includes(b.action)) {
      return NextResponse.json({ error: "action must be 'accept' or 'decline'" }, { status: 400 });
    }

    // Verify ownership + status
    const r = await db().query(
      `SELECT ep.id, ep.status, ep.campaign_id, c.budget_czk, c.budget_spent_czk, c.fee_per_event_czk
       FROM brands.event_partnerships ep
       JOIN brands.campaigns c ON c.id = ep.campaign_id
       WHERE ep.id = $1 AND ep.promoter_id = $2`,
      [params.id, ctx.promoterId],
    );

    if (r.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const ep = r.rows[0] as {
      id: string; status: string; campaign_id: string;
      budget_czk: number | null; budget_spent_czk: number; fee_per_event_czk: number;
    };

    if (ep.status !== 'proposed') {
      return NextResponse.json({ error: `Cannot ${b.action} a ${ep.status} proposal` }, { status: 409 });
    }

    if (b.action === 'accept') {
      // Budget guard
      if (ep.budget_czk != null && ep.budget_spent_czk + ep.fee_per_event_czk > ep.budget_czk) {
        return NextResponse.json({ error: 'Campaign budget exhausted' }, { status: 409 });
      }

      await db().query(
        `UPDATE brands.event_partnerships
         SET status = 'accepted', responded_at = NOW(), activated_at = NOW()
         WHERE id = $1`,
        [params.id],
      );

      // Update campaign stats
      await db().query(
        `UPDATE brands.campaigns
         SET total_partnerships = total_partnerships + 1,
             budget_spent_czk = budget_spent_czk + fee_per_event_czk,
             updated_at = NOW()
         WHERE id = $1`,
        [ep.campaign_id],
      );
    } else {
      await db().query(
        `UPDATE brands.event_partnerships
         SET status = 'declined', responded_at = NOW()
         WHERE id = $1`,
        [params.id],
      );
    }

    return NextResponse.json({ ok: true, status: b.action === 'accept' ? 'accepted' : 'declined' });
  });
}
