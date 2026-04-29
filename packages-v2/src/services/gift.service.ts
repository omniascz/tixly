import { PackageError } from '../lib/package-errors';
import type { PackageDB } from './package.service';
import type { Purchase } from './purchase.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GiftPreview {
  purchaseId: string;
  packageId: string;
  packageName: string;
  packageDescription: string | null;
  priceHellers: number;
  giftMessage: string | null;
  buyerUserId: string;
  expiresAt: string | null;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface GiftRow {
  id: string;
  package_id: string;
  user_id: string;
  promoter_id: string;
  order_id: string | null;
  status: string;
  purchased_at: string;
  activated_at: string | null;
  expires_at: string | null;
  gift_recipient_user_id: string | null;
  gift_message: string | null;
  transfer_token: string | null;
  notes: string | null;
  package_name: string;
  package_description: string | null;
  price_hellers: number;
  validity_days: number | null;
  package_promoter_id: string;
  is_active: boolean;
  sale_start: string | null;
  sale_end: string | null;
  activations_sold: number;
  max_activations: number;
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export async function createGiftPackage(
  packageId: string,
  buyerUserId: string,
  orderId: string | null,
  giftMessage: string | null,
  db: PackageDB,
): Promise<Purchase> {
  // Query 1: fetch package for validation
  const { rows: pkgRows } = await db.query<{
    id: string;
    promoter_id: string;
    is_active: boolean;
    sale_start: string | null;
    sale_end: string | null;
    activations_sold: number;
    max_activations: number;
    validity_days: number | null;
  }>(
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

  // execute: INSERT purchase with transfer_token and gift_message
  await db.execute(
    `INSERT INTO reservations.package_purchases
       (package_id, user_id, promoter_id, order_id, status, gift_message, transfer_token, activated_at, expires_at)
     VALUES ($1,$2,$3,$4,'active',$5,gen_random_uuid(),NOW(),
       CASE WHEN $6::int IS NOT NULL THEN NOW() + ($6::int * INTERVAL '1 day') ELSE NULL END
     )`,
    [packageId, buyerUserId, pkg.promoter_id, orderId, giftMessage, pkg.validity_days],
  );

  // execute: increment activations_sold
  await db.execute(
    `UPDATE reservations.packages SET activations_sold = activations_sold + 1 WHERE id = $1`,
    [packageId],
  );

  // Query 2: return the created purchase
  const { rows } = await db.query<{
    id: string;
    package_id: string;
    user_id: string;
    promoter_id: string;
    order_id: string | null;
    status: string;
    purchased_at: string;
    activated_at: string | null;
    expires_at: string | null;
    gift_recipient_user_id: string | null;
    gift_message: string | null;
    transfer_token: string | null;
    notes: string | null;
    package_name: string;
  }>(
    `SELECT pp.*, p.name AS package_name
     FROM reservations.package_purchases pp
     JOIN reservations.packages p ON p.id = pp.package_id
     WHERE pp.package_id = $1 AND pp.user_id = $2
     ORDER BY pp.purchased_at DESC
     LIMIT 1`,
    [packageId, buyerUserId],
  );

  if (!rows[0]) {
    throw new PackageError('PURCHASE_NOT_FOUND');
  }

  const r = rows[0];
  return {
    id: r.id,
    packageId: r.package_id,
    userId: r.user_id,
    promoterId: r.promoter_id,
    orderId: r.order_id,
    status: r.status as Purchase['status'],
    purchasedAt: r.purchased_at,
    activatedAt: r.activated_at,
    expiresAt: r.expires_at,
    giftRecipientUserId: r.gift_recipient_user_id,
    giftMessage: r.gift_message,
    transferToken: r.transfer_token,
    notes: r.notes,
    packageName: r.package_name,
  };
}

export async function getGiftByToken(
  transferToken: string,
  db: PackageDB,
): Promise<GiftPreview> {
  const { rows } = await db.query<GiftRow>(
    `SELECT pp.*,
            p.name AS package_name,
            p.description AS package_description,
            p.price_hellers,
            p.validity_days,
            p.promoter_id AS package_promoter_id,
            p.is_active,
            p.sale_start,
            p.sale_end,
            p.activations_sold,
            p.max_activations
     FROM reservations.package_purchases pp
     JOIN reservations.packages p ON p.id = pp.package_id
     WHERE pp.transfer_token = $1`,
    [transferToken],
  );

  if (!rows[0]) {
    throw new PackageError('TRANSFER_TOKEN_INVALID');
  }

  const r = rows[0];
  return {
    purchaseId: r.id,
    packageId: r.package_id,
    packageName: r.package_name,
    packageDescription: r.package_description,
    priceHellers: r.price_hellers,
    giftMessage: r.gift_message,
    buyerUserId: r.user_id,
    expiresAt: r.expires_at,
  };
}

export async function claimGift(
  transferToken: string,
  recipientUserId: string,
  db: PackageDB,
): Promise<Purchase> {
  // Query 1: find purchase by transfer_token
  const { rows: tokenRows } = await db.query<{
    id: string;
    package_id: string;
    user_id: string;
    promoter_id: string;
    gift_recipient_user_id: string | null;
    validity_days: number | null;
  }>(
    `SELECT pp.id, pp.package_id, pp.user_id, pp.promoter_id, pp.gift_recipient_user_id,
            p.validity_days
     FROM reservations.package_purchases pp
     JOIN reservations.packages p ON p.id = pp.package_id
     WHERE pp.transfer_token = $1`,
    [transferToken],
  );

  if (!tokenRows[0]) {
    throw new PackageError('TRANSFER_TOKEN_INVALID');
  }

  const purchase = tokenRows[0];

  // execute: update gift_recipient_user_id + activated_at + expires_at
  await db.execute(
    `UPDATE reservations.package_purchases
     SET gift_recipient_user_id = $1,
         activated_at = NOW(),
         expires_at = CASE WHEN $2::int IS NOT NULL THEN NOW() + ($2::int * INTERVAL '1 day') ELSE NULL END
     WHERE id = $3`,
    [recipientUserId, purchase.validity_days, purchase.id],
  );

  // Query 2: return updated purchase
  const { rows } = await db.query<{
    id: string;
    package_id: string;
    user_id: string;
    promoter_id: string;
    order_id: string | null;
    status: string;
    purchased_at: string;
    activated_at: string | null;
    expires_at: string | null;
    gift_recipient_user_id: string | null;
    gift_message: string | null;
    transfer_token: string | null;
    notes: string | null;
    package_name: string;
  }>(
    `SELECT pp.*, p.name AS package_name
     FROM reservations.package_purchases pp
     JOIN reservations.packages p ON p.id = pp.package_id
     WHERE pp.id = $1`,
    [purchase.id],
  );

  if (!rows[0]) {
    throw new PackageError('PURCHASE_NOT_FOUND');
  }

  const r = rows[0];
  return {
    id: r.id,
    packageId: r.package_id,
    userId: r.user_id,
    promoterId: r.promoter_id,
    orderId: r.order_id,
    status: r.status as Purchase['status'],
    purchasedAt: r.purchased_at,
    activatedAt: r.activated_at,
    expiresAt: r.expires_at,
    giftRecipientUserId: r.gift_recipient_user_id,
    giftMessage: r.gift_message,
    transferToken: r.transfer_token,
    notes: r.notes,
    packageName: r.package_name,
  };
}
