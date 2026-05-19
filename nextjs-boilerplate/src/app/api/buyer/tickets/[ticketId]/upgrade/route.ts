/**
 * GET  /api/buyer/tickets/[ticketId]/upgrade — list dostupných upgrade variant
 * POST /api/buyer/tickets/[ticketId]/upgrade — provést upgrade
 *
 * Self-service upgrade flow:
 *   1. Kupec má ticket s ticket_type_id = X (např. GA)
 *   2. Promotér má jiný ticket_type_id = Y (např. VIP) v rámci stejné akce
 *      s vyšší cenou
 *   3. Kupec klikne "Upgrade na VIP" → POST endpoint:
 *      a) Validuje ownership (ownerEmail nebo x-user-id)
 *      b) Validuje, že ticket je 'valid' a status 'paid' v orderu
 *      c) Validuje, že target ticket_type je v stejné akci a má vyšší cenu
 *      d) Validuje, že target má dostupnou kapacitu (remaining_qty > 0)
 *      e) Vytvoří fresh "upgrade order" se status='pending', total = rozdíl
 *      f) Vrátí gateway URL k mock-gopay
 *      g) Po platbě webhook UPDATE ticket.ticket_type_id = target
 *
 * Pro demo: zjednodušíme a uděláme instant (status='paid' přímo).
 */

import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface TicketRow {
  id: string;
  status: string;
  ticket_type_id: string;
  current_price: number;
  current_name: string;
  owner_id: string;
  event_id: string;
  order_status: string;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { ticketId: string } },
): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(params.ticketId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
  }

  const t = await db().query<TicketRow>(
    `SELECT t.id, t.status, t.ticket_type_id, t.owner_id,
            tt.base_price AS current_price, tt.name AS current_name,
            o.event_id, o.status AS order_status
     FROM tickets.tickets t
     JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
     JOIN orders.orders o ON o.id = t.order_id
     WHERE t.id = $1`,
    [params.ticketId],
  );
  if (t.rows.length === 0) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  }
  const ticket = t.rows[0];

  // Najdi ticket types stejné akce s vyšší cenou
  const upgrades = await db().query<{
    id: string;
    name: string;
    base_price: number;
    remaining_qty: number;
  }>(
    `SELECT id, name, base_price, remaining_qty
     FROM catalog.ticket_types
     WHERE event_id = $1 AND id <> $2 AND base_price > $3 AND remaining_qty > 0
     ORDER BY base_price ASC`,
    [ticket.event_id, ticket.ticket_type_id, ticket.current_price],
  );

  return NextResponse.json({
    currentTicket: {
      id: ticket.id,
      status: ticket.status,
      ticketTypeId: ticket.ticket_type_id,
      ticketTypeName: ticket.current_name,
      pricePaidHalire: ticket.current_price,
    },
    eligible: ticket.status === 'valid' && ticket.order_status === 'paid',
    upgrades: upgrades.rows.map((u) => ({
      ticketTypeId: u.id,
      name: u.name,
      newPriceHalire: u.base_price,
      diffHalire: u.base_price - ticket.current_price,
      remaining: u.remaining_qty,
    })),
  });
}

const upgradeSchema = z.object({
  targetTicketTypeId: z.string().uuid(),
  ownerEmail: z.string().email().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { ticketId: string } },
): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(params.ticketId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
  }
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = upgradeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 422 });
  }

  const headerUserId = req.headers.get('x-user-id');
  const client = await db().connect();
  try {
    await client.query('BEGIN');

    const t = await client.query<TicketRow>(
      `SELECT t.id, t.status, t.ticket_type_id, t.owner_id,
              tt.base_price AS current_price, tt.name AS current_name,
              o.event_id, o.user_id AS order_user_id, o.status AS order_status,
              u.email AS owner_email
       FROM tickets.tickets t
       JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
       JOIN orders.orders o ON o.id = t.order_id
       JOIN identity.users u ON u.id = t.owner_id
       WHERE t.id = $1
       FOR UPDATE`,
      [params.ticketId],
    );
    if (t.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }
    const ticket = t.rows[0] as TicketRow & {
      order_user_id: string;
      owner_email: string;
    };

    // Ownership check
    const ownerOk =
      (headerUserId && headerUserId === ticket.owner_id) ||
      (parsed.data.ownerEmail &&
        parsed.data.ownerEmail.toLowerCase() === ticket.owner_email.toLowerCase());
    if (!ownerOk) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'NOT_OWNER', message: 'Můžeš upgradnout jen vlastní lístek.' },
        { status: 403 },
      );
    }

    if (ticket.status !== 'valid') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'TICKET_NOT_VALID', status: ticket.status },
        { status: 409 },
      );
    }
    if (ticket.order_status !== 'paid') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'ORDER_NOT_PAID' },
        { status: 409 },
      );
    }

    const targetRes = await client.query<{
      id: string;
      name: string;
      base_price: number;
      event_id: string;
      remaining_qty: number;
    }>(
      `SELECT id, name, base_price, event_id, remaining_qty
       FROM catalog.ticket_types
       WHERE id = $1
       FOR UPDATE`,
      [parsed.data.targetTicketTypeId],
    );
    if (targetRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Target not found' }, { status: 404 });
    }
    const target = targetRes.rows[0];
    if (target.event_id !== ticket.event_id) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'TARGET_DIFFERENT_EVENT' },
        { status: 422 },
      );
    }
    if (target.base_price <= ticket.current_price) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'TARGET_NOT_UPGRADE', message: 'Cílový typ není upgrade (cena ≤ aktuální).' },
        { status: 422 },
      );
    }
    if (target.remaining_qty < 1) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'TARGET_SOLD_OUT' },
        { status: 409 },
      );
    }

    const diffHalire = target.base_price - ticket.current_price;

    // Pro demo: instant payment (mock GoPay obejdeme).
    // Vytvoříme separátní upgrade order (status='paid'), na ticketu změníme ticket_type_id,
    // dekrementujeme target remaining_qty.
    const upgradeOrderId = randomUUID();
    await client.query(
      `INSERT INTO orders.orders
         (id, user_id, event_id, status, total_amount, currency, locale,
          payment_provider, gopay_payment_id, idempotency_key,
          discount_halire, requires_age_verification,
          expires_at, paid_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'paid', $4, 'CZK', 'cs',
               'gopay', $5, $6,
               0, FALSE,
               NOW() + INTERVAL '15 minutes', NOW(), NOW(), NOW())`,
      [
        upgradeOrderId,
        ticket.order_user_id,
        ticket.event_id,
        diffHalire,
        `upgrade-${ticket.id}`,
        randomUUID(),
      ],
    );
    await client.query(
      `INSERT INTO orders.order_items
         (order_id, ticket_type_id, quantity, unit_price, total_price, created_at)
       VALUES ($1, $2, 1, $3, $3, NOW())`,
      [upgradeOrderId, target.id, diffHalire],
    );
    // Update ticket
    await client.query(
      `UPDATE tickets.tickets
       SET ticket_type_id = $1, original_price = original_price + $2, updated_at = NOW()
       WHERE id = $3`,
      [target.id, diffHalire, ticket.id],
    );
    // Decrement remaining_qty cíle
    await client.query(
      `UPDATE catalog.ticket_types SET remaining_qty = remaining_qty - 1 WHERE id = $1`,
      [target.id],
    );
    // Audit
    await client.query(
      `INSERT INTO audit.audit_log
         (schema_name, table_name, record_id, action, actor_id, actor_type,
          old_values, new_values)
       VALUES ('tickets', 'tickets', $1, 'UPDATE', $2, 'user',
               $3::jsonb, $4::jsonb)`,
      [
        ticket.id,
        ticket.owner_id,
        JSON.stringify({ ticket_type_id: ticket.ticket_type_id }),
        JSON.stringify({
          kind: 'upgrade',
          new_ticket_type_id: target.id,
          new_ticket_type_name: target.name,
          diff_halire: diffHalire,
          upgrade_order_id: upgradeOrderId,
        }),
      ],
    );

    await client.query('COMMIT');
    return NextResponse.json({
      ok: true,
      ticketId: ticket.id,
      newTicketTypeId: target.id,
      newTicketTypeName: target.name,
      paidHalire: diffHalire,
      upgradeOrderId,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /api/buyer/tickets/[id]/upgrade]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
