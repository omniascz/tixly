/**
 * PATCH  /api/platform/brand-connect/campaigns/[id] — update campaign
 * DELETE /api/platform/brand-connect/campaigns/[id] — end campaign
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPlatformAdmin } from '@/lib/platform-auth';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPlatformAdmin(req, async () => {
    const b = await req.json() as Partial<{
      name: string; tagline: string; description: string;
      logo_url: string; banner_url: string; cta_text: string; cta_url: string;
      target_event_categories: string[]; target_cities: string[];
      target_min_capacity: number; fee_per_event_czk: number;
      tixly_cut_pct: number; budget_czk: number;
      starts_at: string; ends_at: string; status: string;
    }>;

    const ALLOWED = [
      'name','tagline','description','logo_url','banner_url','cta_text','cta_url',
      'target_event_categories','target_cities','target_min_capacity',
      'fee_per_event_czk','tixly_cut_pct','budget_czk','starts_at','ends_at','status',
    ] as const;

    const keys = (Object.keys(b) as string[]).filter((k) =>
      ALLOWED.includes(k as typeof ALLOWED[number]),
    );
    if (keys.length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const setClauses = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const values = keys.map((k) => (b as Record<string, unknown>)[k]);

    await db().query(
      `UPDATE brands.campaigns SET ${setClauses}, updated_at = NOW() WHERE id = $1`,
      [params.id, ...values],
    );

    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPlatformAdmin(req, async () => {
    await db().query(
      `UPDATE brands.event_partnerships SET status='cancelled' WHERE campaign_id=$1`,
      [params.id],
    );
    await db().query(
      `UPDATE brands.campaigns SET status='ended', updated_at=NOW() WHERE id=$1`,
      [params.id],
    );
    return NextResponse.json({ ok: true });
  });
}
