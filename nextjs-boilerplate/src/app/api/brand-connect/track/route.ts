/**
 * POST /api/brand-connect/track
 * Body: { partnership_id: string, event_id: string, kind: 'impression' | 'click' }
 *
 * Lightweight tracking — loguje impression/click + incrementuje countery.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  const b = await req.json().catch(() => ({})) as {
    partnership_id?: string;
    event_id?: string;
    kind?: string;
  };

  if (!b.partnership_id || !b.event_id || !['impression','click'].includes(b.kind ?? '')) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const ua = req.headers.get('user-agent')?.slice(0, 250);

  await runWithServiceContext(() =>
    db().query(
      `INSERT INTO brands.impressions (partnership_id, event_id, kind, user_agent)
       VALUES ($1,$2,$3,$4)`,
      [b.partnership_id, b.event_id, b.kind, ua ?? null],
    ),
  );

  // Increment counter on partnership + campaign (fire-and-forget)
  const col = b.kind === 'click' ? 'clicks' : 'impressions';
  runWithServiceContext(() =>
    db().query(
      `UPDATE brands.event_partnerships SET ${col} = ${col} + 1 WHERE id = $1`,
      [b.partnership_id],
    ),
  ).catch(() => null);

  runWithServiceContext(() =>
    db().query(
      `UPDATE brands.campaigns SET total_${col} = total_${col} + 1
       WHERE id = (SELECT campaign_id FROM brands.event_partnerships WHERE id = $1)`,
      [b.partnership_id],
    ),
  ).catch(() => null);

  return NextResponse.json({ ok: true });
}
