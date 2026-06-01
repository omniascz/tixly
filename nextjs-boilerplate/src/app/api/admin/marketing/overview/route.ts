/**
 * GET /api/admin/marketing/overview?days=30
 *
 * Marketing dashboard data:
 *   - Channel breakdown (top UTM sources)
 *   - Conversion rate per channel
 *   - ROAS (revenue / spend) — pokud máme campaign spend data
 *   - Top performing campaigns
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';


export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  const url = req.nextUrl;
  const days = Math.min(180, Math.max(1, Number(url.searchParams.get('days') ?? '30')));

  // Channel breakdown — z attribution.touch_points + attribution.conversions
  const channelsRes = await db()
    .query<{
      channel: string;
      touchpoints: string;
      conversions: string;
      revenue: string;
    }>(
      `WITH promoter_events AS (
         SELECT id FROM catalog.events WHERE promoter_id = $1
       ),
       relevant_orders AS (
         SELECT o.id, o.total_amount
         FROM orders.orders o
         WHERE o.event_id IN (SELECT id FROM promoter_events)
           AND o.status = 'paid'
           AND o.paid_at > NOW() - INTERVAL '1 day' * $2
       )
       SELECT
         COALESCE(tp.utm_source, 'direct') AS channel,
         COUNT(DISTINCT tp.id)::text AS touchpoints,
         COUNT(DISTINCT c.order_id)::text AS conversions,
         COALESCE(SUM(ro.total_amount) FILTER (WHERE c.order_id IS NOT NULL), 0)::text AS revenue
       FROM attribution.touch_points tp
       LEFT JOIN attribution.conversions c
         ON c.order_id IN (SELECT id FROM relevant_orders)
         AND (c.attribution_data::jsonb)::text LIKE '%' || tp.id || '%'
       LEFT JOIN relevant_orders ro ON ro.id = c.order_id
       WHERE tp.event_id IN (SELECT id FROM promoter_events)
         AND tp.created_at > NOW() - INTERVAL '1 day' * $2
       GROUP BY COALESCE(tp.utm_source, 'direct')
       ORDER BY SUM(CASE WHEN c.order_id IS NOT NULL THEN 1 ELSE 0 END) DESC NULLS LAST
       LIMIT 20`,
      [promoter.promoterId, days],
    )
    .catch(() => ({
      rows: [] as Array<{
        channel: string;
        touchpoints: string;
        conversions: string;
        revenue: string;
      }>,
    }));

  // Top campaigns z marketing.campaigns
  const campaignsRes = await db()
    .query<{
      name: string;
      utm_source: string | null;
      utm_medium: string | null;
      utm_campaign: string | null;
      sent_count: string;
      click_count: string;
      conversion_count: string;
      revenue: string;
    }>(
      `SELECT
         m.name,
         m.utm_source,
         m.utm_medium,
         m.utm_campaign,
         m.sent_count::text,
         m.click_count::text,
         m.conversion_count::text,
         COALESCE(m.revenue_halire, 0)::text AS revenue
       FROM marketing.campaigns m
       WHERE m.promoter_id = $1
         AND m.created_at > NOW() - INTERVAL '1 day' * $2
       ORDER BY m.created_at DESC
       LIMIT 10`,
      [promoter.promoterId, days],
    )
    .catch(() => ({
      rows: [] as Array<{
        name: string;
        utm_source: string | null;
        utm_medium: string | null;
        utm_campaign: string | null;
        sent_count: string;
        click_count: string;
        conversion_count: string;
        revenue: string;
      }>,
    }));

  // Total summary
  const summaryRes = await db()
    .query<{
      total_touchpoints: string;
      total_conversions: string;
      total_revenue: string;
    }>(
      `WITH promoter_events AS (
         SELECT id FROM catalog.events WHERE promoter_id = $1
       )
       SELECT
         (SELECT COUNT(*)::text FROM attribution.touch_points
           WHERE event_id IN (SELECT id FROM promoter_events)
             AND created_at > NOW() - INTERVAL '1 day' * $2) AS total_touchpoints,
         (SELECT COUNT(*)::text FROM attribution.conversions c
           JOIN orders.orders o ON o.id = c.order_id
           WHERE o.event_id IN (SELECT id FROM promoter_events)
             AND o.status = 'paid' AND o.paid_at > NOW() - INTERVAL '1 day' * $2) AS total_conversions,
         COALESCE(
           (SELECT SUM(o.total_amount) FROM orders.orders o
             WHERE o.event_id IN (SELECT id FROM promoter_events)
               AND o.status = 'paid' AND o.paid_at > NOW() - INTERVAL '1 day' * $2),
           0
         )::text AS total_revenue`,
      [promoter.promoterId, days],
    )
    .catch(() => ({
      rows: [
        { total_touchpoints: '0', total_conversions: '0', total_revenue: '0' },
      ],
    }));

  return NextResponse.json({
    period: { days, from: new Date(Date.now() - days * 86400000).toISOString() },
    summary: summaryRes.rows[0],
    channels: channelsRes.rows.map((c) => ({
      channel: c.channel,
      touchpoints: Number(c.touchpoints),
      conversions: Number(c.conversions),
      revenueHalire: Number(c.revenue),
      conversionRate:
        Number(c.touchpoints) > 0
          ? Math.round((Number(c.conversions) * 100) / Number(c.touchpoints))
          : 0,
    })),
    campaigns: campaignsRes.rows.map((c) => ({
      name: c.name,
      utmSource: c.utm_source,
      utmMedium: c.utm_medium,
      utmCampaign: c.utm_campaign,
      sentCount: Number(c.sent_count),
      clickCount: Number(c.click_count),
      conversionCount: Number(c.conversion_count),
      revenueHalire: Number(c.revenue),
    })),
  });

  });
}
