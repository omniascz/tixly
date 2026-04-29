// =============================================================================
// Permanentky Service — kreditní ledger (purchase / consume / refund)
// =============================================================================

import type { ServiceDeps } from '../lib/service-container.js';
import { PermanentkyError } from '../lib/permanentky-errors.js';
import type {
  ClientPackage,
  ConsumeCreditInput,
  PackageBalance,
  PackageStatus,
  PackageUsage,
  PurchasePackageInput,
} from '../types/permanentky.js';

// -----------------------------------------------------------------------------
// Row mappers
// -----------------------------------------------------------------------------

interface TemplateRow {
  id: string;
  promoter_id: string;
  total_credits: number;
  validity_days: number;
  price_halire: number;
  is_active: boolean;
}

interface PackageRow {
  id: string;
  client_id: string;
  template_id: string;
  promoter_id: string;
  total_credits: number;
  remaining_credits: number;
  status: string;
  price_paid_halire: number;
  payment_ref: string | null;
  purchased_at: Date;
  valid_from: Date;
  valid_until: Date;
  created_at: Date;
}

interface UsageRow {
  id: string;
  package_id: string;
  client_id: string;
  reservation_id: string | null;
  consumed_at: Date;
  is_refund: boolean;
}

function mapPackage(row: PackageRow): ClientPackage {
  return {
    id: row.id,
    clientId: row.client_id,
    templateId: row.template_id,
    promoterId: row.promoter_id,
    totalCredits: row.total_credits,
    remainingCredits: row.remaining_credits,
    status: row.status as PackageStatus,
    pricePaidHalire: row.price_paid_halire,
    paymentRef: row.payment_ref,
    purchasedAt: row.purchased_at,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    createdAt: row.created_at,
  };
}

function mapUsage(row: UsageRow): PackageUsage {
  return {
    id: row.id,
    packageId: row.package_id,
    clientId: row.client_id,
    reservationId: row.reservation_id,
    consumedAt: row.consumed_at,
    isRefund: row.is_refund,
  };
}

// -----------------------------------------------------------------------------
// purchasePackage
// -----------------------------------------------------------------------------

export async function purchasePackage(
  input: PurchasePackageInput,
  deps: ServiceDeps,
): Promise<ClientPackage> {
  return deps.db.transaction(async (tx) => {
    const tpl = await tx.query<TemplateRow>(
      `SELECT id, promoter_id, total_credits, validity_days, price_halire, is_active
         FROM permanentky.templates
        WHERE id = $1`,
      [input.templateId],
    );
    if (tpl.rows.length === 0) throw new PermanentkyError('TEMPLATE_NOT_FOUND');
    const template = tpl.rows[0];
    if (!template.is_active) throw new PermanentkyError('TEMPLATE_INACTIVE');

    const validFrom = input.validFrom ?? new Date();
    const validUntil = new Date(
      validFrom.getTime() + template.validity_days * 24 * 60 * 60 * 1000,
    );
    const status: PackageStatus = input.paymentRef ? 'active' : 'pending_payment';

    const { rows } = await tx.query<PackageRow>(
      `INSERT INTO permanentky.client_packages
         (client_id, template_id, promoter_id, total_credits, remaining_credits,
          status, price_paid_halire, payment_ref, valid_from, valid_until)
       VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        input.clientId,
        template.id,
        template.promoter_id,
        template.total_credits,
        status,
        template.price_halire,
        input.paymentRef ?? null,
        validFrom,
        validUntil,
      ],
    );

    const pkg = mapPackage(rows[0]);

    await deps.kafka.emit('permanentka.purchased', {
      packageId: pkg.id,
      clientId: pkg.clientId,
      promoterId: pkg.promoterId,
      templateId: pkg.templateId,
      pricePaidHalire: pkg.pricePaidHalire,
      status: pkg.status,
    });

    return pkg;
  });
}

// -----------------------------------------------------------------------------
// activatePackage
// -----------------------------------------------------------------------------

export async function activatePackage(
  packageId: string,
  paymentRef: string,
  deps: ServiceDeps,
): Promise<ClientPackage> {
  const existing = await deps.db.query<PackageRow>(
    `SELECT * FROM permanentky.client_packages WHERE id = $1`,
    [packageId],
  );
  if (existing.rows.length === 0) throw new PermanentkyError('PACKAGE_NOT_FOUND');
  if (existing.rows[0].status !== 'pending_payment') {
    throw new PermanentkyError('PACKAGE_NOT_ACTIVE', `status=${existing.rows[0].status}`);
  }

  const { rows } = await deps.db.query<PackageRow>(
    `UPDATE permanentky.client_packages
        SET status = 'active', payment_ref = $2
      WHERE id = $1
      RETURNING *`,
    [packageId, paymentRef],
  );
  const pkg = mapPackage(rows[0]);

  await deps.kafka.emit('permanentka.activated', {
    packageId: pkg.id,
    clientId: pkg.clientId,
    promoterId: pkg.promoterId,
    paymentRef,
  });

  return pkg;
}

// -----------------------------------------------------------------------------
// consumeCredit
// -----------------------------------------------------------------------------

export async function consumeCredit(
  input: ConsumeCreditInput,
  deps: ServiceDeps,
): Promise<{ usage: PackageUsage; remainingCredits: number }> {
  return deps.db.transaction(async (tx) => {
    const lockRes = await tx.query<PackageRow>(
      `SELECT * FROM permanentky.client_packages WHERE id = $1 FOR UPDATE`,
      [input.packageId],
    );
    if (lockRes.rows.length === 0) throw new PermanentkyError('PACKAGE_NOT_FOUND');
    const pkg = lockRes.rows[0];

    if (pkg.client_id !== input.clientId) {
      throw new PermanentkyError('PACKAGE_NOT_OWNED');
    }
    if (pkg.status !== 'active') {
      throw new PermanentkyError('PACKAGE_NOT_ACTIVE', `status=${pkg.status}`);
    }
    if (pkg.valid_until.getTime() <= Date.now()) {
      throw new PermanentkyError('PACKAGE_EXPIRED');
    }
    if (pkg.remaining_credits <= 0) {
      throw new PermanentkyError('PACKAGE_DEPLETED');
    }

    if (input.reservationId) {
      const dup = await tx.query(
        `SELECT 1 FROM permanentky.usages
          WHERE reservation_id = $1 AND is_refund = FALSE
          LIMIT 1`,
        [input.reservationId],
      );
      if (dup.rows.length > 0) {
        throw new PermanentkyError('DUPLICATE_USAGE');
      }
    }

    const usageRes = await tx.query<UsageRow>(
      `INSERT INTO permanentky.usages
         (package_id, client_id, reservation_id, is_refund)
       VALUES ($1, $2, $3, FALSE)
       RETURNING *`,
      [pkg.id, pkg.client_id, input.reservationId ?? null],
    );
    const usage = mapUsage(usageRes.rows[0]);

    const newRemaining = pkg.remaining_credits - 1;
    const newStatus: PackageStatus = newRemaining === 0 ? 'depleted' : 'active';

    await tx.query(
      `UPDATE permanentky.client_packages
          SET remaining_credits = $2, status = $3
        WHERE id = $1`,
      [pkg.id, newRemaining, newStatus],
    );

    await deps.kafka.emit('permanentka.credit_consumed', {
      packageId: pkg.id,
      clientId: pkg.client_id,
      usageId: usage.id,
      reservationId: usage.reservationId,
      remainingCredits: newRemaining,
    });

    return { usage, remainingCredits: newRemaining };
  });
}

// -----------------------------------------------------------------------------
// refundCredit (admin)
// -----------------------------------------------------------------------------

export async function refundCredit(
  usageId: string,
  reason: string,
  adminUserId: string,
  deps: ServiceDeps,
): Promise<{ usage: PackageUsage; remainingCredits: number }> {
  return deps.db.transaction(async (tx) => {
    const origRes = await tx.query<UsageRow>(
      `SELECT * FROM permanentky.usages WHERE id = $1`,
      [usageId],
    );
    if (origRes.rows.length === 0) {
      throw new PermanentkyError('PACKAGE_NOT_FOUND', 'usage not found');
    }
    const orig = origRes.rows[0];
    if (orig.is_refund) {
      throw new PermanentkyError('DUPLICATE_USAGE', 'cannot refund a refund row');
    }

    const pkgRes = await tx.query<PackageRow>(
      `SELECT * FROM permanentky.client_packages WHERE id = $1 FOR UPDATE`,
      [orig.package_id],
    );
    if (pkgRes.rows.length === 0) throw new PermanentkyError('PACKAGE_NOT_FOUND');
    const pkg = pkgRes.rows[0];

    const refundRes = await tx.query<UsageRow>(
      `INSERT INTO permanentky.usages
         (package_id, client_id, reservation_id, is_refund, refund_reason, refund_actor_id)
       VALUES ($1, $2, $3, TRUE, $4, $5)
       RETURNING *`,
      [pkg.id, pkg.client_id, orig.reservation_id, reason, adminUserId],
    );
    const refundUsage = mapUsage(refundRes.rows[0]);

    const newRemaining = pkg.remaining_credits + 1;
    const newStatus: PackageStatus = pkg.status === 'depleted' ? 'active' : (pkg.status as PackageStatus);

    await tx.query(
      `UPDATE permanentky.client_packages
          SET remaining_credits = $2, status = $3
        WHERE id = $1`,
      [pkg.id, newRemaining, newStatus],
    );

    await deps.kafka.emit('permanentka.credit_refunded', {
      packageId: pkg.id,
      clientId: pkg.client_id,
      usageId: refundUsage.id,
      originalUsageId: orig.id,
      reason,
      adminUserId,
      remainingCredits: newRemaining,
    });

    return { usage: refundUsage, remainingCredits: newRemaining };
  });
}

// -----------------------------------------------------------------------------
// getClientBalance
// -----------------------------------------------------------------------------

export async function getClientBalance(
  clientId: string,
  deps: ServiceDeps,
): Promise<PackageBalance> {
  const { rows } = await deps.db.query<PackageRow>(
    `SELECT * FROM permanentky.client_packages
      WHERE client_id = $1 AND status = 'active' AND valid_until > NOW()
      ORDER BY valid_until ASC`,
    [clientId],
  );
  const activePackages = rows.map(mapPackage);
  const totalRemainingCredits = activePackages.reduce(
    (sum, p) => sum + p.remainingCredits,
    0,
  );
  const nextExpiresAt =
    activePackages.length > 0
      ? activePackages.reduce(
          (min, p) => (p.validUntil < min ? p.validUntil : min),
          activePackages[0].validUntil,
        )
      : null;

  return {
    clientId,
    activePackages,
    totalRemainingCredits,
    nextExpiresAt,
  };
}

// -----------------------------------------------------------------------------
// getPackageHistory
// -----------------------------------------------------------------------------

export async function getPackageHistory(
  packageId: string,
  clientId: string,
  deps: ServiceDeps,
): Promise<{ package: ClientPackage; usages: PackageUsage[] }> {
  const pkgRes = await deps.db.query<PackageRow>(
    `SELECT * FROM permanentky.client_packages WHERE id = $1`,
    [packageId],
  );
  if (pkgRes.rows.length === 0) throw new PermanentkyError('PACKAGE_NOT_FOUND');
  const pkg = mapPackage(pkgRes.rows[0]);
  if (pkg.clientId !== clientId) throw new PermanentkyError('PACKAGE_NOT_OWNED');

  const usageRes = await deps.db.query<UsageRow>(
    `SELECT * FROM permanentky.usages
      WHERE package_id = $1
      ORDER BY consumed_at ASC`,
    [packageId],
  );

  return { package: pkg, usages: usageRes.rows.map(mapUsage) };
}

// -----------------------------------------------------------------------------
// expireOldPackages (cron)
// -----------------------------------------------------------------------------

export async function expireOldPackages(
  deps: ServiceDeps,
): Promise<{ expired: number }> {
  const { rows } = await deps.db.query<{ id: string }>(
    `UPDATE permanentky.client_packages
        SET status = 'expired'
      WHERE status IN ('active', 'depleted')
        AND valid_until < NOW()
      RETURNING id`,
    [],
  );
  return { expired: rows.length };
}
