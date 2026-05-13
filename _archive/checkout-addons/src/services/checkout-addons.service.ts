import { randomUUID } from 'crypto';
import type { DbAdapter, CheckoutAddon, OrderAddon, AddonCartItem, AddonCategory } from '../lib/types.js';

// ─── Internal DB row shapes ──────────────────────────────────────────────────

interface AddonRow {
  id: string;
  promoter_id: string;
  event_id: string | null;
  name: string;
  description: string | null;
  category: string;
  price_halire: number;
  max_quantity: number;
  stock_available: number | null;
  image_url: string | null;
  available: boolean;
  display_order: number;
  created_at: string;
}

interface OrderAddonRow {
  id: string;
  order_id: string;
  addon_id: string;
  addon_name: string;
  category: string;
  quantity: number;
  unit_price_halire: number;
  subtotal_halire: number;
  status: string;
  created_at: string;
}

interface TotalRow {
  total: number;
}

interface StatsRow {
  addon_id: string;
  name: string;
  category: string;
  sold_count: number;
  revenue: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rowToAddon(row: AddonRow): CheckoutAddon {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    eventId: row.event_id ?? undefined,
    name: row.name,
    description: row.description ?? undefined,
    category: row.category as AddonCategory,
    priceHalire: row.price_halire,
    maxQuantity: row.max_quantity,
    stockAvailable: row.stock_available ?? undefined,
    imageUrl: row.image_url ?? undefined,
    available: row.available,
    displayOrder: row.display_order,
  };
}

function rowToOrderAddon(row: OrderAddonRow): OrderAddon {
  return {
    id: row.id,
    orderId: row.order_id,
    addonId: row.addon_id,
    addonName: row.addon_name,
    category: row.category as AddonCategory,
    quantity: row.quantity,
    unitPriceHalire: row.unit_price_halire,
    subtotalHalire: row.subtotal_halire,
    status: row.status as OrderAddon['status'],
    createdAt: typeof row.created_at === 'string' ? row.created_at : new Date(row.created_at).toISOString(),
  };
}

// ─── Service functions ────────────────────────────────────────────────────────

/**
 * Dostupné addony pro event (seřazené dle displayOrder).
 */
export async function getAddonsForEvent(
  eventId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<CheckoutAddon[]> {
  const rows = await db.query<AddonRow>(
    `SELECT * FROM checkout_addons
     WHERE promoter_id = $1
       AND available = true
       AND (event_id = $2 OR event_id IS NULL)
     ORDER BY display_order ASC, name ASC`,
    [promoterId, eventId],
  );
  return rows.map(rowToAddon);
}

/**
 * Přidá addony k existující objednávce (před platbou).
 */
export async function addAddonsToOrder(
  orderId: string,
  promoterId: string,
  items: AddonCartItem[],
  db: DbAdapter,
): Promise<OrderAddon[]> {
  if (items.length === 0) {
    throw new Error('Seznam addonů nesmí být prázdný');
  }

  const addonIds = items.map((i) => i.addonId);
  const placeholders = addonIds.map((_, idx) => `$${idx + 1}`).join(', ');
  const addonRows = await db.query<AddonRow>(
    `SELECT * FROM checkout_addons WHERE id IN (${placeholders})`,
    addonIds,
  );

  const addonMap = new Map<string, AddonRow>(addonRows.map((r) => [r.id, r]));
  const result: OrderAddon[] = [];
  const now = new Date().toISOString();

  for (const item of items) {
    const addon = addonMap.get(item.addonId);
    if (!addon) {
      throw new Error(`Addon ${item.addonId} nenalezen`);
    }
    if (!addon.available) {
      throw new Error(`Addon "${addon.name}" není dostupný`);
    }
    if (item.quantity > addon.max_quantity) {
      throw new Error(
        `Množství ${item.quantity} překračuje maximum ${addon.max_quantity} pro "${addon.name}"`,
      );
    }
    if (addon.stock_available !== null && item.quantity > addon.stock_available) {
      throw new Error(
        `Nedostatečný sklad pro "${addon.name}": dostupno ${addon.stock_available}, požadováno ${item.quantity}`,
      );
    }

    const subtotalHalire = addon.price_halire * item.quantity;
    const id = randomUUID();

    await db.execute(
      `INSERT INTO order_addons
         (id, order_id, addon_id, addon_name, category, quantity, unit_price_halire, subtotal_halire, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9)`,
      [id, orderId, addon.id, addon.name, addon.category, item.quantity, addon.price_halire, subtotalHalire, now],
    );

    result.push({
      id,
      orderId,
      addonId: addon.id,
      addonName: addon.name,
      category: addon.category as AddonCategory,
      quantity: item.quantity,
      unitPriceHalire: addon.price_halire,
      subtotalHalire,
      status: 'pending',
      createdAt: now,
    });
  }

  return result;
}

/**
 * Odebere addon z objednávky (před platbou).
 */
export async function removeAddonFromOrder(
  orderAddonId: string,
  orderId: string,
  db: DbAdapter,
): Promise<void> {
  const rows = await db.query<OrderAddonRow>(
    `SELECT * FROM order_addons WHERE id = $1`,
    [orderAddonId],
  );
  if (rows.length === 0) {
    throw new Error(`Order addon ${orderAddonId} nenalezen`);
  }
  if (rows[0].order_id !== orderId) {
    throw new Error('Addon nepatří k této objednávce');
  }
  await db.execute(
    `UPDATE order_addons SET status = 'cancelled' WHERE id = $1`,
    [orderAddonId],
  );
}

/**
 * Potvrdí addony po zaplacení.
 */
export async function confirmOrderAddons(
  orderId: string,
  db: DbAdapter,
): Promise<number> {
  const rows = await db.query<OrderAddonRow>(
    `SELECT id FROM order_addons WHERE order_id = $1 AND status = 'pending'`,
    [orderId],
  );
  await db.execute(
    `UPDATE order_addons SET status = 'confirmed' WHERE order_id = $1 AND status = 'pending'`,
    [orderId],
  );
  return rows.length;
}

/**
 * Vrátí addony pro objednávku.
 */
export async function getOrderAddons(
  orderId: string,
  db: DbAdapter,
): Promise<OrderAddon[]> {
  const rows = await db.query<OrderAddonRow>(
    `SELECT * FROM order_addons WHERE order_id = $1 ORDER BY created_at ASC`,
    [orderId],
  );
  return rows.map(rowToOrderAddon);
}

/**
 * Celková cena addonů v objednávce.
 */
export async function getAddonsTotal(
  orderId: string,
  db: DbAdapter,
): Promise<number> {
  const rows = await db.query<TotalRow>(
    `SELECT COALESCE(SUM(subtotal_halire), 0) as total
     FROM order_addons
     WHERE order_id = $1 AND status != 'cancelled'`,
    [orderId],
  );
  return Number(rows[0]?.total ?? 0);
}

/**
 * Statistiky addonů pro event.
 */
export async function getAddonStats(
  eventId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<Array<{
  addonId: string;
  name: string;
  category: AddonCategory;
  soldCount: number;
  revenue: number;
}>> {
  const rows = await db.query<StatsRow>(
    `SELECT oa.addon_id, ca.name, ca.category,
            SUM(oa.quantity) as sold_count,
            SUM(oa.subtotal_halire) as revenue
     FROM order_addons oa
     JOIN checkout_addons ca ON ca.id = oa.addon_id
     WHERE ca.event_id = $1 AND ca.promoter_id = $2
       AND oa.status != 'cancelled'
     GROUP BY oa.addon_id, ca.name, ca.category`,
    [eventId, promoterId],
  );
  return rows.map((r) => ({
    addonId: r.addon_id,
    name: r.name,
    category: r.category as AddonCategory,
    soldCount: Number(r.sold_count),
    revenue: Number(r.revenue),
  }));
}
