/**
 * GET /api/events/[id]/travel-links — public list cestovních odkazů
 *
 * Žádný auth — čteme v service kontextu (data jsou veřejná).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

interface TravelLinkPublicRow {
  id: string;
  label: string;
  category: string;
  partner_name: string | null;
  url: string;
  affiliate_note: string | null;
  display_order: number;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ links: [] });
  }

  const rows = await runWithServiceContext(async () => {
    const res = await db().query<TravelLinkPublicRow>(
      `SELECT id, label, category, partner_name, url, affiliate_note, display_order
       FROM catalog.event_travel_links
       WHERE event_id = $1 AND active = TRUE
       ORDER BY display_order, created_at`,
      [params.id],
    );
    return res.rows;
  });

  return NextResponse.json({ links: rows });
}
