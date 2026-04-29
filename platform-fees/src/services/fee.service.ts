import type {
  FeeSchedule,
  OrderFeeResult,
  RevenueSummaryRow,
  PromoterTier,
  PromoterTierAssignment,
  FeeAuditEntry,
} from '../types/fees.js';
import { TIER_DEFAULT_FEE_SCHEDULES } from '../types/fees.js';
import type { ServiceDeps } from '../lib/service-container.js';
import type { CreateFeeScheduleInput, UpdateFeeScheduleInput } from '../lib/zod-schemas.js';
import type { OrderLineItem } from '../lib/fee-calculator.js';
import { calculateFeeForOrder } from '../lib/fee-calculator.js';
import { FeeError } from '../lib/fee-errors.js';

// ---------------------------------------------------------------------------
// DB row shapes (snakeCase from PostgreSQL)
// ---------------------------------------------------------------------------
interface FeeScheduleRow {
  id: string;
  promoter_id: string;
  name: string;
  percentage_fee: number;
  fixed_fee: number;
  min_fee: number | null;
  max_fee: number | null;
  valid_from: string;
  valid_until: string | null;
  is_active: boolean;
  created_at: string;
}

interface RevenueSummaryDbRow {
  day: string;
  promoter_id: string;
  order_count: string; // bigint comes as string from pg
  gross_revenue: string;
  platform_fees: string;
  promoter_payouts: string;
  currency: string;
}

interface PromoterTierRow {
  promoter_id: string;
  tier: PromoterTier;
  assigned_at: string;
  assigned_by: string | null;
  valid_until: string | null;
}

interface FeeAuditRow {
  id: string;
  promoter_id: string;
  schedule_id: string | null;
  action: 'created' | 'updated' | 'deactivated' | 'tier_assigned';
  admin_user_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------
function rowToFeeSchedule(row: FeeScheduleRow): FeeSchedule {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    name: row.name,
    percentageFee: row.percentage_fee,
    fixedFee: row.fixed_fee,
    minFee: row.min_fee,
    maxFee: row.max_fee,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

function rowToRevenueSummary(row: RevenueSummaryDbRow): RevenueSummaryRow {
  return {
    day: row.day,
    promoterId: row.promoter_id,
    orderCount: parseInt(row.order_count, 10),
    grossRevenue: parseInt(row.gross_revenue, 10),
    platformFees: parseInt(row.platform_fees, 10),
    promoterPayouts: parseInt(row.promoter_payouts, 10),
    currency: row.currency,
  };
}

function rowToPromoterTierAssignment(row: PromoterTierRow): PromoterTierAssignment {
  return {
    promoterId: row.promoter_id,
    tier: row.tier,
    assignedAt: row.assigned_at,
    assignedBy: row.assigned_by,
    validUntil: row.valid_until,
  };
}

function rowToFeeAuditEntry(row: FeeAuditRow): FeeAuditEntry {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    scheduleId: row.schedule_id,
    action: row.action,
    adminUserId: row.admin_user_id,
    details: row.details,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Zapíše záznam do audit logu platform.fee_schedule_audit.
 * Tabulka: id UUID DEFAULT gen_random_uuid(), promoter_id, schedule_id,
 *          action, admin_user_id, details JSONB, created_at TIMESTAMPTZ DEFAULT NOW()
 */
async function logFeeAudit(
  action: 'created' | 'updated' | 'deactivated' | 'tier_assigned',
  scheduleId: string | null,
  promoterId: string,
  adminUserId: string | null,
  details: Record<string, unknown>,
  db: ServiceDeps['db'],
): Promise<void> {
  await db.execute(
    `INSERT INTO platform.fee_schedule_audit
       (promoter_id, schedule_id, action, admin_user_id, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [promoterId, scheduleId, action, adminUserId, JSON.stringify(details)],
  );
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Načte aktivní fee schedule pro promotéra.
 * Pokud neexistuje → vyhodí NO_ACTIVE_SCHEDULE.
 */
export async function getActiveFeeSchedule(
  promoterId: string,
  deps: ServiceDeps,
): Promise<FeeSchedule> {
  const rows = await deps.db.query<FeeScheduleRow>(
    `SELECT id, promoter_id, name, percentage_fee, fixed_fee, min_fee, max_fee,
            valid_from, valid_until, is_active, created_at
     FROM platform.fee_schedules
     WHERE promoter_id = $1
       AND is_active = TRUE
       AND valid_from <= NOW()
       AND (valid_until IS NULL OR valid_until > NOW())
     ORDER BY valid_from DESC
     LIMIT 1`,
    [promoterId],
  );

  if (rows.length === 0) {
    throw new FeeError(
      'NO_ACTIVE_SCHEDULE',
      `Promotér ${promoterId} nemá žádný aktivní fee schedule.`,
    );
  }

  return rowToFeeSchedule(rows[0]);
}

/**
 * Načte aktivní fee schedule a spustí kalkulátor poplatků pro objednávku.
 */
export async function calculateOrderFee(
  promoterId: string,
  lineItems: OrderLineItem[],
  deps: ServiceDeps,
): Promise<OrderFeeResult> {
  const schedule = await getActiveFeeSchedule(promoterId, deps);
  return calculateFeeForOrder(lineItems, schedule);
}

/**
 * Uloží výsledek poplatku na objednávku a její položky.
 * Volá se při checkout.
 */
export async function applyFeeToOrder(
  orderId: string,
  feeResult: OrderFeeResult,
  deps: ServiceDeps,
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    // Aktualizuj hlavičku objednávky
    await tx.execute(
      `UPDATE orders.orders
       SET platform_fee_amount = $1,
           fee_schedule_id = $2
       WHERE id = $3`,
      [feeResult.totalPlatformFee, feeResult.feeScheduleId, orderId],
    );

    // Aktualizuj jednotlivé položky objednávky (per-ticket breakdown)
    // Předpokládáme, že order_items jsou seřazeny stejně jako lineItems
    // a aplikujeme fee po jednom kusu
    for (let i = 0; i < feeResult.lineItems.length; i++) {
      const item = feeResult.lineItems[i];
      await tx.execute(
        `UPDATE orders.order_items
         SET platform_fee_amount = $1
         WHERE order_id = $2
           AND id = (
             SELECT id FROM orders.order_items
             WHERE order_id = $2
             ORDER BY created_at, id
             LIMIT 1 OFFSET $3
           )`,
        [item.platformFee, orderId, i],
      );
    }
  });
}

/**
 * Vytvoří nový fee schedule pro promotéra.
 */
export async function createFeeSchedule(
  promoterId: string,
  input: CreateFeeScheduleInput,
  adminUserId: string,
  deps: ServiceDeps,
): Promise<FeeSchedule> {
  const validFrom = input.validFrom ?? new Date().toISOString();

  const rows = await deps.db.query<FeeScheduleRow>(
    `INSERT INTO platform.fee_schedules
       (promoter_id, name, percentage_fee, fixed_fee, min_fee, max_fee, valid_from, valid_until)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, promoter_id, name, percentage_fee, fixed_fee, min_fee, max_fee,
               valid_from, valid_until, is_active, created_at`,
    [
      promoterId,
      input.name,
      input.percentageFee,
      input.fixedFee,
      input.minFee ?? null,
      input.maxFee ?? null,
      validFrom,
      input.validUntil ?? null,
    ],
  );

  const schedule = rowToFeeSchedule(rows[0]);

  await logFeeAudit(
    'created',
    schedule.id,
    promoterId,
    adminUserId,
    { name: input.name, percentageFee: input.percentageFee, fixedFee: input.fixedFee },
    deps.db,
  );

  return schedule;
}

/**
 * Aktualizuje existující fee schedule.
 */
export async function updateFeeSchedule(
  scheduleId: string,
  input: UpdateFeeScheduleInput,
  adminUserId: string,
  deps: ServiceDeps,
): Promise<FeeSchedule> {
  // Dynamicky sestavíme SET klauzuli jen z poskytnutých polí
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  const fieldMap: Record<string, string> = {
    name: 'name',
    percentageFee: 'percentage_fee',
    fixedFee: 'fixed_fee',
    minFee: 'min_fee',
    maxFee: 'max_fee',
    validFrom: 'valid_from',
    validUntil: 'valid_until',
    isActive: 'is_active',
  };

  for (const [key, dbCol] of Object.entries(fieldMap)) {
    if (key in input && (input as Record<string, unknown>)[key] !== undefined) {
      setClauses.push(`${dbCol} = $${paramIndex}`);
      params.push((input as Record<string, unknown>)[key]);
      paramIndex++;
    }
  }

  if (setClauses.length === 0) {
    // Nic ke změně — načteme a vrátíme stávající záznam
    const existing = await deps.db.query<FeeScheduleRow>(
      `SELECT id, promoter_id, name, percentage_fee, fixed_fee, min_fee, max_fee,
              valid_from, valid_until, is_active, created_at
       FROM platform.fee_schedules WHERE id = $1`,
      [scheduleId],
    );
    if (existing.length === 0) {
      throw new FeeError('FEE_SCHEDULE_NOT_FOUND', `Fee schedule ${scheduleId} nenalezen.`);
    }
    return rowToFeeSchedule(existing[0]);
  }

  params.push(scheduleId);
  const rows = await deps.db.query<FeeScheduleRow>(
    `UPDATE platform.fee_schedules
     SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING id, promoter_id, name, percentage_fee, fixed_fee, min_fee, max_fee,
               valid_from, valid_until, is_active, created_at`,
    params,
  );

  if (rows.length === 0) {
    throw new FeeError('FEE_SCHEDULE_NOT_FOUND', `Fee schedule ${scheduleId} nenalezen.`);
  }

  const schedule = rowToFeeSchedule(rows[0]);

  await logFeeAudit(
    'updated',
    scheduleId,
    schedule.promoterId,
    adminUserId,
    input as Record<string, unknown>,
    deps.db,
  );

  return schedule;
}

/**
 * Soft-deaktivuje fee schedule (is_active = FALSE).
 */
export async function deactivateFeeSchedule(
  scheduleId: string,
  adminUserId: string,
  deps: ServiceDeps,
): Promise<void> {
  // Fetch promoter_id before deactivating so we can log it
  const rows = await deps.db.query<Pick<FeeScheduleRow, 'promoter_id'>>(
    `UPDATE platform.fee_schedules
     SET is_active = FALSE
     WHERE id = $1
     RETURNING promoter_id`,
    [scheduleId],
  );

  if (rows.length > 0) {
    await logFeeAudit(
      'deactivated',
      scheduleId,
      rows[0].promoter_id,
      adminUserId,
      {},
      deps.db,
    );
  }
}

/**
 * Vrátí všechny fee schedules pro daného promotéra (včetně neaktivních).
 */
export async function listFeeSchedules(
  promoterId: string,
  deps: ServiceDeps,
): Promise<FeeSchedule[]> {
  const rows = await deps.db.query<FeeScheduleRow>(
    `SELECT id, promoter_id, name, percentage_fee, fixed_fee, min_fee, max_fee,
            valid_from, valid_until, is_active, created_at
     FROM platform.fee_schedules
     WHERE promoter_id = $1
     ORDER BY created_at DESC`,
    [promoterId],
  );

  return rows.map(rowToFeeSchedule);
}

/**
 * Finanční přehled pro platformu z pohledu platform.revenue_summary.
 */
export async function getPlatformRevenueSummary(
  filters: { from: string; to: string; promoterId?: string },
  deps: ServiceDeps,
): Promise<RevenueSummaryRow[]> {
  const params: unknown[] = [filters.from, filters.to];
  let promoterFilter = '';

  if (filters.promoterId) {
    params.push(filters.promoterId);
    promoterFilter = `AND promoter_id = $${params.length}`;
  }

  const rows = await deps.db.query<RevenueSummaryDbRow>(
    `SELECT
       day::text,
       promoter_id,
       order_count::text,
       gross_revenue::text,
       platform_fees::text,
       promoter_payouts::text,
       currency
     FROM platform.revenue_summary
     WHERE day >= $1::timestamptz
       AND day < $2::timestamptz
       ${promoterFilter}
     ORDER BY day DESC, promoter_id`,
    params,
  );

  return rows.map(rowToRevenueSummary);
}

// ---------------------------------------------------------------------------
// Promoter tier system
// ---------------------------------------------------------------------------

/**
 * Vrátí aktuální tier pro daného promotéra.
 * Pokud není přiřazen žádný tier, vrátí null.
 */
export async function getPromoterTier(
  promoterId: string,
  deps: ServiceDeps,
): Promise<PromoterTierAssignment | null> {
  const rows = await deps.db.query<PromoterTierRow>(
    `SELECT promoter_id, tier, assigned_at, assigned_by, valid_until
     FROM platform.promoter_tiers
     WHERE promoter_id = $1`,
    [promoterId],
  );

  if (rows.length === 0) {
    return null;
  }

  return rowToPromoterTierAssignment(rows[0]);
}

/**
 * Přiřadí tier promotérovi.
 * 1. UPSERT platform.promoter_tiers
 * 2. Deaktivuje stávající aktivní fee schedules
 * 3. Vytvoří nový fee schedule z tier výchozích hodnot
 * 4. Zapíše audit log
 */
export async function assignPromoterTier(
  promoterId: string,
  tier: PromoterTier,
  adminUserId: string | null,
  deps: ServiceDeps,
): Promise<{ tierAssignment: PromoterTierAssignment; feeSchedule: FeeSchedule }> {
  // 1. UPSERT tier assignment
  const tierRows = await deps.db.query<PromoterTierRow>(
    `INSERT INTO platform.promoter_tiers (promoter_id, tier, assigned_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (promoter_id) DO UPDATE
       SET tier = EXCLUDED.tier,
           assigned_by = EXCLUDED.assigned_by,
           assigned_at = NOW()
     RETURNING promoter_id, tier, assigned_at, assigned_by, valid_until`,
    [promoterId, tier, adminUserId],
  );

  const tierAssignment = rowToPromoterTierAssignment(tierRows[0]);

  // 2. Deactivate existing active fee schedules for this promoter
  await deps.db.execute(
    `UPDATE platform.fee_schedules
     SET is_active = FALSE
     WHERE promoter_id = $1
       AND is_active = TRUE`,
    [promoterId],
  );

  // 3. Create new fee schedule using tier defaults
  const defaults = TIER_DEFAULT_FEE_SCHEDULES[tier];
  const scheduleRows = await deps.db.query<FeeScheduleRow>(
    `INSERT INTO platform.fee_schedules
       (promoter_id, name, percentage_fee, fixed_fee, min_fee, max_fee, valid_from, valid_until)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NULL)
     RETURNING id, promoter_id, name, percentage_fee, fixed_fee, min_fee, max_fee,
               valid_from, valid_until, is_active, created_at`,
    [
      promoterId,
      defaults.name,
      defaults.percentageFee,
      defaults.fixedFee,
      defaults.minFee,
      defaults.maxFee,
    ],
  );

  const feeSchedule = rowToFeeSchedule(scheduleRows[0]);

  // 4. Audit log
  await logFeeAudit(
    'tier_assigned',
    feeSchedule.id,
    promoterId,
    adminUserId,
    { tier, tierDefaults: defaults },
    deps.db,
  );

  return { tierAssignment, feeSchedule };
}

// ---------------------------------------------------------------------------
// Fee schedule audit log
// ---------------------------------------------------------------------------

/**
 * Vrátí stránkovaný audit log fee schedule změn pro daného promotéra.
 */
export async function getFeeScheduleAuditLog(
  promoterId: string,
  pagination: { limit?: number; offset?: number },
  deps: ServiceDeps,
): Promise<{ items: FeeAuditEntry[]; total: number }> {
  const limit = pagination.limit ?? 20;
  const offset = pagination.offset ?? 0;

  const [countRows, itemRows] = await Promise.all([
    deps.db.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM platform.fee_schedule_audit
       WHERE promoter_id = $1`,
      [promoterId],
    ),
    deps.db.query<FeeAuditRow>(
      `SELECT id, promoter_id, schedule_id, action, admin_user_id, details, created_at
       FROM platform.fee_schedule_audit
       WHERE promoter_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [promoterId, limit, offset],
    ),
  ]);

  return {
    items: itemRows.map(rowToFeeAuditEntry),
    total: parseInt(countRows[0]?.total ?? '0', 10),
  };
}
