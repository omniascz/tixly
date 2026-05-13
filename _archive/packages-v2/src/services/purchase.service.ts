import { PackageError } from '../lib/package-errors';
import type { PackageDB } from './package.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PurchaseStatus = 'active' | 'expired' | 'fully_used' | 'cancelled' | 'transferred';

export interface Purchase {
  id: string;
  packageId: string;
  userId: string;
  promoterId: string;
  orderId: string | null;
  status: PurchaseStatus;
  purchasedAt: string;
  activatedAt: string | null;
  expiresAt: string | null;
  giftRecipientUserId: string | null;
  giftMessage: string | null;
  transferToken: string | null;
  notes: string | null;
  packageName?: string;
  usageSummary?: { totalUsed: number; totalItems: number };
}

export interface PurchaseFilters {
  status?: PurchaseStatus;
  promoterId?: string;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface PurchaseRow {
  id: string;
  package_id: string;
  user_id: string;
  promoter_id: string;
  order_id: string | null;
  status: PurchaseStatus;
  purchased_at: string;
  activated_at: string | null;
  expires_at: string | null;
  gift_recipient_user_id: string | null;
  gift_message: string | null;
  transfer_token: string | null;
  notes: string | null;
  package_name?: string;
  total_used?: string | number;
  total_items?: string | number;
}

interface PackageRow {
  id: string;
  promoter_id: string;
  is_active: boolean;
  sale_start: string | null;
  sale_end: string | null;
  activations_sold: number;
  max_activations: number;
  validity_days: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapPurchase(row: PurchaseRow): Purchase {
  return {
    id: row.id,
    packageId: row.package_id,
    userId: row.user_id,
    promoterId: row.promoter_id,
    orderId: row.order_id,
    status: row.status,
    purchasedAt: row.purchased_at,
    activatedAt: row.activated_at,
    expiresAt: row.expires_at,
    giftRecipientUserId: row.gift_recipient_user_id,
    giftMessage: row.gift_message,
    transferToken: row.transfer_token,
    notes: row.notes,
    packageName: row.package_name,
    usageSummary: row.total_used !== undefined
      ? { totalUsed: Number(row.total_used), totalItems: Number(row.total_items ?? 0) }
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export async function purchasePackage(
  packageId: string,
  userId: string,
  orderId: string | null,
  db: PackageDB,
): Promise<Purchase> {
  // Query 1: fetch package
  const { rows: pkgRows } = await db.query<PackageRow>(
    `SELECT id, promoter_id, is_active, sale_start, sale_end,
            activations_sold, max_activations, validity_days
     FROM reservations.packages
     WHERE id = $1`,
    [packageId],
  );

  const pkg = pkgRows[0];
  if (!pkg) {
    throw new PackageError('PACKAGE_NOT_FOUND');
  }

  if (!pkg.is_active) {
    throw new PackageError('PACKAGE_SALE_CLOSED');
  }

  const now = new Date();
  if (pkg.sale_start && new Date(pkg.sale_start) > now) {
    throw new PackageError('PACKAGE_SALE_CLOSED');
  }
  if (pkg.sale_end && new Date(pkg.sale_end) < now) {
    throw new PackageError('PACKAGE_SALE_CLOSED');
  }

  if (pkg.activations_sold >= pkg.max_activations) {
    throw new PackageError('PACKAGE_SOLD_OUT');
  }

  // execute: INSERT purchase
  await db.execute(
    `INSERT INTO reservations.package_purchases
       (package_id, user_id, promoter_id, order_id, status, activated_at, expires_at)
     VALUES ($1,$2,$3,$4,'active',
       NOW(),
       CASE WHEN $5::int IS NOT NULL THEN NOW() + ($5::int * INTERVAL '1 day') ELSE NULL END
     )`,
    [packageId, userId, pkg.promoter_id, orderId, pkg.validity_days],
  );

  // execute: increment activations_sold
  await db.execute(
    `UPDATE reservations.packages SET activations_sold = activations_sold + 1 WHERE id = $1`,
    [packageId],
  );

  // Query 2: return the created purchase
  const { rows } = await db.query<PurchaseRow>(
    `SELECT pp.*, p.name AS package_name
     FROM reservations.package_purchases pp
     JOIN reservations.packages p ON p.id = pp.package_id
     WHERE pp.package_id = $1 AND pp.user_id = $2
     ORDER BY pp.purchased_at DESC
     LIMIT 1`,
    [packageId, userId],
  );

  if (!rows[0]) {
    throw new PackageError('PURCHASE_NOT_FOUND');
  }

  return mapPurchase(rows[0]);
}

export async function getPurchase(
  purchaseId: string,
  db: PackageDB,
): Promise<Purchase> {
  const { rows } = await db.query<PurchaseRow>(
    `SELECT pp.*,
            p.name AS package_name,
            COUNT(pu.id) AS total_used,
            COUNT(pi.id) AS total_items
     FROM reservations.package_purchases pp
     JOIN reservations.packages p ON p.id = pp.package_id
     LEFT JOIN reservations.package_usage pu ON pu.purchase_id = pp.id
     LEFT JOIN reservations.package_items pi ON pi.package_id = pp.package_id
     WHERE pp.id = $1
     GROUP BY pp.id, p.name`,
    [purchaseId],
  );

  if (!rows[0]) {
    throw new PackageError('PURCHASE_NOT_FOUND');
  }

  return mapPurchase(rows[0]);
}

export async function listPurchasesForUser(
  userId: string,
  filters: PurchaseFilters,
  db: PackageDB,
): Promise<Purchase[]> {
  const conditions: string[] = ['pp.user_id = $1'];
  const params: unknown[] = [userId];
  let idx = 2;

  if (filters.status !== undefined) {
    conditions.push(`pp.status = $${idx}`);
    params.push(filters.status);
    idx++;
  }
  if (filters.promoterId !== undefined) {
    conditions.push(`pp.promoter_id = $${idx}`);
    params.push(filters.promoterId);
    idx++;
  }

  const { rows } = await db.query<PurchaseRow>(
    `SELECT pp.*, p.name AS package_name
     FROM reservations.package_purchases pp
     JOIN reservations.packages p ON p.id = pp.package_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY pp.purchased_at DESC`,
    params,
  );

  return rows.map(mapPurchase);
}

export async function activateGift(
  transferToken: string,
  recipientUserId: string,
  db: PackageDB,
): Promise<Purchase> {
  // Query 1: find by transfer_token
  const { rows: tokenRows } = await db.query<PurchaseRow>(
    `SELECT * FROM reservations.package_purchases
     WHERE transfer_token = $1`,
    [transferToken],
  );

  if (!tokenRows[0]) {
    throw new PackageError('TRANSFER_TOKEN_INVALID');
  }

  const purchase = tokenRows[0];

  // execute: update recipient + activated_at
  await db.execute(
    `UPDATE reservations.package_purchases
     SET gift_recipient_user_id = $1,
         status = 'active',
         activated_at = NOW()
     WHERE id = $2`,
    [recipientUserId, purchase.id],
  );

  // Query 2: return updated
  const { rows } = await db.query<PurchaseRow>(
    `SELECT pp.*, p.name AS package_name
     FROM reservations.package_purchases pp
     JOIN reservations.packages p ON p.id = pp.package_id
     WHERE pp.id = $1`,
    [purchase.id],
  );

  return mapPurchase(rows[0] ?? { ...purchase, gift_recipient_user_id: recipientUserId, activated_at: new Date().toISOString() });
}

export async function cancelPurchase(
  purchaseId: string,
  _reason: string,
  db: PackageDB,
): Promise<Purchase> {
  // execute: cancel
  await db.execute(
    `UPDATE reservations.package_purchases
     SET status = 'cancelled'
     WHERE id = $1`,
    [purchaseId],
  );

  // Query 1: return updated
  const { rows } = await db.query<PurchaseRow>(
    `SELECT pp.*, p.name AS package_name
     FROM reservations.package_purchases pp
     JOIN reservations.packages p ON p.id = pp.package_id
     WHERE pp.id = $1`,
    [purchaseId],
  );

  if (!rows[0]) {
    throw new PackageError('PURCHASE_NOT_FOUND');
  }

  return mapPurchase(rows[0]);
}
