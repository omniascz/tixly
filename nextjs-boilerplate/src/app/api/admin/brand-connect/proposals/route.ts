/**
 * GET /api/admin/brand-connect/proposals — seznam návrhů partnerství pro promotéra
 *
 * ?status=proposed|accepted|active|declined|all (default: proposed)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (ctx) => {
    const status = req.nextUrl.searchParams.get('status') ?? 'proposed';
    const VALID = ['proposed','accepted','active','declined','expired','cancelled','all'];
    if (!VALID.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const statusFilter = status === 'all'
      ? ''
      : `AND ep.status = '${status}'`;

    const r = await db().query(
      `SELECT
         ep.id, ep.status, ep.fee_czk, ep.tixly_fee_czk, ep.placement,
         ep.impressions, ep.clicks, ep.proposed_at, ep.responded_at,
         ep.activated_at, ep.expires_at,
         -- Event
         e.id AS event_id, e.title AS event_title, e.date_start,
         v.name AS venue_name, v.city AS venue_city,
         -- Campaign + Advertiser
         c.id AS campaign_id, c.name AS campaign_name,
         c.tagline, c.logo_url AS campaign_logo,
         c.banner_url, c.cta_text, c.cta_url,
         a.company_name AS advertiser_name
       FROM brands.event_partnerships ep
       JOIN catalog.events e ON e.id = ep.event_id
       LEFT JOIN catalog.venues v ON v.id = e.venue_id
       JOIN brands.campaigns c ON c.id = ep.campaign_id
       JOIN brands.advertisers a ON a.id = c.advertiser_id
       WHERE ep.promoter_id = $1 ${statusFilter}
       ORDER BY
         CASE ep.status WHEN 'proposed' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
         ep.proposed_at DESC
       LIMIT 100`,
      [ctx.promoterId],
    );

    // Earnings summary
    const earningsR = await db().query(
      `SELECT
         COALESCE(SUM(ep.fee_czk) FILTER (WHERE ep.status IN ('accepted','active')), 0)::int AS earned_czk,
         COALESCE(SUM(ep.impressions), 0)::int AS total_impressions,
         COALESCE(SUM(ep.clicks), 0)::int AS total_clicks,
         COUNT(*) FILTER (WHERE ep.status = 'proposed')::int AS pending_count,
         COUNT(*) FILTER (WHERE ep.status IN ('accepted','active'))::int AS active_count
       FROM brands.event_partnerships ep
       WHERE ep.promoter_id = $1`,
      [ctx.promoterId],
    );

    return NextResponse.json({
      proposals: r.rows,
      summary: earningsR.rows[0],
    });
  });
}
