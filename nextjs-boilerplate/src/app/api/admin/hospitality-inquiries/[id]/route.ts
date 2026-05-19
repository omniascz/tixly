/**
 * PATCH /api/admin/hospitality-inquiries/[id]
 * Body: { status, internalNotes?, invoiceRef? }
 *
 * Allowed transitions: pending → confirmed → invoiced → paid; reject any time;
 * cancel any time.
 *
 * Při 'confirmed' decrement remaining_qty.
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

const STATUS_VALUES = ['pending', 'confirmed', 'invoiced', 'paid', 'rejected', 'cancelled'] as const;

const schema = z.object({
  status: z.enum(STATUS_VALUES),
  internalNotes: z.string().max(2000).optional(),
  invoiceRef: z.string().max(100).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active' || promoter.role === 'staff') {
    return NextResponse.json({ error: 'ADMIN_OR_OWNER_ONLY' }, { status: 403 });
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query<{
      id: string;
      package_id: string;
      quantity: number;
      status: string;
      promoter_id: string;
    }>(
      `SELECT i.id, i.package_id, i.quantity, i.status, e.promoter_id
       FROM orders.hospitality_inquiries i
       JOIN catalog.hospitality_packages p ON p.id = i.package_id
       JOIN catalog.events e ON e.id = p.event_id
       WHERE i.id = $1 FOR UPDATE`,
      [params.id],
    );
    if (cur.rows.length === 0 || cur.rows[0].promoter_id !== promoter.promoterId) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const inquiry = cur.rows[0];

    // Pokud transition pending → confirmed, decrement remaining_qty
    if (inquiry.status === 'pending' && parsed.data.status === 'confirmed') {
      const upd = await client.query(
        `UPDATE catalog.hospitality_packages
         SET remaining_qty = remaining_qty - $2
         WHERE id = $1 AND remaining_qty >= $2`,
        [inquiry.package_id, inquiry.quantity],
      );
      if (upd.rowCount === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'INSUFFICIENT_REMAINING' },
          { status: 409 },
        );
      }
    }
    // Pokud transition (confirmed|invoiced|paid) → cancelled, refund inventory
    if (
      ['confirmed', 'invoiced', 'paid'].includes(inquiry.status) &&
      parsed.data.status === 'cancelled'
    ) {
      await client.query(
        `UPDATE catalog.hospitality_packages
         SET remaining_qty = remaining_qty + $2
         WHERE id = $1`,
        [inquiry.package_id, inquiry.quantity],
      );
    }

    await client.query(
      `UPDATE orders.hospitality_inquiries
       SET status = $2,
           internal_notes = COALESCE($3, internal_notes),
           invoice_ref = COALESCE($4, invoice_ref),
           confirmed_by_user_id = CASE WHEN $2 = 'confirmed' THEN $5 ELSE confirmed_by_user_id END,
           confirmed_at = CASE WHEN $2 = 'confirmed' THEN NOW() ELSE confirmed_at END,
           updated_at = NOW()
       WHERE id = $1`,
      [
        params.id,
        parsed.data.status,
        parsed.data.internalNotes ?? null,
        parsed.data.invoiceRef ?? null,
        promoter.userId,
      ],
    );

    await client.query('COMMIT');
    return NextResponse.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[hospitality inquiry update]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
