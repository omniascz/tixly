// =============================================================================
// Retailer Partner Portal Service
// Feature #189: Network of physical retail points (kiosks, bookstores, newsstands)
//
// Flow:
//   1. Onboard retailer (name, city, commission %)
//   2. Allocate inventory per ticket type (how many they can sell)
//   3. Record each sale (decrements allocation, logs commission)
//   4. End-of-day settlement: aggregate commissions and net amounts
// =============================================================================

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

export interface Retailer {
  id: string;
  name: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  address: string | null;
  city: string;
  country: string;
  ico: string | null;
  commissionPct: number;
  apiKey: string;
  status: 'active' | 'suspended' | 'terminated';
  createdAt: string;
  updatedAt: string;
}

export interface InventoryAllocation {
  id: string;
  retailerId: string;
  eventId: string;
  ticketTypeId: string;
  allocatedQty: number;
  soldQty: number;
  returnedQty: number;
  availableQty: number;
  validFrom: string;
  validUntil: string | null;
}

export interface RetailerSale {
  id: string;
  retailerId: string;
  allocationId: string;
  ticketId: string;
  orderId: string | null;
  salePriceHellers: number;
  commissionHellers: number;
  soldAt: string;
  settlementId: string | null;
}

export interface Settlement {
  id: string;
  retailerId: string;
  settlementDate: string;
  totalSales: number;
  grossAmountHellers: number;
  commissionHellers: number;
  netAmountHellers: number;
  status: 'pending' | 'invoiced' | 'paid';
  createdAt: string;
}

interface RetailerRow {
  id: string;
  name: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  address: string | null;
  city: string;
  country: string;
  ico: string | null;
  commission_pct: string;
  api_key: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface AllocationRow {
  id: string;
  retailer_id: string;
  event_id: string;
  ticket_type_id: string;
  allocated_qty: number;
  sold_qty: number;
  returned_qty: number;
  valid_from: string;
  valid_until: string | null;
}

interface SaleRow {
  id: string;
  retailer_id: string;
  allocation_id: string;
  ticket_id: string;
  order_id: string | null;
  sale_price_hellers: number;
  commission_hellers: number;
  sold_at: string;
  settlement_id: string | null;
}

interface SettlementRow {
  id: string;
  retailer_id: string;
  settlement_date: string;
  total_sales: number;
  gross_amount_hellers: string;
  commission_hellers: string;
  net_amount_hellers: string;
  status: string;
  created_at: string;
}

function mapRetailer(r: RetailerRow): Retailer {
  return {
    id: r.id,
    name: r.name,
    contactName: r.contact_name,
    contactEmail: r.contact_email,
    contactPhone: r.contact_phone,
    address: r.address,
    city: r.city,
    country: r.country,
    ico: r.ico,
    commissionPct: parseFloat(r.commission_pct),
    apiKey: r.api_key,
    status: r.status as Retailer['status'],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapAllocation(r: AllocationRow): InventoryAllocation {
  return {
    id: r.id,
    retailerId: r.retailer_id,
    eventId: r.event_id,
    ticketTypeId: r.ticket_type_id,
    allocatedQty: r.allocated_qty,
    soldQty: r.sold_qty,
    returnedQty: r.returned_qty,
    availableQty: r.allocated_qty - r.sold_qty + r.returned_qty,
    validFrom: r.valid_from,
    validUntil: r.valid_until,
  };
}

function mapSale(r: SaleRow): RetailerSale {
  return {
    id: r.id,
    retailerId: r.retailer_id,
    allocationId: r.allocation_id,
    ticketId: r.ticket_id,
    orderId: r.order_id,
    salePriceHellers: r.sale_price_hellers,
    commissionHellers: r.commission_hellers,
    soldAt: r.sold_at,
    settlementId: r.settlement_id,
  };
}

function mapSettlement(r: SettlementRow): Settlement {
  return {
    id: r.id,
    retailerId: r.retailer_id,
    settlementDate: r.settlement_date,
    totalSales: r.total_sales,
    grossAmountHellers: Number(r.gross_amount_hellers),
    commissionHellers: Number(r.commission_hellers),
    netAmountHellers: Number(r.net_amount_hellers),
    status: r.status as Settlement['status'],
    createdAt: r.created_at,
  };
}

/**
 * Onboard a new retail partner.
 */
export async function onboardRetailer(
  input: {
    name: string;
    contactName: string;
    contactEmail: string;
    contactPhone?: string;
    address?: string;
    city: string;
    country?: string;
    ico?: string;
    commissionPct?: number;
  },
  db: DbAdapter,
): Promise<Retailer> {
  if (!input.name.trim()) throw new Error('VALIDATION_ERROR: name is required');
  if (!input.contactEmail.includes('@')) throw new Error('VALIDATION_ERROR: invalid email');
  if (!input.city.trim()) throw new Error('VALIDATION_ERROR: city is required');

  const commissionPct = input.commissionPct ?? 5.0;
  if (commissionPct < 0 || commissionPct > 30) {
    throw new Error('VALIDATION_ERROR: commissionPct must be between 0 and 30');
  }

  const rows = await db.query<RetailerRow>(
    `INSERT INTO retailer.retailers
       (name, contact_name, contact_email, contact_phone, address, city, country, ico, commission_pct)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      input.name,
      input.contactName,
      input.contactEmail,
      input.contactPhone ?? null,
      input.address ?? null,
      input.city,
      input.country ?? 'CZ',
      input.ico ?? null,
      commissionPct,
    ],
  );

  return mapRetailer(rows[0]);
}

/**
 * Allocate inventory to a retailer for a specific ticket type.
 * Upserts: if allocation already exists, updates the quantity.
 */
export async function allocateInventory(
  retailerId: string,
  eventId: string,
  ticketTypeId: string,
  allocatedQty: number,
  validUntil: string | null,
  db: DbAdapter,
): Promise<InventoryAllocation> {
  if (allocatedQty < 0) throw new Error('VALIDATION_ERROR: allocatedQty must be >= 0');

  // Verify retailer is active
  const retailers = await db.query<RetailerRow>(
    `SELECT * FROM retailer.retailers WHERE id = $1 AND status = 'active'`,
    [retailerId],
  );
  if (!retailers[0]) throw new Error('RETAILER_NOT_FOUND or not active');

  const rows = await db.query<AllocationRow>(
    `INSERT INTO retailer.inventory_allocations
       (retailer_id, event_id, ticket_type_id, allocated_qty, valid_until)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (retailer_id, ticket_type_id) DO UPDATE SET
       allocated_qty = EXCLUDED.allocated_qty,
       valid_until = EXCLUDED.valid_until
     RETURNING *`,
    [retailerId, eventId, ticketTypeId, allocatedQty, validUntil],
  );

  return mapAllocation(rows[0]);
}

/**
 * Record a sale made by a retailer.
 * Atomically decrements available allocation; rejects if over limit.
 */
export async function processRetailerSale(
  retailerId: string,
  ticketTypeId: string,
  ticketId: string,
  orderId: string | null,
  salePriceHellers: number,
  db: DbAdapter,
): Promise<RetailerSale> {
  if (salePriceHellers <= 0) throw new Error('VALIDATION_ERROR: salePriceHellers must be positive');

  // Get retailer commission rate
  const retailers = await db.query<RetailerRow>(
    `SELECT * FROM retailer.retailers WHERE id = $1 AND status = 'active'`,
    [retailerId],
  );
  if (!retailers[0]) throw new Error('RETAILER_NOT_FOUND or not active');

  const commissionPct = parseFloat(retailers[0].commission_pct);

  // Atomically increment sold_qty — only if allocation has remaining capacity
  const allocationRows = await db.query<AllocationRow>(
    `UPDATE retailer.inventory_allocations
     SET sold_qty = sold_qty + 1
     WHERE retailer_id = $1
       AND ticket_type_id = $2
       AND (valid_until IS NULL OR valid_until > NOW())
       AND sold_qty - returned_qty < allocated_qty
     RETURNING *`,
    [retailerId, ticketTypeId],
  );

  if (!allocationRows[0]) {
    throw new Error('ALLOCATION_EXHAUSTED or not found');
  }

  const allocation = allocationRows[0];
  const commissionHellers = Math.round((salePriceHellers * commissionPct) / 100);

  const saleRows = await db.query<SaleRow>(
    `INSERT INTO retailer.retailer_sales
       (retailer_id, allocation_id, ticket_id, order_id, sale_price_hellers, commission_hellers)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [retailerId, allocation.id, ticketId, orderId, salePriceHellers, commissionHellers],
  );

  return mapSale(saleRows[0]);
}

/**
 * Run end-of-day settlement for a retailer.
 * Aggregates all unsettled sales for the given date, creates a settlement record,
 * and marks those sales as settled.
 */
export async function settlementDay(
  retailerId: string,
  settlementDate: string,
  db: DbAdapter,
): Promise<Settlement> {
  // Aggregate unsettled sales
  const aggRows = await db.query<{
    total_sales: string;
    gross_amount_hellers: string;
    commission_hellers: string;
  }>(
    `SELECT
       COUNT(*) AS total_sales,
       COALESCE(SUM(sale_price_hellers), 0) AS gross_amount_hellers,
       COALESCE(SUM(commission_hellers), 0) AS commission_hellers
     FROM retailer.retailer_sales
     WHERE retailer_id = $1
       AND settlement_id IS NULL
       AND DATE(sold_at) = $2::date`,
    [retailerId, settlementDate],
  );

  const agg = aggRows[0];
  const totalSales = Number(agg.total_sales);
  const grossAmountHellers = Number(agg.gross_amount_hellers);
  const commissionHellers = Number(agg.commission_hellers);
  const netAmountHellers = grossAmountHellers - commissionHellers;

  // Upsert settlement record
  const settlementRows = await db.query<SettlementRow>(
    `INSERT INTO retailer.settlements
       (retailer_id, settlement_date, total_sales, gross_amount_hellers, commission_hellers, net_amount_hellers)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (retailer_id, settlement_date) DO UPDATE SET
       total_sales = EXCLUDED.total_sales,
       gross_amount_hellers = EXCLUDED.gross_amount_hellers,
       commission_hellers = EXCLUDED.commission_hellers,
       net_amount_hellers = EXCLUDED.net_amount_hellers
     RETURNING *`,
    [retailerId, settlementDate, totalSales, grossAmountHellers, commissionHellers, netAmountHellers],
  );

  const settlement = settlementRows[0];

  // Link sales to this settlement
  await db.execute(
    `UPDATE retailer.retailer_sales
     SET settlement_id = $1
     WHERE retailer_id = $2
       AND settlement_id IS NULL
       AND DATE(sold_at) = $3::date`,
    [settlement.id, retailerId, settlementDate],
  );

  return mapSettlement(settlement);
}

/**
 * List all retailers. Optionally filter by status.
 */
export async function listRetailers(
  status: Retailer['status'] | null,
  db: DbAdapter,
): Promise<Retailer[]> {
  const rows = await db.query<RetailerRow>(
    `SELECT * FROM retailer.retailers
     WHERE ($1::text IS NULL OR status = $1)
     ORDER BY name ASC`,
    [status],
  );
  return rows.map(mapRetailer);
}

/**
 * Get allocations for a retailer at an event.
 */
export async function getRetailerAllocations(
  retailerId: string,
  eventId: string,
  db: DbAdapter,
): Promise<InventoryAllocation[]> {
  const rows = await db.query<AllocationRow>(
    `SELECT * FROM retailer.inventory_allocations
     WHERE retailer_id = $1 AND event_id = $2`,
    [retailerId, eventId],
  );
  return rows.map(mapAllocation);
}
