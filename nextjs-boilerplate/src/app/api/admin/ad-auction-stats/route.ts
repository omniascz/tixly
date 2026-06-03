/**
 * GET /api/admin/ad-auction-stats
 *
 * Promoted Ads — agregované statistiky auction logu (kdo vyhrává, jaká je avg cena,
 * cross-promo distribuce). Plnit Promoted Ads ML dashboard.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';


export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  // Promoter's campaigns participating in last 7 days
  const r = await db().query<{
    campaign_id: string;
    event_title: string;
    slot: string;
    auctions_participated: string;
    auctions_won: string;
    total_spent_halire: string;
    avg_winning_score: number | null;
  }>(
    `SELECT
        ac.id AS campaign_id,
        e.title AS event_title,
        ac.slot,
        COUNT(*) FILTER (WHERE al.participants @> $2::jsonb)::text AS auctions_participated,
        COUNT(*) FILTER (WHERE al.winning_campaign_id = ac.id)::text AS auctions_won,
        COALESCE(SUM(al.charged_halire) FILTER (WHERE al.winning_campaign_id = ac.id), 0)::text AS total_spent_halire,
        AVG(al.winning_score) FILTER (WHERE al.winning_campaign_id = ac.id) AS avg_winning_score
       FROM marketing.ad_campaigns ac
       JOIN catalog.events e ON e.id = ac.event_id
  LEFT JOIN marketing.ad_auction_log al ON al.created_at > now() - INTERVAL '7 days'
      WHERE ac.promoter_id = $1
   GROUP BY ac.id, e.title, ac.slot
   ORDER BY COUNT(*) FILTER (WHERE al.winning_campaign_id = ac.id) DESC
      LIMIT 100`,
    [promoter.promoterId, JSON.stringify([{ campaign_id: '' }])],
  );

  // Simpler approach — filter v aplikaci
  const cleanRows = r.rows.map((row) => ({
    ...row,
    auctions_participated: Number(row.auctions_participated),
    auctions_won: Number(row.auctions_won),
    total_spent_halire: Number(row.total_spent_halire),
    win_rate: Number(row.auctions_participated) > 0
      ? (Number(row.auctions_won) / Number(row.auctions_participated)) * 100
      : 0,
  }));

  // Slot-level summary
  const slots = await db().query<{
    slot: string;
    auctions: string;
    avg_participants: number | null;
    avg_charged_halire: number | null;
  }>(
    `SELECT slot,
            COUNT(*)::text AS auctions,
            AVG(jsonb_array_length(participants)) AS avg_participants,
            AVG(charged_halire) AS avg_charged_halire
       FROM marketing.ad_auction_log
      WHERE created_at > now() - INTERVAL '7 days'
   GROUP BY slot
   ORDER BY COUNT(*) DESC`,
  );

  return NextResponse.json({
    campaigns: cleanRows,
    slots: slots.rows.map((s) => ({
      ...s,
      auctions: Number(s.auctions),
      avg_participants: s.avg_participants ? Number(s.avg_participants) : null,
      avg_charged_halire: s.avg_charged_halire ? Math.round(Number(s.avg_charged_halire)) : null,
    })),
  });

  });
}
