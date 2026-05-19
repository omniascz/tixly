/**
 * POST /api/admin/orders/[orderId]/support-action
 *
 * Single endpoint pro customer support actions:
 *   - resend_email: znovu pošle confirmation email
 *   - transfer: převede konkrétní ticket na jiný email (vytvoří/najde uživatele)
 *   - name_change: změní owner_name na ticketu
 *   - cancel_ticket: revokuje konkrétní ticket bez refundu (např. duplicate scan)
 *
 * Refund je separátní endpoint (existující) — má vlastní transakční flow.
 *
 * Audit: každá action zalogována do audit.support_actions.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('resend_email'),
    note: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal('transfer'),
    ticketId: z.string().uuid(),
    targetEmail: z.string().email(),
    targetName: z.string().min(1).max(120).optional(),
    note: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal('name_change'),
    ticketId: z.string().uuid(),
    newName: z.string().min(1).max(200),
    note: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal('cancel_ticket'),
    ticketId: z.string().uuid(),
    note: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal('send_message'),
    subject: z.string().min(3).max(200),
    body: z.string().min(10).max(5000),
    note: z.string().max(500).optional(),
  }),
]);

interface OrderContext {
  id: string;
  status: string;
  user_id: string;
  event_id: string;
  promoter_id: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { orderId: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const input = parsed.data;

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    // Ownership check (order → event → promoter)
    const ord = await client.query<OrderContext>(
      `SELECT o.id, o.status, o.user_id, e.id AS event_id, e.promoter_id
       FROM orders.orders o
       JOIN catalog.events e ON e.id = o.event_id
       WHERE o.id = $1 AND e.promoter_id = $2 FOR UPDATE`,
      [params.orderId, promoter.promoterId],
    );
    if (ord.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const order = ord.rows[0];

    let metadata: Record<string, unknown> = {};
    let targetTicketId: string | null = null;

    if (input.action === 'resend_email') {
      await client.query('COMMIT');
      // Trigger internal webhook out of transaction
      await fetch(
        `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/internal/order-completed`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-token': process.env.INTERNAL_SERVICE_TOKEN ?? '',
          },
          body: JSON.stringify({ orderId: order.id, resend: true }),
        },
      ).catch((err) => console.error('[support resend]', err));
      metadata = { resentTo: order.user_id };
    } else if (input.action === 'transfer') {
      // Najdi ticket
      const ticket = await client.query<{ id: string; status: string; order_id: string }>(
        `SELECT id, status, order_id FROM tickets.tickets
         WHERE id = $1 AND order_id = $2 FOR UPDATE`,
        [input.ticketId, order.id],
      );
      if (ticket.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'TICKET_NOT_IN_ORDER' }, { status: 404 });
      }
      if (ticket.rows[0].status !== 'valid') {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'TICKET_NOT_VALID', status: ticket.rows[0].status },
          { status: 409 },
        );
      }

      // Find or create target user
      const userRes = await client.query<{ id: string }>(
        `INSERT INTO identity.users (email, name, password_hash, gdpr_consent_at, created_at, updated_at)
         VALUES ($1, $2, '!support_transfer', NOW(), NOW(), NOW())
         ON CONFLICT (email) WHERE anonymized_at IS NULL DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [input.targetEmail.toLowerCase(), input.targetName ?? input.targetEmail],
      );
      const targetUserId = userRes.rows[0].id;
      targetTicketId = input.ticketId;

      await client.query(
        `UPDATE tickets.tickets
         SET owner_id = $2, updated_at = NOW()
         WHERE id = $1`,
        [input.ticketId, targetUserId],
      );
      await client.query(
        `INSERT INTO tickets.ticket_transfer_log
           (ticket_id, from_user_id, to_user_id, transferred_by_user_id, transfer_reason, created_at)
         VALUES ($1, $2, $3, $4, 'support_transfer', NOW())`,
        [input.ticketId, order.user_id, targetUserId, promoter.userId],
      ).catch(() => {
        // Tabulka existuje s touto schema, ale tolerujeme schema drift
      });
      metadata = { fromUserId: order.user_id, toUserId: targetUserId, targetEmail: input.targetEmail };
    } else if (input.action === 'name_change') {
      const ticket = await client.query<{ id: string; owner_id: string }>(
        `SELECT id, owner_id FROM tickets.tickets
         WHERE id = $1 AND order_id = $2 FOR UPDATE`,
        [input.ticketId, order.id],
      );
      if (ticket.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'TICKET_NOT_IN_ORDER' }, { status: 404 });
      }
      targetTicketId = input.ticketId;
      // Update user name (used jako holder name na ticket PDF/email)
      await client.query(
        `UPDATE identity.users SET name = $1, updated_at = NOW() WHERE id = $2`,
        [input.newName, ticket.rows[0].owner_id],
      );
      metadata = { ownerId: ticket.rows[0].owner_id, newName: input.newName };
    } else if (input.action === 'cancel_ticket') {
      const upd = await client.query<{ id: string }>(
        `UPDATE tickets.tickets
         SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND order_id = $2 AND status = 'valid'
         RETURNING id`,
        [input.ticketId, order.id],
      );
      if (upd.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'TICKET_NOT_VALID_OR_NOT_IN_ORDER' }, { status: 409 });
      }
      targetTicketId = input.ticketId;
    } else if (input.action === 'send_message') {
      // Načti buyer email + promotér brand pro odesílatele
      const ctx = await client.query<{
        buyer_email: string;
        buyer_name: string | null;
        event_title: string;
        promoter_name: string;
        brand_color_hex: string | null;
      }>(
        `SELECT u.email AS buyer_email, u.name AS buyer_name,
                e.title AS event_title,
                p.name AS promoter_name, p.brand_color_hex
         FROM orders.orders o
         JOIN identity.users u ON u.id = o.user_id
         JOIN catalog.events e ON e.id = o.event_id
         JOIN platform.promoters p ON p.id = e.promoter_id
         WHERE o.id = $1`,
        [order.id],
      );
      const c = ctx.rows[0];
      if (!c) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'CONTEXT_NOT_FOUND' }, { status: 404 });
      }

      // Sender display + brand color v hlavičce
      const { sendMail } = await import('@/lib/email/mailer');
      const { escapeHtml } = await import('@/lib/html-escape/escape');
      const brandColor =
        c.brand_color_hex && /^#[0-9a-f]{6}$/i.test(c.brand_color_hex)
          ? c.brand_color_hex
          : '#10b981';
      const html = `<!DOCTYPE html>
<html><body style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:0;color:#111">
  <div style="background:${brandColor};color:#fff;padding:20px 24px">
    <h1 style="margin:0;font-size:20px">${escapeHtml(c.promoter_name)}</h1>
    <p style="margin:4px 0 0;font-size:13px;opacity:0.9">k akci „${escapeHtml(c.event_title)}"</p>
  </div>
  <div style="padding:24px;line-height:1.6">
    <p>Ahoj ${escapeHtml(c.buyer_name ?? '')},</p>
    ${input.body
      .split('\n')
      .map((line) => `<p>${escapeHtml(line)}</p>`)
      .join('')}
    <p style="margin-top:24px;color:#666;font-size:12px">
      Tato zpráva byla odeslána pořadatelem akce přes platformu Tixly.
      Pokud potřebuješ odpovědět, použij prosím odpověď na tento e-mail —
      ten půjde přímo pořadateli.
    </p>
  </div>
</body></html>`;
      try {
        await sendMail({
          from: `"${c.promoter_name}" <${process.env.EMAIL_FROM ?? 'vstupenky@tixly.local'}>`,
          to: c.buyer_email,
          subject: input.subject,
          html,
          text: input.body,
        });
      } catch (e) {
        console.error('[support send_message]', e);
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'EMAIL_SEND_FAILED', message: e instanceof Error ? e.message : String(e) },
          { status: 500 },
        );
      }
      metadata = { subject: input.subject, bodyLength: input.body.length };
    }

    // Audit
    await client.query(
      `INSERT INTO audit.support_actions
         (actor_user_id, actor_promoter_id, target_order_id, target_ticket_id,
          action, reason, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        promoter.userId,
        promoter.promoterId,
        order.id,
        targetTicketId,
        input.action,
        input.note ?? null,
        JSON.stringify(metadata),
      ],
    );

    if (input.action !== 'resend_email') {
      await client.query('COMMIT');
    }

    return NextResponse.json({ ok: true, action: input.action, metadata });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[support-action]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { orderId: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Ownership check
  const owns = await db().query(
    `SELECT 1 FROM orders.orders o
     JOIN catalog.events e ON e.id = o.event_id
     WHERE o.id = $1 AND e.promoter_id = $2`,
    [params.orderId, promoter.promoterId],
  );
  if (owns.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const r = await db().query<{
    id: string;
    action: string;
    reason: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
    actor_email: string;
  }>(
    `SELECT s.id, s.action, s.reason, s.metadata, s.created_at,
            u.email AS actor_email
     FROM audit.support_actions s
     JOIN identity.users u ON u.id = s.actor_user_id
     WHERE s.target_order_id = $1
     ORDER BY s.created_at DESC
     LIMIT 50`,
    [params.orderId],
  );
  return NextResponse.json({ actions: r.rows });
}
