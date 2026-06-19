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
        payment_window_hours: number;
        event_title: string;
      }>(
        `SELECT lc.id, lc.event_id, lc.status, lc.payment_window_hours,
                e.title AS event_title
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

      await client.query(
        `UPDATE orders.lottery_entries
         SET status = 'expired', updated_at = NOW()
         WHERE campaign_id = $1
           AND status = 'won'
           AND payment_deadline < NOW()`,
        [campaign.id],
      );

      const expiredRes = await client.query<{ count: string }>(
        `SELECT COUNT(*)::int AS count
         FROM orders.lottery_entries
         WHERE campaign_id = $1 AND status = 'expired'`,
        [campaign.id],
      );
      const expiredCount = parseInt(expiredRes.rows[0].count, 10) || 0;

      const nextLosersRes = await client.query<{
        id: string;
        email: string;
        name: string | null;
      }>(
        `SELECT id, email, name
         FROM orders.lottery_entries
         WHERE campaign_id = $1 AND status = 'lost'
         ORDER BY COALESCE(draw_position, 999999) ASC, random()
         LIMIT $2`,
        [campaign.id, expiredCount],
      );

      const newWinners = nextLosersRes.rows;
      const newDeadline = new Date(
        Date.now() + campaign.payment_window_hours * 60 * 60 * 1000,
      );

      for (let i = 0; i < newWinners.length; i++) {
        const w = newWinners[i];
        await client.query(
          `UPDATE orders.lottery_entries
           SET status = 'won',
               payment_deadline = $3,
               updated_at = NOW()
           WHERE id = $1 AND campaign_id = $2`,
          [w.id, campaign.id, newDeadline.toISOString()],
        );
        console.log(
          `[lottery advance] New winner: ${w.email} → campaign=${campaign.id}, deadline=${newDeadline.toISOString()}`,
        );
      }

      await client.query('COMMIT');

      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
      for (const w of newWinners) {
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

      return NextResponse.json({ newWinners: newWinners.length });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[lottery advance]', err);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
