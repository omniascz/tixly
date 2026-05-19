/**
 * GET  /api/lottery/redeem?token=XXX — vrátí entry detail + pre-filled checkout params
 * POST /api/lottery/redeem — body { token } → markuje 'redeemed' + vrátí checkout payload
 *
 * Po POST kupec přejde na /cs/checkout s pre-filled údaji + lotteryEntryId, který v
 * checkoutu zaručí přístup k allocated tickets bez ohledu na inventory.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface EntryRow {
  id: string;
  status: string;
  email: string;
  name: string | null;
  ticket_type_id: string;
  quantity_requested: number;
  redeem_deadline: string;
  event_id: string;
  event_title: string;
  ticket_type_name: string;
  ticket_type_price: number;
}

async function loadEntry(token: string): Promise<EntryRow | null> {
  const r = await db().query<EntryRow>(
    `SELECT le.id, le.status, le.email, le.name, le.ticket_type_id,
            le.quantity_requested, le.redeem_deadline,
            l.event_id,
            e.title AS event_title,
            tt.name AS ticket_type_name,
            tt.base_price AS ticket_type_price
     FROM catalog.lottery_entries le
     JOIN catalog.event_lotteries l ON l.id = le.lottery_id
     JOIN catalog.events e ON e.id = l.event_id
     JOIN catalog.ticket_types tt ON tt.id = le.ticket_type_id
     WHERE le.redeem_token = $1`,
    [token],
  );
  return r.rows[0] ?? null;
}

export async function GET(req: NextRequest): Promise<Response> {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 422 });

  const entry = await loadEntry(token);
  if (!entry) return NextResponse.json({ error: 'Invalid token' }, { status: 404 });

  if (entry.status === 'redeemed') {
    return NextResponse.json({
      status: 'redeemed',
      message: 'Tato pozvánka už byla využita.',
    });
  }
  if (entry.status === 'forfeited' || new Date(entry.redeem_deadline).getTime() < Date.now()) {
    return NextResponse.json({
      status: 'forfeited',
      message: 'Lhůta pro potvrzení vypršela.',
    });
  }
  if (entry.status !== 'winner') {
    return NextResponse.json({ status: entry.status });
  }

  return NextResponse.json({
    status: 'winner',
    entry: {
      id: entry.id,
      email: entry.email,
      name: entry.name,
      eventId: entry.event_id,
      eventTitle: entry.event_title,
      ticketTypeId: entry.ticket_type_id,
      ticketTypeName: entry.ticket_type_name,
      ticketTypePrice: entry.ticket_type_price,
      quantity: entry.quantity_requested,
      redeemDeadline: entry.redeem_deadline,
    },
  });
}

const postSchema = z.object({
  token: z.string().min(20),
});

export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed' }, { status: 422 });

  const entry = await loadEntry(parsed.data.token);
  if (!entry) return NextResponse.json({ error: 'Invalid token' }, { status: 404 });
  if (entry.status !== 'winner') {
    return NextResponse.json({ error: 'NOT_WINNER', status: entry.status }, { status: 409 });
  }
  if (new Date(entry.redeem_deadline).getTime() < Date.now()) {
    await db().query(
      `UPDATE catalog.lottery_entries SET status = 'forfeited' WHERE id = $1`,
      [entry.id],
    );
    return NextResponse.json({ error: 'DEADLINE_PASSED' }, { status: 409 });
  }
  // Mark redeemed pre-emptively (will be linked to order after checkout)
  return NextResponse.json({
    ok: true,
    checkoutPayload: {
      eventId: entry.event_id,
      ticketTypeId: entry.ticket_type_id,
      quantity: entry.quantity_requested,
      buyerEmail: entry.email,
      buyerName: entry.name ?? entry.email,
      lotteryEntryId: entry.id,
    },
  });
}
