/**
 * GET /api/public/events/[id]/pixels
 *
 * Public — vrátí aktivní tracking pixels pro event.
 * Frontend renderuje <script> tagy pro Meta Pixel / Google Ads / atd.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';


export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const event = await db().query<{ promoter_id: string }>(
    `SELECT promoter_id FROM catalog.events WHERE id = $1 AND status = 'published'`,
    [params.id],
  );
  if (event.rows.length === 0) {
    return NextResponse.json({ pixels: [] });
  }

  const r = await db().query<{
    platform: string;
    pixel_id: string;
    events_tracked: string[];
  }>(
    `SELECT platform, pixel_id, events_tracked
       FROM marketing.tracking_pixels
      WHERE (event_id = $1 OR (event_id IS NULL AND promoter_id = $2))
        AND is_active = true`,
    [params.id, event.rows[0].promoter_id],
  );

  // Filtruj sensitive config — vrať jen veřejné fields pro client-side rendering
  return NextResponse.json({
    pixels: r.rows.map((p) => ({
      platform: p.platform,
      pixelId: p.pixel_id,
      events: p.events_tracked,
    })),
  });
}
