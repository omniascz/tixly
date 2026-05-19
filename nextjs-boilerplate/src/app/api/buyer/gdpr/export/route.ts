/**
 * GET /api/buyer/gdpr/export
 *
 * Vrátí kompletní JSON s všemi daty buyera:
 *   - profile (identity.users)
 *   - orders (vč. items + addons)
 *   - tickets (status, event, type)
 *   - verifications
 *   - lottery entries
 *   - waitlist entries
 *   - cross-pass memberships
 *   - subscriptions
 *
 * Auth: x-user-id (sám své data).
 * Format: download attachment, JSON.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function GET(req: NextRequest): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [profile, orders, tickets, verifications, lottery, waitlist, crossPass, subs] =
    await Promise.all([
      db().query(
        `SELECT id, email, name, phone, gdpr_consent_at, created_at, anonymized_at
         FROM identity.users WHERE id = $1`,
        [userId],
      ),
      db().query(
        `SELECT o.id, o.status, o.total_amount, o.currency, o.created_at, o.paid_at,
                o.is_gift, o.gift_recipient_email, o.gift_redeemed_at,
                e.title AS event_title, e.date_start AS event_date
         FROM orders.orders o
         LEFT JOIN catalog.events e ON e.id = o.event_id
         WHERE o.user_id = $1
         ORDER BY o.created_at DESC`,
        [userId],
      ),
      db().query(
        `SELECT t.id, t.status, t.used_at, t.revoked_at, t.created_at,
                tt.name AS ticket_type_name,
                e.title AS event_title
         FROM tickets.tickets t
         JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
         JOIN orders.orders o ON o.id = t.order_id
         JOIN catalog.events e ON e.id = o.event_id
         WHERE t.owner_id = $1`,
        [userId],
      ),
      db().query(
        `SELECT type, status, created_at, verified_at, expires_at, rejection_reason
         FROM identity.discount_verifications WHERE user_id = $1`,
        [userId],
      ),
      db().query(
        `SELECT le.status, le.quantity_requested, le.created_at,
                l.name AS lottery_name, e.title AS event_title
         FROM catalog.lottery_entries le
         JOIN catalog.event_lotteries l ON l.id = le.lottery_id
         JOIN catalog.events e ON e.id = l.event_id
         WHERE le.user_id = $1`,
        [userId],
      ),
      db().query(
        `SELECT w.status, w.created_at, tt.name AS ticket_type_name, e.title AS event_title
         FROM catalog.waitlist_entries w
         JOIN catalog.ticket_types tt ON tt.id = w.ticket_type_id
         JOIN catalog.events e ON e.id = tt.event_id
         WHERE w.user_id = $1`,
        [userId],
      ),
      db().query(
        `SELECT m.status, m.created_at, b.name AS bundle_name
         FROM tickets.cross_pass_memberships m
         JOIN catalog.cross_pass_bundles b ON b.id = m.bundle_id
         WHERE m.user_id = $1`,
        [userId],
      ),
      db().query(
        `SELECT s.status, s.current_period_start, s.current_period_end, s.cancel_at_period_end,
                p.name AS plan_name
         FROM subscriptions.subscriptions s
         JOIN subscriptions.plans p ON p.id = s.plan_id
         WHERE s.user_id = $1`,
        [userId],
      ),
    ]);

  const data: Record<string, unknown> = {
    exportGeneratedAt: new Date().toISOString(),
    userId,
    profile: profile.rows[0] ?? null,
    orders: orders.rows,
    tickets: tickets.rows,
    verifications: verifications.rows,
    lotteryEntries: lottery.rows,
    waitlistEntries: waitlist.rows,
    crossPassMemberships: crossPass.rows,
    subscriptions: subs.rows,
  };

  // Log the export request
  await db().query(
    `INSERT INTO identity.gdpr_requests (user_id, type, status, completed_at)
     VALUES ($1, 'export', 'completed', NOW())`,
    [userId],
  );

  const json = JSON.stringify(data, null, 2);
  return new NextResponse(json, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="tixly-data-${userId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
