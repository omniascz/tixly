import { BranchError } from '../lib/branch-errors';
import type { BranchDB } from './branch.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ServiceAvailability {
  branchId: string;
  serviceId: string;
  isAvailable: boolean;
  priceOverrideHellers: number | null;
  notes: string | null;
  // Effective price from join
  effectivePriceHellers?: number;
  serviceName?: string;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface ServiceAvailabilityRow {
  branch_id: string;
  service_id: string;
  is_available: boolean;
  price_override_hellers: number | null;
  notes: string | null;
  effective_price_hellers?: number;
  service_name?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapServiceAvailability(row: ServiceAvailabilityRow): ServiceAvailability {
  return {
    branchId: row.branch_id,
    serviceId: row.service_id,
    isAvailable: row.is_available,
    priceOverrideHellers: row.price_override_hellers,
    notes: row.notes,
    effectivePriceHellers: row.effective_price_hellers,
    serviceName: row.service_name,
  };
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export async function enableService(
  branchId: string,
  serviceId: string,
  priceOverride: number | null,
  db: BranchDB,
): Promise<ServiceAvailability> {
  const { rows } = await db.query<ServiceAvailabilityRow>(
    `INSERT INTO reservations.branch_service_availability
       (branch_id, service_id, is_available, price_override_hellers)
     VALUES ($1, $2, true, $3)
     ON CONFLICT (branch_id, service_id) DO UPDATE
       SET is_available = true,
           price_override_hellers = EXCLUDED.price_override_hellers
     RETURNING *`,
    [branchId, serviceId, priceOverride ?? null],
  );

  if (!rows[0]) {
    throw new BranchError('SERVICE_NOT_AVAILABLE_AT_BRANCH');
  }

  return mapServiceAvailability(rows[0]);
}

export async function disableService(
  branchId: string,
  serviceId: string,
  db: BranchDB,
): Promise<void> {
  await db.execute(
    `UPDATE reservations.branch_service_availability
     SET is_available = false
     WHERE branch_id = $1 AND service_id = $2`,
    [branchId, serviceId],
  );
}

export async function getAvailableServices(
  branchId: string,
  db: BranchDB,
): Promise<ServiceAvailability[]> {
  const { rows } = await db.query<ServiceAvailabilityRow>(
    `SELECT bsa.*,
            s.name AS service_name,
            COALESCE(bsa.price_override_hellers, s.price_hellers) AS effective_price_hellers
     FROM reservations.branch_service_availability bsa
     JOIN reservations.services s ON s.id = bsa.service_id
     WHERE bsa.branch_id = $1 AND bsa.is_available = true
     ORDER BY s.name ASC`,
    [branchId],
  );

  return rows.map(mapServiceAvailability);
}

export async function setServicePrice(
  branchId: string,
  serviceId: string,
  priceHellers: number,
  db: BranchDB,
): Promise<void> {
  await db.execute(
    `UPDATE reservations.branch_service_availability
     SET price_override_hellers = $1
     WHERE branch_id = $2 AND service_id = $3`,
    [priceHellers, branchId, serviceId],
  );
}

export async function isServiceAvailable(
  branchId: string,
  serviceId: string,
  db: BranchDB,
): Promise<boolean> {
  const { rows } = await db.query<{ is_available: boolean }>(
    `SELECT is_available FROM reservations.branch_service_availability
     WHERE branch_id = $1 AND service_id = $2`,
    [branchId, serviceId],
  );

  return rows[0]?.is_available === true;
}
