// =============================================================================
// Permanentky Checkout Service
// Handles integration between permanentky (season passes) and checkout flow.
// =============================================================================

import { randomUUID } from 'crypto';
import type {
  ActivatePackageResult,
  CheckoutItem,
  DbAdapter,
  OrderPackageLink,
  PermanentkaItem,
  PermanentkaPackage,
  PurchasePackageResult,
} from '../lib/types.js';

// -----------------------------------------------------------------------------
// DB row interfaces
// -----------------------------------------------------------------------------

interface PackageRow {
  id: string;
  promoter_id: string;
  name: string;
  package_type: string;
  price_halire: number;
  max_usages: number;
  status: string;
}

interface ReservationRow {
  id: string;
  package_id: string;
  order_id: string;
  quantity: number;
  status: string;
  expires_at: string;
  activated_at: string | null;
  created_at: string;
}

interface UsageCountRow {
  used_count: string;
}

interface PackageUsagesRow {
  max_usages: number;
  used_count: string;
}

// -----------------------------------------------------------------------------
// detectPermanentkaItems
// Filtruje checkout items kde item.packageId není undefined.
// -----------------------------------------------------------------------------

export function detectPermanentkaItems(items: CheckoutItem[]): PermanentkaItem[] {
  return items
    .filter((item): item is CheckoutItem & { packageId: string; packageType: string } =>
      item.packageId !== undefined && item.packageId.length > 0,
    )
    .map((item) => ({
      packageId: item.packageId,
      packageType: item.packageType ?? 'season_pass',
      quantity: item.quantity,
      unitPriceHalire: item.unitPriceHalire,
    }));
}

// -----------------------------------------------------------------------------
// validatePackageAvailability
// Validuje dostupnost balíčku — existuje, je active, patří danému promotérovi.
// -----------------------------------------------------------------------------

export async function validatePackageAvailability(
  packageId: string,
  promoterId: string,
  quantity: number,
  db: DbAdapter,
): Promise<PermanentkaPackage> {
  const rows = await db.query<PackageRow>(
    `SELECT id, promoter_id, name, package_type, price_halire, max_usages, status
       FROM permanentky.packages
      WHERE id = $1
        AND promoter_id = $2`,
    [packageId, promoterId],
  );

  if (rows.length === 0) {
    throw new Error(
      `Package not found or does not belong to promoter: packageId=${packageId} promoterId=${promoterId}`,
    );
  }

  const row = rows[0];

  if (row.status !== 'active') {
    throw new Error(
      `Package is not available for purchase: packageId=${packageId} status=${row.status}`,
    );
  }

  if (quantity < 1) {
    throw new Error(`Quantity must be at least 1, got ${quantity}`);
  }

  return {
    id: row.id,
    promoterId: row.promoter_id,
    name: row.name,
    packageType: row.package_type,
    priceHalire: row.price_halire,
    maxUsages: row.max_usages,
    status: row.status as PermanentkaPackage['status'],
  };
}

// -----------------------------------------------------------------------------
// reservePackage
// Rezervuje balíček v rámci checkoutu (volá se před platbou).
// Vrátí reservationId pro pozdější aktivaci.
// -----------------------------------------------------------------------------

export async function reservePackage(
  packageId: string,
  orderId: string,
  quantity: number,
  promoterId: string,
  db: DbAdapter,
): Promise<PurchasePackageResult> {
  // Verify package exists for this promoter before inserting reservation
  const rows = await db.query<PackageRow>(
    `SELECT id FROM permanentky.packages WHERE id = $1 AND promoter_id = $2`,
    [packageId, promoterId],
  );

  if (rows.length === 0) {
    throw new Error(
      `Package not found during reservation: packageId=${packageId} promoterId=${promoterId}`,
    );
  }

  const reservationId = randomUUID();

  await db.execute(
    `INSERT INTO permanentky_reservations
       (id, package_id, order_id, quantity, status, expires_at, created_at)
     VALUES ($1, $2, $3, $4, 'reserved', NOW() + INTERVAL '15 minutes', NOW())`,
    [reservationId, packageId, orderId, quantity],
  );

  return {
    packageId,
    orderId,
    reservationId,
    status: 'reserved',
  };
}

// -----------------------------------------------------------------------------
// linkOrderToPackage
// Vytvoří order-package link (FK propojení orders ↔ packages).
// -----------------------------------------------------------------------------

export async function linkOrderToPackage(
  orderId: string,
  packageId: string,
  quantity: number,
  db: DbAdapter,
): Promise<OrderPackageLink> {
  const now = new Date().toISOString();

  await db.execute(
    `INSERT INTO order_packages (order_id, package_id, quantity, created_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (order_id, package_id) DO UPDATE
       SET quantity = EXCLUDED.quantity`,
    [orderId, packageId, quantity],
  );

  return {
    orderId,
    packageId,
    quantity,
    createdAt: now,
  };
}

// -----------------------------------------------------------------------------
// activatePackageForOrder
// Aktivuje permanentku po úspěšné platbě (volá se z order-completed flow).
// -----------------------------------------------------------------------------

export async function activatePackageForOrder(
  orderId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<ActivatePackageResult[]> {
  // Find all reservations for this order that are still in 'reserved' state
  const reservations = await db.query<ReservationRow>(
    `SELECT r.id, r.package_id, r.order_id, r.quantity, r.status, r.expires_at, r.activated_at, r.created_at
       FROM permanentky_reservations r
       JOIN permanentky.packages p ON p.id = r.package_id
      WHERE r.order_id = $1
        AND p.promoter_id = $2
        AND r.status = 'reserved'`,
    [orderId, promoterId],
  );

  if (reservations.length === 0) {
    return [];
  }

  const results: ActivatePackageResult[] = [];
  const activatedAt = new Date().toISOString();

  for (const reservation of reservations) {
    // Activate the reservation
    await db.execute(
      `UPDATE permanentky_reservations
          SET status = 'active', activated_at = NOW()
        WHERE id = $1 AND status = 'reserved'`,
      [reservation.id],
    );

    // Update order_packages link with activation timestamp
    await db.execute(
      `UPDATE order_packages
          SET activated_at = NOW()
        WHERE order_id = $1 AND package_id = $2`,
      [orderId, reservation.package_id],
    );

    results.push({
      packageId: reservation.package_id,
      orderId: reservation.order_id,
      activatedAt,
      usagesGranted: reservation.quantity,
    });
  }

  return results;
}

// -----------------------------------------------------------------------------
// cancelPackageReservation
// Zruší rezervaci (volá se pokud platba selže).
// -----------------------------------------------------------------------------

export async function cancelPackageReservation(
  reservationId: string,
  db: DbAdapter,
): Promise<void> {
  await db.execute(
    `UPDATE permanentky_reservations
        SET status = 'cancelled'
      WHERE id = $1`,
    [reservationId],
  );
}

// -----------------------------------------------------------------------------
// getRemainingUsages
// Zkontroluje kolik vstupů zbývá na permanentce (pro scanner).
// -----------------------------------------------------------------------------

export async function getRemainingUsages(
  packageId: string,
  userId: string,
  db: DbAdapter,
): Promise<{ remaining: number; total: number }> {
  // Get max usages from package
  const packageRows = await db.query<{ max_usages: number }>(
    `SELECT p.max_usages
       FROM permanentky.packages p
      WHERE p.id = $1`,
    [packageId],
  );

  if (packageRows.length === 0) {
    throw new Error(`Package not found: packageId=${packageId}`);
  }

  const total = packageRows[0].max_usages;

  // Count used entries for this user+package combination
  const usageRows = await db.query<UsageCountRow>(
    `SELECT COUNT(*) AS used_count
       FROM permanentky.usages u
      WHERE u.package_id = $1
        AND u.client_id = $2
        AND u.is_refund = false`,
    [packageId, userId],
  );

  const usedCount = parseInt(usageRows[0]?.used_count ?? '0', 10);
  const remaining = Math.max(0, total - usedCount);

  return { remaining, total };
}
