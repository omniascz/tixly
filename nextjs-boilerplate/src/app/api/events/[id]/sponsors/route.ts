/**
 * GET /api/events/[id]/sponsors — public list aktivních sponzorů
 *
 * Žádný auth — čteme v service kontextu (data jsou veřejná).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

interface SponsorPublicRow {
  id: string;
  name: string;
  logo_url: string | null;
  click_url: string | null;
  tagline: string | null;
  placement: string;
  display_order: number;
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ sponsors: [] });
  }

  const rows = await runWithServiceContext(async () => {
    const res = await db().query<SponsorPublicRow>(
      `SELECT id, name, logo_url, click_url, tagline, placement, display_order
       FROM catalog.event_sponsors
       WHERE event_id = $1 AND active = TRUE
       ORDER BY display_order, created_at`,
      [params.id],
    );
    return res.rows;
  });

  return NextResponse.json({ sponsors: rows });
}
