/**
 * GET  /api/my/superfan-bookings          — moje rezervace super fan zážitků
 * POST /api/my/superfan-bookings          — zarezervovat zážitek (po koupi vstupenky)
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import { z } from 'zod';

const bookSchema = z.object({
  experienceId: z.string().uuid(),
  orderId: z.string().uuid(),  // order_id pro ověření, že kupující má vstupenku
});

export async function GET(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
    const r = await db().query(
      `SELECT sb.id, sb.confirmation_code, sb.status, sb.created_at,
              se.name, se.type, se.start_time, se.location, se.price_halire, se.currency,
              e.title AS event_title, e.date_start
         FROM orders.superfan_bookings sb
         JOIN catalog.superfan_experiences se ON se.id = sb.experience_id
         JOIN catalog.events e ON e.id = se.event_id
        WHERE sb.user_id = $1
        ORDER BY sb.created_at DESC`,
      [userId],
    );
    return NextResponse.json({ bookings: r.rows });
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = bookSchema.safeParse(body);
    if (!parsed.success)
      return NextResponse.json({ error: 'BAD_INPUT', issues: parsed.error.issues }, { status: 422 });

    const client = await db().connect();
    try {
      await client.query('BEGIN');

      // Ověřit, že order patří uživateli
      const ord = await client.query(
        `SELECT id FROM orders.orders WHERE id = $1 AND user_id = $2 AND status = 'paid'`,
        [parsed.data.orderId, userId],
      );
      if ((ord.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 });
      }

      // Zamknout experience a zkontrolovat kapacitu
      const exp = await client.query<{
        id: string; capacity: number; reserved_count: number;
        requires_ticket: boolean; price_halire: number; name: string;
      }>(
        `SELECT id, capacity, reserved_count, requires_ticket, price_halire, name
           FROM catalog.superfan_experiences
          WHERE id = $1 AND active = true
            AND (booking_deadline IS NULL OR booking_deadline > NOW())
          FOR UPDATE`,
        [parsed.data.experienceId],
      );
      if ((exp.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'EXPERIENCE_NOT_FOUND' }, { status: 404 });
      }
      const e = exp.rows[0];
      if (e.capacity > 0 && e.reserved_count >= e.capacity) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'EXPERIENCE_FULL', message: 'Kapacita tohoto zážitku je plně obsazena.' },
          { status: 409 },
        );
      }

      // Vlož rezervaci (UNIQUE na order_id + experience_id brání duplicitám)
      const confCode = `SFE-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      const b = await client.query<{ id: string }>(
        `INSERT INTO orders.superfan_bookings
           (experience_id, order_id, user_id, confirmation_code)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (order_id, experience_id) DO NOTHING
         RETURNING id`,
        [parsed.data.experienceId, parsed.data.orderId, userId, confCode],
      );
      if ((b.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'ALREADY_BOOKED' }, { status: 409 });
      }

      await client.query(
        `UPDATE catalog.superfan_experiences SET reserved_count = reserved_count + 1 WHERE id = $1`,
        [parsed.data.experienceId],
      );

      await client.query('COMMIT');
      return NextResponse.json({ ok: true, id: b.rows[0].id, confirmationCode: confCode }, { status: 201 });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });
}
