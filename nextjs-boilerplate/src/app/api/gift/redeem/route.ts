/**
 * GET  /api/gift/redeem?token=XXX — vrátí gift detail (pro recipient landing page)
 * POST /api/gift/redeem — body { token } → claim — najdeme/založíme user pro recipient email
 *                        a převedeme ownership lístků na něj.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface GiftRow {
  id: string;
  status: string;
  is_gift: boolean;
  gift_recipient_email: string | null;
  gift_recipient_name: string | null;
  gift_message: string | null;
  gift_redeemed_at: string | null;
  buyer_email: string;
  event_title: string;
  event_date_start: string;
}

async function loadGift(token: string): Promise<GiftRow | null> {
  const r = await db().query<GiftRow>(
    `SELECT o.id, o.status, o.is_gift, o.gift_recipient_email, o.gift_recipient_name,
            o.gift_message, o.gift_redeemed_at,
            u.email AS buyer_email,
            e.title AS event_title, e.date_start AS event_date_start
     FROM orders.orders o
     JOIN identity.users u ON u.id = o.user_id
     LEFT JOIN catalog.events e ON e.id = o.event_id
     WHERE o.gift_redeem_token = $1`,
    [token],
  );
  return r.rows[0] ?? null;
}

export async function GET(req: NextRequest): Promise<Response> {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 422 });
  const gift = await loadGift(token);
  if (!gift || !gift.is_gift) {
    return NextResponse.json({ error: 'Invalid gift' }, { status: 404 });
  }
  return NextResponse.json({
    status: gift.gift_redeemed_at ? 'redeemed' : 'pending',
    eventTitle: gift.event_title,
    eventDateStart: gift.event_date_start,
    fromBuyerEmail: gift.buyer_email,
    recipientName: gift.gift_recipient_name,
    message: gift.gift_message,
    orderStatus: gift.status,
  });
}

const postSchema = z.object({
  token: z.string().min(20),
});

export async function POST(req: NextRequest): Promise<Response> {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed' }, { status: 422 });

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const r = await client.query<{
      id: string;
      gift_recipient_email: string;
      gift_recipient_name: string | null;
      gift_redeemed_at: string | null;
      status: string;
    }>(
      `SELECT id, gift_recipient_email, gift_recipient_name, gift_redeemed_at, status
       FROM orders.orders
       WHERE gift_redeem_token = $1 AND is_gift = true
       FOR UPDATE`,
      [parsed.data.token],
    );
    if (r.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Invalid gift' }, { status: 404 });
    }
    const o = r.rows[0];
    if (o.gift_redeemed_at) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'ALREADY_REDEEMED' }, { status: 409 });
    }
    if (o.status !== 'paid' && o.status !== 'paid_partial') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'ORDER_NOT_PAID', status: o.status }, { status: 409 });
    }

    // Najdi nebo založ recipient usera
    const userRes = await client.query<{ id: string }>(
      `INSERT INTO identity.users
         (email, name, password_hash, gdpr_consent_at, created_at, updated_at)
       VALUES ($1, $2, '!gift_recipient', NOW(), NOW(), NOW())
       ON CONFLICT (email) WHERE anonymized_at IS NULL DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [o.gift_recipient_email, o.gift_recipient_name ?? o.gift_recipient_email],
    );
    const recipientUserId = userRes.rows[0].id;

    // Transfer všechny tickets
    await client.query(
      `UPDATE tickets.tickets
       SET owner_id = $2, updated_at = NOW()
       WHERE order_id = $1 AND status = 'valid'`,
      [o.id, recipientUserId],
    );

    await client.query(
      `UPDATE orders.orders
       SET gift_redeemed_at = NOW(), gift_redeemed_user_id = $2
       WHERE id = $1`,
      [o.id, recipientUserId],
    );

    await client.query('COMMIT');
    return NextResponse.json({ ok: true, recipientUserId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[gift redeem]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
