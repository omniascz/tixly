// Cart Service — ukládání a obnova košíků.
// Každý upsert prodloužuje TTL košíku — opuštění = žádný update po X minutách.

import { assignAbVariant } from '../lib/ab-variant';
import { generateRecoveryToken, verifyRecoveryToken } from '../lib/recovery-token';
import { CartNotFoundError, CartAlreadyConvertedError } from '../types/cart.types';
import type { AbandonedCart, SaveCartRequest, RecoverCartResponse } from '../types/cart.types';
import { withTenantContext } from '@tixly/rls-multitenancy';
import type { DbAdapter } from '@tixly/rls-multitenancy';

interface KafkaAdapter { send(topic: string, payload: unknown): Promise<void>; }

interface ServiceDeps { db: DbAdapter; kafka: KafkaAdapter; }

// ---------------------------------------------------------------------------
// saveCart — upsert košíku (volá se při každé změně výběru vstupenek)
// ---------------------------------------------------------------------------
export async function saveCart(
  deps: ServiceDeps,
  userId: string,
  request: SaveCartRequest,
): Promise<AbandonedCart> {
  return withTenantContext(deps.db, { userId, role: 'buyer' }, async (db) => {
    const totalAmount = request.items.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity, 0,
    );
    const abVariant = assignAbVariant(userId);

    const [row] = await db.query<{
      id: string; status: string; ab_variant: string;
      created_at: Date; updated_at: Date;
    }>(
      `INSERT INTO orders.abandoned_carts
         (user_id, event_id, items, total_amount, ab_variant, status)
       VALUES ($1, $2, $3::jsonb, $4, $5, 'active')
       ON CONFLICT (user_id, event_id) WHERE status IN ('active','abandoned') DO UPDATE SET
         items = EXCLUDED.items,
         total_amount = EXCLUDED.total_amount,
         status = 'active',
         updated_at = NOW()
       RETURNING id, status, ab_variant, created_at, updated_at`,
      [userId, request.eventId, JSON.stringify(request.items), totalAmount, abVariant],
    );

    deps.kafka.send('tixly.cart.saved', { cartId: row.id, userId, eventId: request.eventId }).catch(() => {});

    return {
      id: row.id,
      userId,
      eventId: request.eventId,
      items: request.items,
      totalAmount,
      status: row.status as AbandonedCart['status'],
      abVariant: row.ab_variant as AbandonedCart['abVariant'],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

// ---------------------------------------------------------------------------
// markConverted — volá se po úspěšné objednávce
// ---------------------------------------------------------------------------
export async function markConverted(
  deps: ServiceDeps,
  userId: string,
  eventId: string,
): Promise<void> {
  await withTenantContext(deps.db, { userId, role: 'buyer' }, async (db) => {
    await db.execute(
      `UPDATE orders.abandoned_carts
       SET status = 'converted', converted_at = NOW()
       WHERE user_id = $1 AND event_id = $2 AND status IN ('active','abandoned','recovered')`,
      [userId, eventId],
    );
  });
  deps.kafka.send('tixly.cart.converted', { userId, eventId }).catch(() => {});
}

// ---------------------------------------------------------------------------
// recoverCart — fan klikl na recovery link
// ---------------------------------------------------------------------------
export async function recoverCart(
  deps: ServiceDeps,
  token: string,
): Promise<RecoverCartResponse> {
  const { cartId, userId } = await verifyRecoveryToken(token);

  return withTenantContext(deps.db, { userId, role: 'buyer' }, async (db) => {
    const [row] = await db.query<{
      id: string; event_id: string; items: CartItem[]; total_amount: number;
      status: string; ab_variant: string; created_at: Date; updated_at: Date;
    }>(
      `UPDATE orders.abandoned_carts
       SET status = 'recovered', recovered_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status IN ('abandoned','active')
       RETURNING id, event_id, items, total_amount, status, ab_variant, created_at, updated_at`,
      [cartId, userId],
    );

    if (!row) {
      // Zkusíme zjistit proč — converted vs not found
      const [existing] = await db.query<{ status: string }>(
        `SELECT status FROM orders.abandoned_carts WHERE id = $1`, [cartId],
      );
      if (existing?.status === 'converted') throw new CartAlreadyConvertedError('Objednávka již byla dokončena.');
      throw new CartNotFoundError('Košík nenalezen.');
    }

    deps.kafka.send('tixly.cart.recovered', { cartId, userId }).catch(() => {});

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tixly.cz';
    const checkoutUrl = `${baseUrl}/cs/akce/${row.event_id}/koupit?cart=${cartId}`;

    return {
      cart: {
        id: row.id,
        userId,
        eventId: row.event_id,
        items: row.items,
        totalAmount: row.total_amount,
        status: 'recovered',
        abVariant: row.ab_variant as AbandonedCart['abVariant'],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
      checkoutUrl,
    };
  });
}

// Pomocný typ
interface CartItem { ticketTypeId: string; ticketTypeName: string; quantity: number; unitPrice: number; }
