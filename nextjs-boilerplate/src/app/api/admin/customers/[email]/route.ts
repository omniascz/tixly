import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';

const patchSchema = z.object({
  notes: z.string().max(2000).optional(),
  optedOut: z.boolean().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: { email: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const email = decodeURIComponent(params.email);

    const contactRes = await db().query<{
      email: string;
      name: string | null;
      phone: string | null;
      historical_purchases: number | null;
      historical_spend_halire: number | null;
      import_source: string | null;
      opted_out: boolean;
      opted_out_at: string | null;
      notes: string | null;
      first_purchase_at: string | null;
      last_purchase_at: string | null;
      created_at: string;
    }>(
      `SELECT email, name, phone, historical_purchases, historical_spend_halire,
              import_source, opted_out, opted_out_at, notes,
              first_purchase_at, last_purchase_at, created_at
       FROM platform.promoter_contacts
       WHERE promoter_id = $1 AND email = $2`,
      [promoter.promoterId, email],
    );

    const contact = contactRes.rows[0];
    if (!contact) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const ordersRes = await db().query<{
      id: string;
      created_at: string;
      total_amount: number;
      status: string;
      event_title: string;
    }>(
      `SELECT o.id, o.created_at, o.total_amount, o.status, e.title AS event_title
       FROM orders.orders o
       JOIN identity.users u ON u.id = o.user_id
       JOIN orders.order_items oi ON oi.order_id = o.id
       JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
       JOIN catalog.events e ON e.id = tt.event_id
       WHERE e.promoter_id = $1 AND u.email = $2 AND o.status = 'paid'
       ORDER BY o.created_at DESC
       LIMIT 50`,
      [promoter.promoterId, email],
    );

    return NextResponse.json({
      contact: {
        email: contact.email,
        name: contact.name,
        phone: contact.phone,
        historicalPurchases: contact.historical_purchases ?? 0,
        historicalSpendHalire: contact.historical_spend_halire ?? 0,
        importSource: contact.import_source,
        optedOut: contact.opted_out,
        optedOutAt: contact.opted_out_at,
        notes: contact.notes,
        firstPurchaseAt: contact.first_purchase_at,
        lastPurchaseAt: contact.last_purchase_at,
        createdAt: contact.created_at,
      },
      orders: ordersRes.rows.map((o) => ({
        id: o.id,
        createdAt: o.created_at,
        totalAmount: o.total_amount,
        status: o.status,
        eventTitle: o.event_title,
      })),
    });
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { email: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const email = decodeURIComponent(params.email);
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
    }
    const { notes, optedOut } = parsed.data;

    const updates: string[] = [];
    const args: unknown[] = [promoter.promoterId, email];

    if (notes !== undefined) {
      args.push(notes);
      updates.push(`notes = $${args.length}`);
    }
    if (optedOut !== undefined) {
      args.push(optedOut);
      updates.push(`opted_out = $${args.length}`);
      if (optedOut) {
        updates.push(`opted_out_at = NOW()`);
      } else {
        updates.push(`opted_out_at = NULL`);
      }
    }

    if (updates.length === 0) {
      return NextResponse.json({ ok: true });
    }

    updates.push(`updated_at = NOW()`);

    await db().query(
      `UPDATE platform.promoter_contacts
       SET ${updates.join(', ')}
       WHERE promoter_id = $1 AND email = $2`,
      args,
    );

    return NextResponse.json({ ok: true });
  });
}
