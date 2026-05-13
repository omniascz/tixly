import { PackageError } from '../lib/package-errors';
import type { PackageDB } from './package.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PackageUsage {
  id: string;
  purchaseId: string;
  itemId: string | null;
  bookingId: string | null;
  usedAt: string;
  quantityUsed: number;
  notes: string | null;
  usedByUserId: string;
  itemName?: string;
  itemType?: string;
}

export interface CreditBalance {
  purchaseId: string;
  initialCredits: number;
  remainingCredits: number;
  updatedAt: string;
}

export interface QuotaInfo {
  used: number;
  total: number;
  remaining: number;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface UsageRow {
  id: string;
  purchase_id: string;
  item_id: string | null;
  booking_id: string | null;
  used_at: string;
  quantity_used: number;
  notes: string | null;
  used_by_user_id: string;
  item_name?: string;
  item_type?: string;
}

interface PurchaseRow {
  id: string;
  status: string;
  expires_at: string | null;
  package_id: string;
}

interface ItemRow {
  id: string;
  quantity: number;
  name: string;
  item_type: string;
}

interface UsageCountRow {
  total_used: string | number;
}

interface AllItemsUsedRow {
  all_used: boolean | string;
}

interface CreditRow {
  purchase_id: string;
  initial_credits: number;
  remaining_credits: number;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapUsage(row: UsageRow): PackageUsage {
  return {
    id: row.id,
    purchaseId: row.purchase_id,
    itemId: row.item_id,
    bookingId: row.booking_id,
    usedAt: row.used_at,
    quantityUsed: row.quantity_used,
    notes: row.notes,
    usedByUserId: row.used_by_user_id,
    itemName: row.item_name,
    itemType: row.item_type,
  };
}

function mapCredit(row: CreditRow): CreditBalance {
  return {
    purchaseId: row.purchase_id,
    initialCredits: row.initial_credits,
    remainingCredits: row.remaining_credits,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export async function redeemItem(
  purchaseId: string,
  itemId: string,
  bookingId: string | null,
  quantity: number,
  userId: string,
  db: PackageDB,
): Promise<PackageUsage> {
  // Query 1: fetch purchase
  const { rows: purchaseRows } = await db.query<PurchaseRow>(
    `SELECT id, status, expires_at, package_id
     FROM reservations.package_purchases
     WHERE id = $1`,
    [purchaseId],
  );

  const purchase = purchaseRows[0];
  if (!purchase) {
    throw new PackageError('PURCHASE_NOT_FOUND');
  }
  if (purchase.status === 'cancelled') {
    throw new PackageError('PURCHASE_CANCELLED');
  }
  if (purchase.status === 'fully_used') {
    throw new PackageError('PURCHASE_FULLY_USED');
  }
  if (purchase.status !== 'active') {
    throw new PackageError('PURCHASE_EXPIRED');
  }
  if (purchase.expires_at && new Date(purchase.expires_at) < new Date()) {
    throw new PackageError('PURCHASE_EXPIRED');
  }

  // Query 2: fetch item
  const { rows: itemRows } = await db.query<ItemRow>(
    `SELECT id, quantity, name, item_type
     FROM reservations.package_items
     WHERE id = $1`,
    [itemId],
  );

  const item = itemRows[0];
  if (!item) {
    throw new PackageError('ITEM_NOT_FOUND');
  }

  // Query 3: count existing usage for this item in this purchase
  const { rows: countRows } = await db.query<UsageCountRow>(
    `SELECT COALESCE(SUM(quantity_used), 0) AS total_used
     FROM reservations.package_usage
     WHERE purchase_id = $1 AND item_id = $2`,
    [purchaseId, itemId],
  );

  const totalUsed = Number(countRows[0]?.total_used ?? 0);
  if (totalUsed + quantity > item.quantity) {
    throw new PackageError('ITEM_QUOTA_EXCEEDED');
  }

  // execute: insert usage
  await db.execute(
    `INSERT INTO reservations.package_usage
       (purchase_id, item_id, booking_id, quantity_used, used_by_user_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [purchaseId, itemId, bookingId, quantity, userId],
  );

  // Query 4: check if all items are fully used
  const { rows: allUsedRows } = await db.query<AllItemsUsedRow>(
    `SELECT NOT EXISTS (
       SELECT 1 FROM reservations.package_items pi
       WHERE pi.package_id = $1
       AND pi.quantity > (
         SELECT COALESCE(SUM(pu.quantity_used), 0)
         FROM reservations.package_usage pu
         WHERE pu.purchase_id = $2 AND pu.item_id = pi.id
       )
     ) AS all_used`,
    [purchase.package_id, purchaseId],
  );

  const allUsed = allUsedRows[0]?.all_used === true || allUsedRows[0]?.all_used === 'true';
  if (allUsed) {
    // execute: mark purchase as fully_used
    await db.execute(
      `UPDATE reservations.package_purchases SET status = 'fully_used' WHERE id = $1`,
      [purchaseId],
    );
  }

  return {
    id: 'usage-' + Date.now(),
    purchaseId,
    itemId,
    bookingId,
    usedAt: new Date().toISOString(),
    quantityUsed: quantity,
    notes: null,
    usedByUserId: userId,
    itemName: item.name,
    itemType: item.item_type,
  };
}

export async function redeemCredit(
  purchaseId: string,
  amount: number,
  bookingId: string | null,
  userId: string,
  db: PackageDB,
): Promise<CreditBalance> {
  // Query 1: fetch credit balance
  const { rows: balRows } = await db.query<CreditRow>(
    `SELECT * FROM reservations.package_credit_balances WHERE purchase_id = $1`,
    [purchaseId],
  );

  const bal = balRows[0];
  if (!bal) {
    throw new PackageError('PURCHASE_NOT_FOUND');
  }

  if (bal.remaining_credits < amount) {
    throw new PackageError('INSUFFICIENT_CREDITS');
  }

  // execute: update balance
  await db.execute(
    `UPDATE reservations.package_credit_balances
     SET remaining_credits = remaining_credits - $1, updated_at = NOW()
     WHERE purchase_id = $2`,
    [amount, purchaseId],
  );

  // execute: insert usage record
  await db.execute(
    `INSERT INTO reservations.package_usage
       (purchase_id, item_id, booking_id, quantity_used, used_by_user_id)
     VALUES ($1, NULL, $2, $3, $4)`,
    [purchaseId, bookingId, amount, userId],
  );

  return {
    purchaseId: bal.purchase_id,
    initialCredits: bal.initial_credits,
    remainingCredits: bal.remaining_credits - amount,
    updatedAt: new Date().toISOString(),
  };
}

export async function getUsageForPurchase(
  purchaseId: string,
  db: PackageDB,
): Promise<PackageUsage[]> {
  const { rows } = await db.query<UsageRow>(
    `SELECT pu.*, pi.name AS item_name, pi.item_type
     FROM reservations.package_usage pu
     LEFT JOIN reservations.package_items pi ON pi.id = pu.item_id
     WHERE pu.purchase_id = $1
     ORDER BY pu.used_at ASC`,
    [purchaseId],
  );

  return rows.map(mapUsage);
}

export async function getRemainingQuota(
  purchaseId: string,
  itemId: string,
  db: PackageDB,
): Promise<QuotaInfo> {
  // Query 1: item total quantity + used count
  const { rows } = await db.query<{ total: number | string; used: string | number }>(
    `SELECT pi.quantity AS total,
            COALESCE(SUM(pu.quantity_used), 0) AS used
     FROM reservations.package_items pi
     LEFT JOIN reservations.package_usage pu
       ON pu.item_id = pi.id AND pu.purchase_id = $1
     WHERE pi.id = $2
     GROUP BY pi.quantity`,
    [purchaseId, itemId],
  );

  if (!rows[0]) {
    throw new PackageError('ITEM_NOT_FOUND');
  }

  const total = Number(rows[0].total);
  const used = Number(rows[0].used);

  return { used, total, remaining: total - used };
}

export async function getCreditBalance(
  purchaseId: string,
  db: PackageDB,
): Promise<CreditBalance | null> {
  const { rows } = await db.query<CreditRow>(
    `SELECT * FROM reservations.package_credit_balances WHERE purchase_id = $1`,
    [purchaseId],
  );

  if (!rows[0]) {
    return null;
  }

  return mapCredit(rows[0]);
}
