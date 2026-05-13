import { randomUUID } from 'crypto';
import type { DbAdapter, FnbMenuItem, FnbPreorder, FnbOrderItem } from '../lib/types.js';

// ─── Internal DB row shapes ──────────────────────────────────────────────────

interface MenuItemRow {
  id: string;
  promoter_id: string;
  event_id: string | null;
  name: string;
  description: string | null;
  category: string;
  price_halire: number;
  max_quantity_per_order: number;
  stock_limit: number | null;
  available: boolean;
  image_url: string | null;
}

interface PreorderRow {
  id: string;
  order_id: string;
  event_id: string;
  promoter_id: string;
  user_id: string | null;
  items: FnbOrderItem[] | string;
  total_halire: number;
  status: string;
  pickup_code: string;
  pickup_qr_data: string;
  pickup_window_start: string | null;
  pickup_window_end: string | null;
  created_at: string;
}

interface StatsRow {
  name: string;
  quantity: number;
  revenue: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rowToMenuItem(row: MenuItemRow): FnbMenuItem {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    eventId: row.event_id ?? undefined,
    name: row.name,
    description: row.description ?? undefined,
    category: row.category as FnbMenuItem['category'],
    priceHalire: row.price_halire,
    maxQuantityPerOrder: row.max_quantity_per_order,
    stockLimit: row.stock_limit ?? undefined,
    available: row.available,
    imageUrl: row.image_url ?? undefined,
  };
}

function rowToPreorder(row: PreorderRow): FnbPreorder {
  const items: FnbOrderItem[] =
    typeof row.items === 'string' ? (JSON.parse(row.items) as FnbOrderItem[]) : row.items;
  return {
    id: row.id,
    orderId: row.order_id,
    eventId: row.event_id,
    promoterId: row.promoter_id,
    userId: row.user_id ?? undefined,
    items,
    totalHalire: row.total_halire,
    status: row.status as FnbPreorder['status'],
    pickupCode: row.pickup_code,
    pickupQrData: row.pickup_qr_data,
    pickupWindowStart: row.pickup_window_start ?? undefined,
    pickupWindowEnd: row.pickup_window_end ?? undefined,
    createdAt: typeof row.created_at === 'string' ? row.created_at : new Date(row.created_at).toISOString(),
  };
}

function generatePickupCode(): string {
  // 6-digit numeric code, zero-padded
  const num = Math.floor(Math.random() * 1_000_000);
  return String(num).padStart(6, '0');
}

// ─── Service functions ────────────────────────────────────────────────────────

/**
 * Načte dostupné menu pro event (položky pro konkrétní event + globální položky promotéra).
 */
export async function getMenuForEvent(
  eventId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<FnbMenuItem[]> {
  const rows = await db.query<MenuItemRow>(
    `SELECT * FROM fnb_menu_items
     WHERE promoter_id = $1
       AND available = true
       AND (event_id = $2 OR event_id IS NULL)
     ORDER BY name`,
    [promoterId, eventId],
  );
  return rows.map(rowToMenuItem);
}

/**
 * Vytvoří pre-order (váže se na ticket orderId).
 */
export async function createPreorder(
  orderId: string,
  eventId: string,
  promoterId: string,
  items: Array<{ menuItemId: string; quantity: number }>,
  db: DbAdapter,
): Promise<FnbPreorder> {
  if (items.length === 0) {
    throw new Error('Pre-order musí obsahovat alespoň jednu položku');
  }

  // Load all referenced menu items
  const menuItemIds = items.map((i) => i.menuItemId);
  const placeholders = menuItemIds.map((_, idx) => `$${idx + 1}`).join(', ');
  const menuRows = await db.query<MenuItemRow>(
    `SELECT * FROM fnb_menu_items WHERE id IN (${placeholders})`,
    menuItemIds,
  );

  const menuMap = new Map<string, MenuItemRow>(menuRows.map((r) => [r.id, r]));

  const orderItems: FnbOrderItem[] = [];
  let totalHalire = 0;

  for (const item of items) {
    const menuItem = menuMap.get(item.menuItemId);
    if (!menuItem) {
      throw new Error(`Menu item ${item.menuItemId} nenalezen`);
    }
    if (!menuItem.available) {
      throw new Error(`Menu item "${menuItem.name}" není dostupný`);
    }
    if (item.quantity > menuItem.max_quantity_per_order) {
      throw new Error(
        `Množství ${item.quantity} překračuje maximum ${menuItem.max_quantity_per_order} pro "${menuItem.name}"`,
      );
    }
    if (menuItem.stock_limit !== null && item.quantity > menuItem.stock_limit) {
      throw new Error(
        `Nedostatečný sklad pro "${menuItem.name}": dostupno ${menuItem.stock_limit}, požadováno ${item.quantity}`,
      );
    }

    const subtotalHalire = menuItem.price_halire * item.quantity;
    totalHalire += subtotalHalire;

    orderItems.push({
      menuItemId: item.menuItemId,
      name: menuItem.name,
      quantity: item.quantity,
      unitPriceHalire: menuItem.price_halire,
      subtotalHalire,
    });
  }

  const id = randomUUID();
  const pickupCode = generatePickupCode();
  const pickupQrData = `${pickupCode}:${orderId}`;
  const now = new Date().toISOString();

  await db.execute(
    `INSERT INTO fnb_preorders
       (id, order_id, event_id, promoter_id, items, total_halire, status, pickup_code, pickup_qr_data, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9)`,
    [id, orderId, eventId, promoterId, JSON.stringify(orderItems), totalHalire, pickupCode, pickupQrData, now],
  );

  return {
    id,
    orderId,
    eventId,
    promoterId,
    items: orderItems,
    totalHalire,
    status: 'pending',
    pickupCode,
    pickupQrData,
    createdAt: now,
  };
}

/**
 * Potvrdí pre-order (po zaplacení ticket order).
 */
export async function confirmPreorder(
  preorderId: string,
  db: DbAdapter,
): Promise<FnbPreorder> {
  await db.execute(
    `UPDATE fnb_preorders SET status = 'confirmed' WHERE id = $1`,
    [preorderId],
  );
  const rows = await db.query<PreorderRow>(
    `SELECT * FROM fnb_preorders WHERE id = $1`,
    [preorderId],
  );
  if (rows.length === 0) {
    throw new Error(`Pre-order ${preorderId} nenalezen`);
  }
  return rowToPreorder(rows[0]);
}

/**
 * Označí jako připravený k vyzvednutí.
 */
export async function markReady(
  preorderId: string,
  db: DbAdapter,
): Promise<FnbPreorder> {
  await db.execute(
    `UPDATE fnb_preorders SET status = 'ready' WHERE id = $1`,
    [preorderId],
  );
  const rows = await db.query<PreorderRow>(
    `SELECT * FROM fnb_preorders WHERE id = $1`,
    [preorderId],
  );
  if (rows.length === 0) {
    throw new Error(`Pre-order ${preorderId} nenalezen`);
  }
  return rowToPreorder(rows[0]);
}

/**
 * Zákazník si vyzvedne — ověří pickup code.
 */
export async function processPickup(
  pickupCode: string,
  eventId: string,
  db: DbAdapter,
): Promise<FnbPreorder> {
  const rows = await db.query<PreorderRow>(
    `SELECT * FROM fnb_preorders WHERE pickup_code = $1 AND event_id = $2`,
    [pickupCode, eventId],
  );
  if (rows.length === 0) {
    throw new Error(`Pickup code ${pickupCode} nenalezen pro tuto akci`);
  }
  const preorder = rowToPreorder(rows[0]);
  if (preorder.status !== 'ready') {
    throw new Error(`Pre-order není připraven k vyzvednutí (status: ${preorder.status})`);
  }
  await db.execute(
    `UPDATE fnb_preorders SET status = 'picked_up' WHERE id = $1`,
    [preorder.id],
  );
  return { ...preorder, status: 'picked_up' };
}

/**
 * Zruší pre-order (jen pokud status='pending').
 */
export async function cancelPreorder(
  preorderId: string,
  db: DbAdapter,
): Promise<void> {
  const rows = await db.query<PreorderRow>(
    `SELECT * FROM fnb_preorders WHERE id = $1`,
    [preorderId],
  );
  if (rows.length === 0) {
    throw new Error(`Pre-order ${preorderId} nenalezen`);
  }
  const preorder = rowToPreorder(rows[0]);
  if (preorder.status !== 'pending') {
    throw new Error(`Pre-order nelze zrušit — status je '${preorder.status}', očekáváno 'pending'`);
  }
  await db.execute(
    `UPDATE fnb_preorders SET status = 'cancelled' WHERE id = $1`,
    [preorderId],
  );
}

/**
 * Statistiky prodeje F&B pro event.
 */
export async function getEventFnbStats(
  eventId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<{
  totalOrders: number;
  totalRevenue: number;
  itemSummary: Array<{ name: string; quantity: number; revenue: number }>;
}> {
  const countRows = await db.query<{ total_orders: number; total_revenue: number }>(
    `SELECT COUNT(*) as total_orders, COALESCE(SUM(total_halire), 0) as total_revenue
     FROM fnb_preorders
     WHERE event_id = $1 AND promoter_id = $2
       AND status NOT IN ('cancelled')`,
    [eventId, promoterId],
  );

  const summaryRows = await db.query<StatsRow>(
    `SELECT * FROM fnb_preorders WHERE event_id = $1 AND promoter_id = $2 AND status NOT IN ('cancelled')`,
    [eventId, promoterId],
  );

  const itemMap = new Map<string, { name: string; quantity: number; revenue: number }>();

  for (const row of summaryRows) {
    const items: FnbOrderItem[] =
      typeof (row as unknown as PreorderRow).items === 'string'
        ? (JSON.parse((row as unknown as PreorderRow).items as string) as FnbOrderItem[])
        : ((row as unknown as PreorderRow).items as FnbOrderItem[]);
    for (const item of items) {
      const existing = itemMap.get(item.name);
      if (existing) {
        existing.quantity += item.quantity;
        existing.revenue += item.subtotalHalire;
      } else {
        itemMap.set(item.name, {
          name: item.name,
          quantity: item.quantity,
          revenue: item.subtotalHalire,
        });
      }
    }
  }

  const statsRow = countRows[0];
  return {
    totalOrders: Number(statsRow?.total_orders ?? 0),
    totalRevenue: Number(statsRow?.total_revenue ?? 0),
    itemSummary: Array.from(itemMap.values()),
  };
}
