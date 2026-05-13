import { randomUUID } from 'crypto';
import type {
  Vendor,
  Addon,
  OrderAddon,
  VendorInput,
  AddonInput,
  PurchaseAddonInput,
  VendorPayoutSummary,
  DbAdapter,
  ServiceDeps,
} from '../types/vendor-marketplace.types.js';
import { VendorMarketplaceError } from '../types/vendor-marketplace.types.js';

// ─── internal row shapes returned from DB ────────────────────────────────────

interface VendorRow {
  id: string;
  name: string;
  email: string;
  category: string;
  status: string;
  commission_rate_bps: number;
  api_key: string | null;
  created_at: Date | string;
}

interface AddonRow {
  id: string;
  vendor_id: string;
  event_id: string;
  name: string;
  description: string;
  category: string;
  price_czk: number;
  max_quantity: number | null;
  sold_quantity: number;
  status: string;
  image_url: string | null;
  available_from: Date | string | null;
  available_until: Date | string | null;
}

interface OrderAddonRow {
  id: string;
  order_id: string;
  addon_id: string;
  vendor_id: string;
  quantity: number;
  unit_price_czk: number;
  total_price_czk: number;
  commission_czk: number;
  vendor_payout_czk: number;
  status: string;
  purchased_at: Date | string;
}

interface PayoutAggRow {
  vendor_id: string;
  event_id: string;
  total_revenue_czk: number | string;
  total_commission_czk: number | string;
  vendor_payout_czk: number | string;
  order_count: number | string;
}

// ─── mappers ─────────────────────────────────────────────────────────────────

function toVendor(r: VendorRow): Vendor {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    category: r.category as Vendor['category'],
    status: r.status as Vendor['status'],
    commissionRateBps: r.commission_rate_bps,
    apiKey: r.api_key,
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
  };
}

function toAddon(r: AddonRow): Addon {
  return {
    id: r.id,
    vendorId: r.vendor_id,
    eventId: r.event_id,
    name: r.name,
    description: r.description,
    category: r.category as Addon['category'],
    priceCzk: r.price_czk,
    maxQuantity: r.max_quantity,
    soldQuantity: r.sold_quantity,
    status: r.status as Addon['status'],
    imageUrl: r.image_url,
    availableFrom: r.available_from
      ? r.available_from instanceof Date ? r.available_from : new Date(r.available_from)
      : null,
    availableUntil: r.available_until
      ? r.available_until instanceof Date ? r.available_until : new Date(r.available_until)
      : null,
  };
}

function toOrderAddon(r: OrderAddonRow): OrderAddon {
  return {
    id: r.id,
    orderId: r.order_id,
    addonId: r.addon_id,
    vendorId: r.vendor_id,
    quantity: r.quantity,
    unitPriceCzk: r.unit_price_czk,
    totalPriceCzk: r.total_price_czk,
    commissionCzk: r.commission_czk,
    vendorPayoutCzk: r.vendor_payout_czk,
    status: r.status as OrderAddon['status'],
    purchasedAt: r.purchased_at instanceof Date ? r.purchased_at : new Date(r.purchased_at),
  };
}

// ─── service functions ────────────────────────────────────────────────────────

export async function registerVendor(input: VendorInput, deps: ServiceDeps): Promise<Vendor> {
  const { db } = deps;
  const id = randomUUID();
  const apiKey = randomUUID();
  const commissionRateBps = input.commissionRateBps ?? 1000;
  const now = (deps.now ?? (() => new Date()))();

  await db.execute(
    `INSERT INTO vendors (id, name, email, category, status, commission_rate_bps, api_key, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, input.name, input.email, input.category, 'pending_approval', commissionRateBps, apiKey, now],
  );

  const rows = await db.query<VendorRow>(
    `SELECT * FROM vendors WHERE id = $1`,
    [id],
  );

  const row = rows[0];
  if (!row) throw new VendorMarketplaceError('VENDOR_NOT_FOUND', `Vendor ${id} not found after insert`);
  return toVendor(row);
}

export async function approveVendor(vendorId: string, deps: ServiceDeps): Promise<Vendor> {
  const { db } = deps;

  const existing = await db.query<VendorRow>(`SELECT * FROM vendors WHERE id = $1`, [vendorId]);
  if (!existing[0]) throw new VendorMarketplaceError('VENDOR_NOT_FOUND', `Vendor ${vendorId} not found`);

  await db.execute(`UPDATE vendors SET status = $1 WHERE id = $2`, ['approved', vendorId]);

  const rows = await db.query<VendorRow>(`SELECT * FROM vendors WHERE id = $1`, [vendorId]);
  const row = rows[0];
  if (!row) throw new VendorMarketplaceError('VENDOR_NOT_FOUND', `Vendor ${vendorId} not found`);
  return toVendor(row);
}

export async function suspendVendor(vendorId: string, _reason: string, deps: ServiceDeps): Promise<Vendor> {
  const { db } = deps;

  const existing = await db.query<VendorRow>(`SELECT * FROM vendors WHERE id = $1`, [vendorId]);
  if (!existing[0]) throw new VendorMarketplaceError('VENDOR_NOT_FOUND', `Vendor ${vendorId} not found`);

  await db.execute(`UPDATE vendors SET status = $1 WHERE id = $2`, ['suspended', vendorId]);

  const rows = await db.query<VendorRow>(`SELECT * FROM vendors WHERE id = $1`, [vendorId]);
  const row = rows[0];
  if (!row) throw new VendorMarketplaceError('VENDOR_NOT_FOUND', `Vendor ${vendorId} not found`);
  return toVendor(row);
}

export async function createAddon(input: AddonInput, deps: ServiceDeps): Promise<Addon> {
  const { db } = deps;

  const vendorRows = await db.query<VendorRow>(`SELECT * FROM vendors WHERE id = $1`, [input.vendorId]);
  const vendor = vendorRows[0];
  if (!vendor) throw new VendorMarketplaceError('VENDOR_NOT_FOUND', `Vendor ${input.vendorId} not found`);
  if (vendor.status !== 'approved') throw new VendorMarketplaceError('VENDOR_NOT_APPROVED', `Vendor ${input.vendorId} is not approved`);

  const id = randomUUID();

  await db.execute(
    `INSERT INTO addons (id, vendor_id, event_id, name, description, category, price_czk, max_quantity, sold_quantity, status, image_url, available_from, available_until)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      id,
      input.vendorId,
      input.eventId,
      input.name,
      input.description,
      input.category,
      input.priceCzk,
      input.maxQuantity ?? null,
      0,
      'draft',
      null,
      input.availableFrom ?? null,
      input.availableUntil ?? null,
    ],
  );

  const rows = await db.query<AddonRow>(`SELECT * FROM addons WHERE id = $1`, [id]);
  const row = rows[0];
  if (!row) throw new VendorMarketplaceError('ADDON_NOT_FOUND', `Addon ${id} not found after insert`);
  return toAddon(row);
}

export async function publishAddon(addonId: string, vendorId: string, deps: ServiceDeps): Promise<Addon> {
  const { db } = deps;

  const rows = await db.query<AddonRow>(`SELECT * FROM addons WHERE id = $1 AND vendor_id = $2`, [addonId, vendorId]);
  const addon = rows[0];
  if (!addon) throw new VendorMarketplaceError('ADDON_NOT_FOUND', `Addon ${addonId} not found`);

  await db.execute(`UPDATE addons SET status = $1 WHERE id = $2`, ['active', addonId]);

  const updated = await db.query<AddonRow>(`SELECT * FROM addons WHERE id = $1`, [addonId]);
  const row = updated[0];
  if (!row) throw new VendorMarketplaceError('ADDON_NOT_FOUND', `Addon ${addonId} not found`);
  return toAddon(row);
}

export async function getAvailableAddons(eventId: string, deps: ServiceDeps): Promise<Addon[]> {
  const { db } = deps;
  const now = (deps.now ?? (() => new Date()))();

  const rows = await db.query<AddonRow>(
    `SELECT * FROM addons
     WHERE event_id = $1
       AND status = 'active'
       AND (available_from IS NULL OR available_from <= $2)
       AND (available_until IS NULL OR available_until >= $2)`,
    [eventId, now],
  );

  return rows.map(toAddon);
}

export async function purchaseAddon(input: PurchaseAddonInput, deps: ServiceDeps): Promise<OrderAddon> {
  const { db } = deps;
  const now = (deps.now ?? (() => new Date()))();

  return db.transaction(async (txDb) => {
    const addonRows = await txDb.query<AddonRow>(`SELECT * FROM addons WHERE id = $1`, [input.addonId]);
    const addon = addonRows[0];
    if (!addon) throw new VendorMarketplaceError('ADDON_NOT_FOUND', `Addon ${input.addonId} not found`);
    if (addon.status !== 'active') throw new VendorMarketplaceError('ADDON_NOT_ACTIVE', `Addon ${input.addonId} is not active`);

    // availability window check
    if (addon.available_from) {
      const from = addon.available_from instanceof Date ? addon.available_from : new Date(addon.available_from);
      if (now < from) throw new VendorMarketplaceError('ADDON_NOT_AVAILABLE', `Addon ${input.addonId} not yet available`);
    }
    if (addon.available_until) {
      const until = addon.available_until instanceof Date ? addon.available_until : new Date(addon.available_until);
      if (now > until) throw new VendorMarketplaceError('ADDON_NOT_AVAILABLE', `Addon ${input.addonId} is no longer available`);
    }

    // stock check
    if (addon.max_quantity !== null) {
      if (addon.sold_quantity + input.quantity > addon.max_quantity) {
        throw new VendorMarketplaceError('INSUFFICIENT_STOCK', `Not enough stock for addon ${input.addonId}`);
      }
    }

    // get vendor for commission rate
    const vendorRows = await txDb.query<VendorRow>(`SELECT * FROM vendors WHERE id = $1`, [addon.vendor_id]);
    const vendor = vendorRows[0];
    if (!vendor) throw new VendorMarketplaceError('VENDOR_NOT_FOUND', `Vendor ${addon.vendor_id} not found`);

    const unitPrice = addon.price_czk;
    const totalPrice = unitPrice * input.quantity;
    const commission = Math.round(totalPrice * vendor.commission_rate_bps / 10000);
    const vendorPayout = totalPrice - commission;

    const newSoldQuantity = addon.sold_quantity + input.quantity;
    const newStatus = addon.max_quantity !== null && newSoldQuantity >= addon.max_quantity ? 'sold_out' : 'active';

    // increment soldQuantity and possibly set sold_out
    await txDb.execute(
      `UPDATE addons SET sold_quantity = $1, status = $2 WHERE id = $3`,
      [newSoldQuantity, newStatus, input.addonId],
    );

    // insert order_addon
    const orderAddonId = randomUUID();
    await txDb.execute(
      `INSERT INTO order_addons (id, order_id, addon_id, vendor_id, quantity, unit_price_czk, total_price_czk, commission_czk, vendor_payout_czk, status, purchased_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [orderAddonId, input.orderId, input.addonId, addon.vendor_id, input.quantity, unitPrice, totalPrice, commission, vendorPayout, 'confirmed', now],
    );

    const orderAddonRows = await txDb.query<OrderAddonRow>(`SELECT * FROM order_addons WHERE id = $1`, [orderAddonId]);
    const row = orderAddonRows[0];
    if (!row) throw new VendorMarketplaceError('ORDER_ADDON_NOT_FOUND', `OrderAddon ${orderAddonId} not found after insert`);
    return toOrderAddon(row);
  });
}

export async function cancelOrderAddon(orderAddonId: string, deps: ServiceDeps): Promise<OrderAddon> {
  const { db } = deps;

  const orderAddonRows = await db.query<OrderAddonRow>(`SELECT * FROM order_addons WHERE id = $1`, [orderAddonId]);
  const orderAddon = orderAddonRows[0];
  if (!orderAddon) throw new VendorMarketplaceError('ORDER_ADDON_NOT_FOUND', `OrderAddon ${orderAddonId} not found`);

  await db.execute(`UPDATE order_addons SET status = $1 WHERE id = $2`, ['cancelled', orderAddonId]);

  // decrement soldQuantity on addon, and reactivate if was sold_out
  const addonRows = await db.query<AddonRow>(`SELECT * FROM addons WHERE id = $1`, [orderAddon.addon_id]);
  const addon = addonRows[0];
  if (addon) {
    const newSoldQuantity = Math.max(0, addon.sold_quantity - orderAddon.quantity);
    const newStatus: string = addon.status === 'sold_out' ? 'active' : addon.status;
    await db.execute(
      `UPDATE addons SET sold_quantity = $1, status = $2 WHERE id = $3`,
      [newSoldQuantity, newStatus, addon.id],
    );
  }

  const updated = await db.query<OrderAddonRow>(`SELECT * FROM order_addons WHERE id = $1`, [orderAddonId]);
  const row = updated[0];
  if (!row) throw new VendorMarketplaceError('ORDER_ADDON_NOT_FOUND', `OrderAddon ${orderAddonId} not found`);
  return toOrderAddon(row);
}

export async function getVendorPayoutSummary(vendorId: string, eventId: string, deps: ServiceDeps): Promise<VendorPayoutSummary> {
  const { db } = deps;

  const rows = await db.query<PayoutAggRow>(
    `SELECT
       oa.vendor_id,
       a.event_id,
       SUM(oa.total_price_czk) AS total_revenue_czk,
       SUM(oa.commission_czk) AS total_commission_czk,
       SUM(oa.vendor_payout_czk) AS vendor_payout_czk,
       COUNT(*) AS order_count
     FROM order_addons oa
     JOIN addons a ON a.id = oa.addon_id
     WHERE oa.vendor_id = $1
       AND a.event_id = $2
       AND oa.status NOT IN ('cancelled', 'refunded')
     GROUP BY oa.vendor_id, a.event_id`,
    [vendorId, eventId],
  );

  const row = rows[0];
  if (!row) {
    return {
      vendorId,
      eventId,
      totalRevenueCzk: 0,
      totalCommissionCzk: 0,
      vendorPayoutCzk: 0,
      orderCount: 0,
    };
  }

  return {
    vendorId: row.vendor_id,
    eventId: row.event_id,
    totalRevenueCzk: Number(row.total_revenue_czk),
    totalCommissionCzk: Number(row.total_commission_czk),
    vendorPayoutCzk: Number(row.vendor_payout_czk),
    orderCount: Number(row.order_count),
  };
}
