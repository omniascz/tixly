import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import { z } from 'zod';

const createSchema = z.object({
  eventId: z.string().uuid(),
  items: z
    .array(
      z.object({
        menuItemId: z.string().uuid(),
        quantity: z.number().int().min(1).max(50),
      }),
    )
    .min(1)
    .max(20),
});

export async function POST(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 422 },
      );
    }
    const { eventId, items } = parsed.data;

    return runWithServiceContext(async () => {
      const menuItemIds = items.map((i) => i.menuItemId);
      const menuRows = await db().query<{
        id: string;
        name: string;
        price_halire: number;
        available_count: number | null;
        is_active: boolean;
      }>(
        `SELECT id, name, price_halire, available_count, is_active
         FROM catalog.foyer_menu_items
         WHERE id = ANY($1::uuid[]) AND event_id = $2`,
        [menuItemIds, eventId],
      );

      if (menuRows.rows.length !== menuItemIds.length) {
        return NextResponse.json(
          { error: 'One or more menu items not found for this event' },
          { status: 422 },
        );
      }

      const menuMap = new Map(menuRows.rows.map((r) => [r.id, r]));

      for (const item of items) {
        const menuItem = menuMap.get(item.menuItemId);
        if (!menuItem?.is_active) {
          return NextResponse.json(
            { error: `Item ${item.menuItemId} is not active` },
            { status: 422 },
          );
        }
        if (menuItem.available_count !== null && menuItem.available_count < item.quantity) {
          return NextResponse.json(
            { error: `Insufficient stock for "${menuItem.name}"` },
            { status: 409 },
          );
        }
      }

      const totalHalire = items.reduce((sum, item) => {
        const menuItem = menuMap.get(item.menuItemId)!;
        return sum + menuItem.price_halire * item.quantity;
      }, 0);

      const userRow = await db().query<{ email: string }>(
        `SELECT email FROM identity.users WHERE id = $1`,
        [userId],
      );
      const buyerEmail = userRow.rows[0]?.email ?? null;

      const orderRow = await db().query<{ id: string; pickup_qr_token: string }>(
        `INSERT INTO orders.foyer_orders (event_id, user_id, buyer_email, total_halire)
         VALUES ($1, $2, $3, $4)
         RETURNING id, pickup_qr_token`,
        [eventId, userId, buyerEmail, totalHalire],
      );

      const foyerOrderId = orderRow.rows[0].id;
      const pickupQrToken = orderRow.rows[0].pickup_qr_token;

      for (const item of items) {
        const menuItem = menuMap.get(item.menuItemId)!;
        await db().query(
          `INSERT INTO orders.foyer_order_items
             (foyer_order_id, menu_item_id, item_name, quantity, unit_halire)
           VALUES ($1, $2, $3, $4, $5)`,
          [foyerOrderId, item.menuItemId, menuItem.name, item.quantity, menuItem.price_halire],
        );

        if (menuItem.available_count !== null) {
          await db().query(
            `UPDATE catalog.foyer_menu_items
             SET available_count = available_count - $1
             WHERE id = $2 AND available_count >= $1`,
            [item.quantity, item.menuItemId],
          );
        }
      }

      return NextResponse.json(
        {
          foyerOrderId,
          pickupQrToken,
          totalHalire,
          items: items.map((item) => {
            const menuItem = menuMap.get(item.menuItemId)!;
            return {
              menuItemId: item.menuItemId,
              name: menuItem.name,
              quantity: item.quantity,
              unitHalire: menuItem.price_halire,
            };
          }),
        },
        { status: 201 },
      );
    });
  });
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
    const url = new URL(req.url);
    const orderId = url.searchParams.get('orderId');
    if (!orderId) {
      return NextResponse.json({ error: 'orderId query param required' }, { status: 422 });
    }

    return runWithServiceContext(async () => {
      const order = await db().query<{
        id: string;
        event_id: string;
        pickup_qr_token: string;
        total_halire: number;
        status: string;
        buyer_email: string | null;
        created_at: string;
      }>(
        `SELECT id, event_id, pickup_qr_token, total_halire, status, buyer_email, created_at
         FROM orders.foyer_orders
         WHERE id = $1 AND user_id = $2`,
        [orderId, userId],
      );

      if (order.rows.length === 0) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }

      const itemsRows = await db().query<{
        item_name: string;
        quantity: number;
        unit_halire: number;
      }>(
        `SELECT item_name, quantity, unit_halire
         FROM orders.foyer_order_items
         WHERE foyer_order_id = $1`,
        [orderId],
      );

      const o = order.rows[0];
      return NextResponse.json({
        id: o.id,
        eventId: o.event_id,
        pickupQrToken: o.pickup_qr_token,
        totalHalire: o.total_halire,
        status: o.status,
        buyerEmail: o.buyer_email,
        createdAt: o.created_at,
        items: itemsRows.rows,
      });
    });
  });
}
