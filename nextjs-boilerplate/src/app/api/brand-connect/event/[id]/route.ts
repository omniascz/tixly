/**
 * GET /api/brand-connect/event/[id]
 *
 * Vrátí aktivní brand partnery pro danou akci.
 * Volá se z order-confirmation page (server-side) po zaplacení.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const r = await runWithServiceContext(() =>
    db().query(
      `SELECT
         ep.id AS partnership_id,
         ep.placement,
         c.tagline, c.logo_url, c.banner_url, c.cta_text, c.cta_url,
         a.company_name AS advertiser_name
       FROM brands.event_partnerships ep
       JOIN brands.campaigns c ON c.id = ep.campaign_id
       JOIN brands.advertisers a ON a.id = c.advertiser_id
       WHERE ep.event_id = $1
         AND ep.status IN ('accepted','active')
         AND a.status = 'active'
         AND c.status IN ('active')
         AND (c.ends_at IS NULL OR c.ends_at > NOW())
       ORDER BY ep.activated_at`,
      [params.id],
    ),
  );

  return NextResponse.json({ partners: r.rows });
}
