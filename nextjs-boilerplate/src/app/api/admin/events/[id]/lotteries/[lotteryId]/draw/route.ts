/**
 * POST /api/admin/events/[id]/lotteries/[lotteryId]/draw
 *
 * Provede losování:
 *   1. Sečte allocation_total (kolik lístků celkem rozdělíme)
 *   2. Vybere náhodně entries dokud nedojde alokace (sum quantity_requested)
 *   3. Markuje vybrané jako 'winner' s redeem_token + redeem_deadline
 *   4. Pošle email s redeem linkem (mock: /api/internal/lottery-winner-email)
 *
 * Idempotent: jen pokud status='closed' (musí být po closes_at). Jednou losovaný = 'drawn'.
 */

import { randomBytes } from 'crypto';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoterOwner } from '@/lib/admin-auth';
import { NextRequest, NextResponse } from 'next/server';


interface EntryRow {
  id: string;
  email: string;
  name: string | null;
  ticket_type_id: string;
  quantity_requested: number;
}

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string; lotteryId: string }> }
): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoterOwner(req, async (promoter) => {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const owns = await client.query(
      `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
      [params.id, promoter.promoterId],
    );
    if (owns.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const lottery = await client.query<{
      id: string;
      status: string;
      closes_at: string;
      payment_deadline_hours: number;
      allocation_total: number;
      event_title: string;
    }>(
      `SELECT l.id, l.status, l.closes_at, l.payment_deadline_hours, l.allocation_total,
              e.title AS event_title
       FROM catalog.event_lotteries l
       JOIN catalog.events e ON e.id = l.event_id
       WHERE l.id = $1 AND l.event_id = $2 FOR UPDATE`,
      [params.lotteryId, params.id],
    );
    if (lottery.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const l = lottery.rows[0];

    // Auto-close pokud closes_at proběhl
    if (l.status === 'open') {
      if (new Date(l.closes_at).getTime() > Date.now()) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: 'LOTTERY_STILL_OPEN',
            message: 'Losovat lze až po closes_at.',
            closesAt: l.closes_at,
          },
          { status: 409 },
        );
      }
      await client.query(
        `UPDATE catalog.event_lotteries SET status = 'closed' WHERE id = $1`,
        [l.id],
      );
    } else if (l.status !== 'closed') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'INVALID_STATE', status: l.status },
        { status: 409 },
      );
    }

    const entries = await client.query<EntryRow>(
      `SELECT id, email, name, ticket_type_id, quantity_requested
       FROM catalog.lottery_entries
       WHERE lottery_id = $1 AND status = 'entered'
       ORDER BY random()`,
      [l.id],
    );

    let allocationLeft = l.allocation_total;
    const winners: EntryRow[] = [];
    for (const e of entries.rows) {
      if (allocationLeft <= 0) break;
      if (e.quantity_requested <= allocationLeft) {
        winners.push(e);
        allocationLeft -= e.quantity_requested;
      }
    }

    const redeemDeadline = new Date(
      Date.now() + l.payment_deadline_hours * 60 * 60 * 1000,
    );

    // Mark winners
    for (const w of winners) {
      const token = randomBytes(32).toString('base64url');
      await client.query(
        `UPDATE catalog.lottery_entries
         SET status = 'winner', redeem_token = $2, redeem_deadline = $3
         WHERE id = $1`,
        [w.id, token, redeemDeadline.toISOString()],
      );
    }
    // Mark rest as losers
    if (entries.rows.length > winners.length) {
      const winnerIds = winners.map((w) => w.id);
      await client.query(
        `UPDATE catalog.lottery_entries
         SET status = 'loser'
         WHERE lottery_id = $1 AND status = 'entered' AND id != ALL($2::uuid[])`,
        [l.id, winnerIds],
      );
    }

    await client.query(
      `UPDATE catalog.event_lotteries
       SET status = 'drawn', drawn_at = NOW()
       WHERE id = $1`,
      [l.id],
    );

    await client.query('COMMIT');

    // Notify winners (out of transaction)
    for (const w of winners) {
      const tokenRes = await db().query<{ redeem_token: string }>(
        `SELECT redeem_token FROM catalog.lottery_entries WHERE id = $1`,
        [w.id],
      );
      const redeemUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/cs/lottery/redeem?token=${tokenRes.rows[0].redeem_token}`;
      void fetch(
        `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/internal/lottery-winner-email`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-token': process.env.INTERNAL_SERVICE_TOKEN ?? '',
          },
          body: JSON.stringify({
            toEmail: w.email,
            toName: w.name,
            eventTitle: l.event_title,
            quantity: w.quantity_requested,
            redeemUrl,
            deadlineHours: l.payment_deadline_hours,
          }),
        },
      ).catch((err) => console.error('[lottery-winner-email]', err));

      // ForgeMsg — emit lottery_won.
      try {
        const { emitForgeMsg, splitName } = await import('@/lib/forgemsg/emit');
        await emitForgeMsg(
          {
            type: 'lottery_won',
            contact: { email: w.email, ...splitName(w.name) },
            event: { externalId: params.id, title: l.event_title },
            payload: { buy_url: redeemUrl },
          },
          promoter.promoterId,
        );
      } catch (emitErr) {
        console.error('[lottery draw] forgemsg emit failed:', emitErr);
      }
    }

    return NextResponse.json({
      ok: true,
      totalEntries: entries.rows.length,
      winnersCount: winners.length,
      losersCount: entries.rows.length - winners.length,
      allocationLeft,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[lottery draw]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
