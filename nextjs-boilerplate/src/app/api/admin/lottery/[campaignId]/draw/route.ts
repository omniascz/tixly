import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';

export async function POST(
  req: NextRequest,
  { params }: { params: { campaignId: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const client = await db().connect();
    try {
      await client.query('BEGIN');

      const campaignRes = await client.query<{
        id: string;
        event_id: string;
        status: string;
        max_winners: number;
        draw_at: string;
        payment_window_hours: number;
        event_title: string;
      }>(
        `SELECT lc.id, lc.event_id, lc.status, lc.max_winners, lc.draw_at,
                lc.payment_window_hours, e.title AS event_title
         FROM orders.lottery_campaigns lc
         JOIN catalog.events e ON e.id = lc.event_id
         WHERE lc.id = $1 AND e.promoter_id = $2
         FOR UPDATE OF lc`,
        [params.campaignId, promoter.promoterId],
      );

      if (campaignRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }

      const campaign = campaignRes.rows[0];

      const canDraw =
        campaign.status === 'closed' ||
        (campaign.status === 'open' && new Date(campaign.draw_at).getTime() <= Date.now());

      if (!canDraw) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: 'CANNOT_DRAW',
            message: `Kampaň musí mít status 'closed' nebo být po draw_at. Status: ${campaign.status}`,
          },
          { status: 409 },
        );
      }

      const entriesRes = await client.query<{
        id: string;
        email: string;
        name: string | null;
      }>(
        `SELECT id, email, name
         FROM orders.lottery_entries
         WHERE campaign_id = $1 AND status = 'entered'
         ORDER BY random()`,
        [campaign.id],
      );

      const allEntries = entriesRes.rows;
      const maxWinners = campaign.max_winners;
      const winners = allEntries.slice(0, maxWinners);
      const losers = allEntries.slice(maxWinners);

      const paymentDeadline = new Date(
        Date.now() + campaign.payment_window_hours * 60 * 60 * 1000,
      );

      for (let i = 0; i < winners.length; i++) {
        const w = winners[i];
        await client.query(
          `UPDATE orders.lottery_entries
           SET status = 'won',
               payment_deadline = $3,
               draw_position = $4
           WHERE id = $1 AND campaign_id = $2`,
          [w.id, campaign.id, paymentDeadline.toISOString(), i + 1],
        );
        console.log(
          `[lottery draw] Winner: ${w.email} → campaign=${campaign.id}, position=${i + 1}, deadline=${paymentDeadline.toISOString()}`,
        );
      }

      if (losers.length > 0) {
        const loserIds = losers.map((l) => l.id);
        await client.query(
          `UPDATE orders.lottery_entries
           SET status = 'lost'
           WHERE id = ANY($1::uuid[]) AND campaign_id = $2`,
          [loserIds, campaign.id],
        );
        for (const l of losers) {
          console.log(`[lottery draw] Lost: ${l.email} → campaign=${campaign.id}`);
        }
      }

      await client.query(
        `UPDATE orders.lottery_campaigns
         SET status = 'drawn',
             drawn_at = NOW(),
             winner_count = $2
         WHERE id = $1`,
        [campaign.id, winners.length],
      );

      await client.query('COMMIT');

      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
      for (const w of winners) {
        const tokenRes = await db().query<{ entry_token: string }>(
          `SELECT entry_token FROM orders.lottery_entries WHERE id = $1`,
          [w.id],
        );
        const entryToken = tokenRes.rows[0]?.entry_token;
        if (!entryToken) continue;
        void fetch(`${appUrl}/api/internal/lottery-winner-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-token': process.env.INTERNAL_SERVICE_TOKEN ?? '',
          },
          body: JSON.stringify({
            toEmail: w.email,
            toName: w.name,
            eventTitle: campaign.event_title,
            redeemUrl: `${appUrl}/cs/lottery/result/${entryToken}`,
            deadlineHours: campaign.payment_window_hours,
          }),
        }).catch((err) => console.error('[lottery-winner-email]', err));
      }

      return NextResponse.json({ winners: winners.length, losers: losers.length });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[lottery draw]', err);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
