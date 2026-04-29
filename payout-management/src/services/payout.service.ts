import type { ServiceDeps } from '../lib/service-container.js';
import { PayoutError } from '../lib/payout-errors.js';
import {
  payoutApprovedEmail,
  payoutPaidEmail,
  payoutFailedEmail,
} from '../lib/payout-emails.js';
import type {
  Payout,
  PayoutSettings,
  PayoutStatus,
  EventSettlement,
  RollingReserveEntry,
  PayoutSummary,
  SettlementReport,
} from '../types/payout.js';
import { withTenantContext } from '@tixly/rls-multitenancy';

// ---------------------------------------------------------------------------
// TenantContext
// ---------------------------------------------------------------------------

type TenantContext = {
  promoterId?: string;
  userId?: string;
  role: 'service' | 'admin' | 'promoter' | 'buyer';
};

// ---------------------------------------------------------------------------
// Internal DB row types
// ---------------------------------------------------------------------------

interface PayoutRow {
  id: string;
  promoter_id: string;
  period_from: string;
  period_to: string;
  gross_revenue: number;
  platform_fees: number;
  refunds: number;
  chargebacks: number;
  rolling_reserve: number;
  net_payout: number;
  status: PayoutStatus;
  payout_cycle: string | null;
  bank_reference: string | null;
  paid_at: string | null;
  failure_reason: string | null;
  retry_count: number;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

interface PayoutSettingsRow {
  promoter_id: string;
  payout_cycle: string;
  rolling_reserve_pct: number;
  reserve_release_days: number;
  min_payout_amount: number;
  updated_at: string;
}

interface EventSettlementRow {
  id: string;
  event_id: string;
  promoter_id: string;
  payout_id: string | null;
  tickets_sold: number;
  gross_revenue: number;
  platform_fees: number;
  refunds_count: number;
  refunds_amount: number;
  chargebacks_count: number;
  chargebacks_amount: number;
  net_revenue: number;
  settled: boolean;
  settled_at: string | null;
  created_at: string;
  updated_at: string;
}

interface RollingReserveRow {
  id: string;
  promoter_id: string;
  payout_id: string | null;
  amount: number;
  release_date: string;
  released: boolean;
  released_at: string | null;
  created_at: string;
}

interface PromoterRow {
  id: string;
  email: string;
  name: string;
  bank_account: string | null;
  locale: string | null;
}

interface OrderAggRow {
  gross_revenue: string | null;
  platform_fees: string | null;
  tickets_sold: string | null;
}

interface RefundAggRow {
  refunds_amount: string | null;
  refunds_count: string | null;
}

interface ChargebackAggRow {
  chargebacks_amount: string | null;
  chargebacks_count: string | null;
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function mapPayout(row: PayoutRow): Payout {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    periodFrom: row.period_from,
    periodTo: row.period_to,
    grossRevenue: row.gross_revenue,
    platformFees: row.platform_fees,
    refunds: row.refunds,
    chargebacks: row.chargebacks,
    rollingReserve: row.rolling_reserve,
    netPayout: row.net_payout,
    status: row.status,
    payoutCycle: row.payout_cycle,
    bankReference: row.bank_reference,
    paidAt: row.paid_at,
    failureReason: row.failure_reason,
    retryCount: row.retry_count,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
  };
}

function mapSettings(row: PayoutSettingsRow): PayoutSettings {
  return {
    promoterId: row.promoter_id,
    payoutCycle: row.payout_cycle as PayoutSettings['payoutCycle'],
    rollingReservePct: row.rolling_reserve_pct,
    reserveReleaseDays: row.reserve_release_days,
    minPayoutAmount: row.min_payout_amount,
  };
}

function mapSettlement(row: EventSettlementRow): EventSettlement {
  return {
    id: row.id,
    eventId: row.event_id,
    promoterId: row.promoter_id,
    payoutId: row.payout_id,
    ticketsSold: row.tickets_sold,
    grossRevenue: row.gross_revenue,
    platformFees: row.platform_fees,
    refundsCount: row.refunds_count,
    refundsAmount: row.refunds_amount,
    chargebacksCount: row.chargebacks_count,
    chargebacksAmount: row.chargebacks_amount,
    netRevenue: row.net_revenue,
    settled: row.settled,
    settledAt: row.settled_at,
  };
}

function mapReserve(row: RollingReserveRow): RollingReserveEntry {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    payoutId: row.payout_id,
    amount: row.amount,
    releaseDate: row.release_date,
    released: row.released,
    releasedAt: row.released_at,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Settlement výpočet
// ---------------------------------------------------------------------------

/**
 * Vypočítá a uloží settlement pro jeden event.
 */
export async function calculateEventSettlement(
  eventId: string,
  promoterId: string,
  deps: ServiceDeps,
  context: TenantContext = { role: 'service' },
): Promise<EventSettlement> {
  return withTenantContext(deps.db, context, async (db) => {
  // Agregace zaplacených objednávek
  const paidRows = await db.query<OrderAggRow>(
    `SELECT
       COALESCE(SUM(o.promoter_payout), 0)::text        AS gross_revenue,
       COALESCE(SUM(o.platform_fee_amount), 0)::text    AS platform_fees,
       COUNT(*)::text                                    AS tickets_sold
     FROM orders.orders o
     WHERE o.promoter_id = $1
       AND o.event_id = $2
       AND o.status = 'paid'`,
    [promoterId, eventId]
  );

  const grossRevenue = parseInt(paidRows[0]?.gross_revenue ?? '0', 10);
  const platformFees = parseInt(paidRows[0]?.platform_fees ?? '0', 10);
  const ticketsSold = parseInt(paidRows[0]?.tickets_sold ?? '0', 10);

  // Agregace refundů
  const refundRows = await db.query<RefundAggRow>(
    `SELECT
       COALESCE(SUM(o.promoter_payout), 0)::text AS refunds_amount,
       COUNT(*)::text                            AS refunds_count
     FROM orders.orders o
     WHERE o.promoter_id = $1
       AND o.event_id = $2
       AND o.status = 'refunded'`,
    [promoterId, eventId]
  );

  const refundsAmount = parseInt(refundRows[0]?.refunds_amount ?? '0', 10);
  const refundsCount = parseInt(refundRows[0]?.refunds_count ?? '0', 10);

  // Agregace chargebacků
  const chargebackRows = await db.query<ChargebackAggRow>(
    `SELECT
       COALESCE(SUM(o.promoter_payout), 0)::text AS chargebacks_amount,
       COUNT(*)::text                            AS chargebacks_count
     FROM orders.orders o
     WHERE o.promoter_id = $1
       AND o.event_id = $2
       AND o.status = 'chargeback'`,
    [promoterId, eventId]
  );

  const chargebacksAmount = parseInt(chargebackRows[0]?.chargebacks_amount ?? '0', 10);
  const chargebacksCount = parseInt(chargebackRows[0]?.chargebacks_count ?? '0', 10);

  const netRevenue = grossRevenue - platformFees - refundsAmount - chargebacksAmount;

  // UPSERT do platform.event_settlements
  const upsertRows = await db.query<EventSettlementRow>(
    `INSERT INTO platform.event_settlements (
       event_id, promoter_id,
       tickets_sold, gross_revenue, platform_fees,
       refunds_count, refunds_amount,
       chargebacks_count, chargebacks_amount,
       net_revenue
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (event_id, promoter_id) DO UPDATE SET
       tickets_sold      = EXCLUDED.tickets_sold,
       gross_revenue     = EXCLUDED.gross_revenue,
       platform_fees     = EXCLUDED.platform_fees,
       refunds_count     = EXCLUDED.refunds_count,
       refunds_amount    = EXCLUDED.refunds_amount,
       chargebacks_count = EXCLUDED.chargebacks_count,
       chargebacks_amount = EXCLUDED.chargebacks_amount,
       net_revenue       = EXCLUDED.net_revenue,
       updated_at        = NOW()
     RETURNING *`,
    [
      eventId,
      promoterId,
      ticketsSold,
      grossRevenue,
      platformFees,
      refundsCount,
      refundsAmount,
      chargebacksCount,
      chargebacksAmount,
      netRevenue,
    ]
  );

  return mapSettlement(upsertRows[0]);
  }); // end withTenantContext
}

/**
 * Agreguje settlementu do payout záznamu.
 */
export async function createPayoutForPromoter(
  promoterId: string,
  periodFrom: Date,
  periodTo: Date,
  deps: ServiceDeps,
  context: TenantContext = { role: 'service' },
): Promise<Payout> {
  const { kafka } = deps;
  return withTenantContext(deps.db, context, async (db) => {

  // Načti nastavení promotéra (nebo použij výchozí)
  const settingsRows = await db.query<PayoutSettingsRow>(
    `SELECT * FROM platform.payout_settings WHERE promoter_id = $1`,
    [promoterId]
  );

  const settings: PayoutSettings =
    settingsRows.length > 0
      ? mapSettings(settingsRows[0])
      : {
          promoterId,
          payoutCycle: 'post_event',
          rollingReservePct: 500,
          reserveReleaseDays: 30,
          minPayoutAmount: 10000,
        };

  // Agregace unsettled settlementů v období
  const aggRows = await db.query<{
    gross: string | null;
    fees: string | null;
    refunds: string | null;
    chargebacks: string | null;
    settlement_ids: string;
  }>(
    `SELECT
       COALESCE(SUM(gross_revenue), 0)::text     AS gross,
       COALESCE(SUM(platform_fees), 0)::text     AS fees,
       COALESCE(SUM(refunds_amount), 0)::text    AS refunds,
       COALESCE(SUM(chargebacks_amount), 0)::text AS chargebacks,
       COALESCE(string_agg(id::text, ','), '')   AS settlement_ids
     FROM platform.event_settlements
     WHERE promoter_id = $1
       AND settled = FALSE
       AND created_at BETWEEN $2 AND $3`,
    [promoterId, periodFrom.toISOString(), periodTo.toISOString()]
  );

  const grossRevenue = parseInt(aggRows[0]?.gross ?? '0', 10);
  const platformFees = parseInt(aggRows[0]?.fees ?? '0', 10);
  const refunds = parseInt(aggRows[0]?.refunds ?? '0', 10);
  const chargebacks = parseInt(aggRows[0]?.chargebacks ?? '0', 10);
  const settlementIds = (aggRows[0]?.settlement_ids ?? '')
    .split(',')
    .filter(Boolean);

  // Výpočet rolling reserve (nikdy float)
  const rollingReserve = Math.round(
    (grossRevenue * settings.rollingReservePct) / 10000
  );

  // net_payout = gross - fees - refunds - chargebacks - reserve
  const netPayout =
    grossRevenue - platformFees - refunds - chargebacks - rollingReserve;

  if (netPayout < settings.minPayoutAmount) {
    throw new PayoutError(
      'PAYOUT_BELOW_MINIMUM',
      `Výplata ${netPayout} halířů je nižší než minimum ${settings.minPayoutAmount} halířů.`
    );
  }

  const releaseDate = new Date(periodTo);
  releaseDate.setDate(releaseDate.getDate() + settings.reserveReleaseDays);
  const releaseDateStr = releaseDate.toISOString().slice(0, 10);

  return db.transaction(async (tx) => {
    // INSERT payout
    const payoutRows = await tx.query<PayoutRow>(
      `INSERT INTO platform.payouts (
         promoter_id, period_from, period_to,
         gross_revenue, platform_fees, refunds, chargebacks,
         rolling_reserve, net_payout, status, payout_cycle
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10)
       RETURNING *`,
      [
        promoterId,
        periodFrom.toISOString(),
        periodTo.toISOString(),
        grossRevenue,
        platformFees,
        refunds,
        chargebacks,
        rollingReserve,
        netPayout,
        settings.payoutCycle,
      ]
    );

    const payout = mapPayout(payoutRows[0]);

    // INSERT rolling_reserves (pouze pokud reserve > 0)
    if (rollingReserve > 0) {
      await tx.execute(
        `INSERT INTO platform.rolling_reserves (promoter_id, payout_id, amount, release_date)
         VALUES ($1, $2, $3, $4)`,
        [promoterId, payout.id, rollingReserve, releaseDateStr]
      );
    }

    // UPDATE event_settlements: settled=true, payout_id
    if (settlementIds.length > 0) {
      // Build parameterized query for array of IDs
      const placeholders = settlementIds
        .map((_, i) => `$${i + 3}`)
        .join(', ');
      await tx.execute(
        `UPDATE platform.event_settlements
         SET settled = TRUE, settled_at = NOW(), payout_id = $1, updated_at = NOW()
         WHERE promoter_id = $2 AND id IN (${placeholders})`,
        [payout.id, promoterId, ...settlementIds]
      );
    }

    // INSERT payout_events ('created')
    await tx.execute(
      `INSERT INTO platform.payout_events (payout_id, event_type, details)
       VALUES ($1, 'created', $2)`,
      [payout.id, JSON.stringify({ grossRevenue, netPayout, rollingReserve })]
    );

    // Kafka fire-and-forget
    kafka
      .send('payout.created', {
        payoutId: payout.id,
        promoterId,
        netPayout,
        periodFrom: periodFrom.toISOString(),
        periodTo: periodTo.toISOString(),
      })
      .catch(() => {});

    return payout;
  });
  }); // end withTenantContext
}

// ---------------------------------------------------------------------------
// Admin workflow
// ---------------------------------------------------------------------------

async function loadPayout(
  payoutId: string,
  db: ServiceDeps['db']
): Promise<PayoutRow> {
  const rows = await db.query<PayoutRow>(
    `SELECT * FROM platform.payouts WHERE id = $1`,
    [payoutId]
  );
  if (rows.length === 0) {
    throw new PayoutError('PAYOUT_NOT_FOUND');
  }
  return rows[0];
}

async function loadPromoter(
  promoterId: string,
  db: ServiceDeps['db']
): Promise<PromoterRow> {
  const rows = await db.query<PromoterRow>(
    `SELECT id, email, name, bank_account, locale FROM platform.promoters WHERE id = $1`,
    [promoterId]
  );
  if (rows.length === 0) {
    throw new PayoutError('PAYOUT_NOT_FOUND');
  }
  return rows[0];
}

/**
 * Schválení výplaty adminem.
 */
export async function approvePayout(
  payoutId: string,
  adminUserId: string,
  deps: ServiceDeps,
  context: TenantContext = { role: 'admin' },
): Promise<Payout> {
  const { kafka, email } = deps;
  return withTenantContext(deps.db, context, async (db) => {

  const row = await loadPayout(payoutId, db);

  if (row.status !== 'pending') {
    throw new PayoutError(
      'INVALID_STATUS_TRANSITION',
      `Výplatu ve stavu '${row.status}' nelze schválit.`
    );
  }

  const promoter = await loadPromoter(row.promoter_id, db);

  if (!promoter.bank_account) {
    throw new PayoutError('BANK_ACCOUNT_MISSING');
  }

  const updatedRows = await db.query<PayoutRow>(
    `UPDATE platform.payouts
     SET status = 'approved', approved_by = $2, approved_at = NOW(), updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [payoutId, adminUserId]
  );

  const payout = mapPayout(updatedRows[0]);

  await db.execute(
    `INSERT INTO platform.payout_events (payout_id, event_type, actor_user_id, details)
     VALUES ($1, 'approved', $2, $3)`,
    [payoutId, adminUserId, JSON.stringify({ approvedBy: adminUserId })]
  );

  kafka.send('payout.approved', { payoutId, promoterId: row.promoter_id }).catch(() => {});

  const expectedDate = new Date();
  expectedDate.setDate(expectedDate.getDate() + 2);
  const emailContent = payoutApprovedEmail(
    promoter.name,
    payout.netPayout,
    expectedDate.toLocaleDateString(promoter.locale ?? 'cs-CZ')
  );
  email.send(promoter.email, emailContent.subject, emailContent.html).catch(() => {});

  return payout;
  }); // end withTenantContext
}

/**
 * Označení výplaty jako zpracovávané.
 */
export async function markPayoutProcessing(
  payoutId: string,
  adminUserId: string,
  deps: ServiceDeps,
  context: TenantContext = { role: 'admin' },
): Promise<Payout> {
  const { kafka } = deps;
  return withTenantContext(deps.db, context, async (db) => {

  const row = await loadPayout(payoutId, db);

  if (row.status !== 'approved') {
    throw new PayoutError(
      'INVALID_STATUS_TRANSITION',
      `Výplatu ve stavu '${row.status}' nelze přesunout do stavu 'processing'.`
    );
  }

  const updatedRows = await db.query<PayoutRow>(
    `UPDATE platform.payouts
     SET status = 'processing', updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [payoutId]
  );

  const payout = mapPayout(updatedRows[0]);

  await db.execute(
    `INSERT INTO platform.payout_events (payout_id, event_type, actor_user_id, details)
     VALUES ($1, 'processing', $2, $3)`,
    [payoutId, adminUserId, JSON.stringify({})]
  );

  kafka.send('payout.processing', { payoutId, promoterId: row.promoter_id }).catch(() => {});

  return payout;
  }); // end withTenantContext
}

/**
 * Potvrzení úspěšné výplaty.
 */
export async function markPayoutPaid(
  payoutId: string,
  bankReference: string,
  adminUserId: string,
  deps: ServiceDeps,
  context: TenantContext = { role: 'admin' },
): Promise<Payout> {
  const { kafka, email } = deps;
  return withTenantContext(deps.db, context, async (db) => {

  const row = await loadPayout(payoutId, db);

  if (row.status !== 'processing') {
    throw new PayoutError(
      'INVALID_STATUS_TRANSITION',
      `Výplatu ve stavu '${row.status}' nelze označit jako zaplacenou.`
    );
  }

  const updatedRows = await db.query<PayoutRow>(
    `UPDATE platform.payouts
     SET status = 'paid', bank_reference = $2, paid_at = NOW(), updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [payoutId, bankReference]
  );

  const payout = mapPayout(updatedRows[0]);

  await db.execute(
    `INSERT INTO platform.payout_events (payout_id, event_type, actor_user_id, details)
     VALUES ($1, 'paid', $2, $3)`,
    [payoutId, adminUserId, JSON.stringify({ bankReference })]
  );

  kafka.send('payout.paid', { payoutId, promoterId: row.promoter_id, bankReference }).catch(() => {});

  const promoter = await loadPromoter(row.promoter_id, db);
  const paidAtStr = payout.paidAt
    ? new Date(payout.paidAt).toLocaleDateString(promoter.locale ?? 'cs-CZ')
    : new Date().toLocaleDateString(promoter.locale ?? 'cs-CZ');
  const emailContent = payoutPaidEmail(
    promoter.name,
    payout.netPayout,
    bankReference,
    paidAtStr
  );
  email.send(promoter.email, emailContent.subject, emailContent.html).catch(() => {});

  return payout;
  }); // end withTenantContext
}

/**
 * Označení selhání bankovního transferu.
 */
export async function markPayoutFailed(
  payoutId: string,
  reason: string,
  adminUserId: string,
  deps: ServiceDeps,
  context: TenantContext = { role: 'admin' },
): Promise<Payout> {
  const { kafka, email } = deps;
  return withTenantContext(deps.db, context, async (db) => {

  const row = await loadPayout(payoutId, db);

  if (row.status !== 'processing') {
    throw new PayoutError(
      'INVALID_STATUS_TRANSITION',
      `Výplatu ve stavu '${row.status}' nelze označit jako selhavší.`
    );
  }

  const updatedRows = await db.query<PayoutRow>(
    `UPDATE platform.payouts
     SET status = 'failed',
         failure_reason = $2,
         retry_count = retry_count + 1,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [payoutId, reason]
  );

  const payout = mapPayout(updatedRows[0]);

  await db.execute(
    `INSERT INTO platform.payout_events (payout_id, event_type, actor_user_id, details)
     VALUES ($1, 'failed', $2, $3)`,
    [payoutId, adminUserId, JSON.stringify({ reason })]
  );

  kafka.send('payout.failed', { payoutId, promoterId: row.promoter_id, reason }).catch(() => {});

  const promoter = await loadPromoter(row.promoter_id, db);
  const emailContent = payoutFailedEmail(promoter.name, payout.netPayout, reason);
  email.send(promoter.email, emailContent.subject, emailContent.html).catch(() => {});

  return payout;
  }); // end withTenantContext
}

/**
 * Admin seznam výplat s filtrací.
 */
export async function adminListPayouts(
  filters: { promoterId?: string; status?: PayoutStatus; from?: string; to?: string },
  pagination: { limit?: number; offset?: number },
  deps: ServiceDeps,
  context: TenantContext = { role: 'admin' },
): Promise<{ items: Payout[]; total: number }> {
  return withTenantContext(deps.db, context, async (db) => {
  const limit = pagination.limit ?? 20;
  const offset = pagination.offset ?? 0;

  const conditions: string[] = ['1=1'];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (filters.promoterId) {
    conditions.push(`promoter_id = $${paramIdx++}`);
    params.push(filters.promoterId);
  }
  if (filters.status) {
    conditions.push(`status = $${paramIdx++}`);
    params.push(filters.status);
  }
  if (filters.from) {
    conditions.push(`created_at >= $${paramIdx++}`);
    params.push(filters.from);
  }
  if (filters.to) {
    conditions.push(`created_at <= $${paramIdx++}`);
    params.push(filters.to);
  }

  const where = conditions.join(' AND ');

  const countRows = await db.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM platform.payouts WHERE ${where}`,
    params
  );
  const total = parseInt(countRows[0]?.total ?? '0', 10);

  const rows = await db.query<PayoutRow>(
    `SELECT * FROM platform.payouts WHERE ${where}
     ORDER BY created_at DESC
     LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
    [...params, limit, offset]
  );

  return { items: rows.map(mapPayout), total };
  }); // end withTenantContext
}

// ---------------------------------------------------------------------------
// Promotér — přehled výplat
// ---------------------------------------------------------------------------

/**
 * Výplatní přehled promotéra.
 */
export async function getPayoutSummary(
  promoterId: string,
  deps: ServiceDeps,
  context: TenantContext = { role: 'promoter', promoterId },
): Promise<PayoutSummary> {
  return withTenantContext(deps.db, context, async (db) => {
  // Součet pending payoutů
  const pendingRows = await db.query<{ pending_amount: string }>(
    `SELECT COALESCE(SUM(net_payout), 0)::text AS pending_amount
     FROM platform.payouts
     WHERE promoter_id = $1 AND status = 'pending'`,
    [promoterId]
  );
  const pendingAmount = parseInt(pendingRows[0]?.pending_amount ?? '0', 10);

  // Dostupná reserve (release_date <= dnes, released = FALSE)
  const availableReserveRows = await db.query<{ available: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS available
     FROM platform.rolling_reserves
     WHERE promoter_id = $1 AND released = FALSE AND release_date <= CURRENT_DATE`,
    [promoterId]
  );
  const availableReserve = parseInt(availableReserveRows[0]?.available ?? '0', 10);

  // Celková zadržená reserve
  const totalReserveRows = await db.query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total
     FROM platform.rolling_reserves
     WHERE promoter_id = $1 AND released = FALSE`,
    [promoterId]
  );
  const totalReserveHeld = parseInt(totalReserveRows[0]?.total ?? '0', 10);

  // Poslední výplata
  const lastPaidRows = await db.query<{ paid_at: string | null }>(
    `SELECT paid_at FROM platform.payouts
     WHERE promoter_id = $1 AND status = 'paid'
     ORDER BY paid_at DESC LIMIT 1`,
    [promoterId]
  );
  const lastPaidAt = lastPaidRows[0]?.paid_at ?? null;

  // Odhadované datum příští výplaty dle payout_cycle
  const settingsRows = await db.query<PayoutSettingsRow>(
    `SELECT * FROM platform.payout_settings WHERE promoter_id = $1`,
    [promoterId]
  );

  let nextPayoutDate: string | null = null;
  if (settingsRows.length > 0) {
    const cycle = settingsRows[0].payout_cycle;
    const now = new Date();
    if (cycle === 'daily') {
      const next = new Date(now);
      next.setDate(next.getDate() + 1);
      nextPayoutDate = next.toISOString().slice(0, 10);
    } else if (cycle === 'weekly') {
      // Příští pondělí
      const next = new Date(now);
      const day = next.getDay();
      const daysUntilMonday = day === 0 ? 1 : 8 - day;
      next.setDate(next.getDate() + daysUntilMonday);
      nextPayoutDate = next.toISOString().slice(0, 10);
    } else if (cycle === 'monthly') {
      // 1. příštího měsíce — formátujeme lokálně bez UTC konverze
      const nextYear = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
      const nextMonthNum = now.getMonth() === 11 ? 1 : now.getMonth() + 2;
      nextPayoutDate = `${nextYear}-${String(nextMonthNum).padStart(2, '0')}-01`;
    } else if (cycle === 'post_event') {
      nextPayoutDate = null; // závisí na konci eventu
    } else {
      nextPayoutDate = null; // manual
    }
  }

  return {
    promoterId,
    pendingAmount,
    availableReserve,
    totalReserveHeld,
    lastPaidAt,
    nextPayoutDate,
  };
  }); // end withTenantContext
}

/**
 * Seznam výplat promotéra.
 */
export async function listPayouts(
  promoterId: string,
  pagination: { limit?: number; offset?: number },
  deps: ServiceDeps,
  context: TenantContext = { role: 'promoter', promoterId },
): Promise<{ items: Payout[]; total: number }> {
  return withTenantContext(deps.db, context, async (db) => {
  const limit = pagination.limit ?? 20;
  const offset = pagination.offset ?? 0;

  const countRows = await db.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM platform.payouts WHERE promoter_id = $1`,
    [promoterId]
  );
  const total = parseInt(countRows[0]?.total ?? '0', 10);

  const rows = await db.query<PayoutRow>(
    `SELECT * FROM platform.payouts WHERE promoter_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [promoterId, limit, offset]
  );

  return { items: rows.map(mapPayout), total };
  }); // end withTenantContext
}

/**
 * Detail výplaty se settlementem (pro promotéra).
 * Anti-enumeration: vrátí 404 pro cizí promotéry.
 */
export async function getPayoutDetail(
  payoutId: string,
  promoterId: string,
  deps: ServiceDeps,
  context: TenantContext = { role: 'promoter', promoterId },
): Promise<SettlementReport> {
  return withTenantContext(deps.db, context, async (db) => {
  const payoutRows = await db.query<PayoutRow>(
    `SELECT * FROM platform.payouts WHERE id = $1 AND promoter_id = $2`,
    [payoutId, promoterId]
  );

  if (payoutRows.length === 0) {
    // Anti-enumeration: stejná chyba pro neexistující i cizí payout
    throw new PayoutError('PAYOUT_NOT_FOUND');
  }

  const payout = mapPayout(payoutRows[0]);

  const settlementRows = await db.query<EventSettlementRow>(
    `SELECT * FROM platform.event_settlements WHERE payout_id = $1 ORDER BY created_at ASC`,
    [payoutId]
  );

  const reserveRows = await db.query<RollingReserveRow>(
    `SELECT * FROM platform.rolling_reserves WHERE payout_id = $1 ORDER BY created_at ASC`,
    [payoutId]
  );

  const settlements = settlementRows.map(mapSettlement);
  const reserveEntries = reserveRows.map(mapReserve);

  const totalGross = settlements.reduce((s, e) => s + e.grossRevenue, 0);
  const totalFees = settlements.reduce((s, e) => s + e.platformFees, 0);
  const totalRefunds = settlements.reduce((s, e) => s + e.refundsAmount, 0);
  const totalChargebacks = settlements.reduce((s, e) => s + e.chargebacksAmount, 0);
  const totalReserve = reserveEntries.reduce((s, r) => s + r.amount, 0);
  const totalNet = payout.netPayout;

  return {
    payout,
    settlements,
    reserveEntries,
    summary: {
      totalGross,
      totalFees,
      totalRefunds,
      totalChargebacks,
      totalReserve,
      totalNet,
    },
  };
  }); // end withTenantContext
}

/**
 * Nastavení výplatního cyklu (UPSERT).
 */
export async function updatePayoutSettings(
  promoterId: string,
  input: Partial<PayoutSettings>,
  deps: ServiceDeps,
  context: TenantContext = { role: 'promoter', promoterId },
): Promise<PayoutSettings> {
  return withTenantContext(deps.db, context, async (db) => {

  // Načti existující nebo použij výchozí
  const existingRows = await db.query<PayoutSettingsRow>(
    `SELECT * FROM platform.payout_settings WHERE promoter_id = $1`,
    [promoterId]
  );

  const existing: PayoutSettings =
    existingRows.length > 0
      ? mapSettings(existingRows[0])
      : {
          promoterId,
          payoutCycle: 'post_event',
          rollingReservePct: 500,
          reserveReleaseDays: 30,
          minPayoutAmount: 10000,
        };

  const merged: PayoutSettings = {
    promoterId,
    payoutCycle: input.payoutCycle ?? existing.payoutCycle,
    rollingReservePct: input.rollingReservePct ?? existing.rollingReservePct,
    reserveReleaseDays: input.reserveReleaseDays ?? existing.reserveReleaseDays,
    minPayoutAmount: input.minPayoutAmount ?? existing.minPayoutAmount,
  };

  const upsertRows = await db.query<PayoutSettingsRow>(
    `INSERT INTO platform.payout_settings (
       promoter_id, payout_cycle, rolling_reserve_pct, reserve_release_days, min_payout_amount
     ) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (promoter_id) DO UPDATE SET
       payout_cycle         = EXCLUDED.payout_cycle,
       rolling_reserve_pct  = EXCLUDED.rolling_reserve_pct,
       reserve_release_days = EXCLUDED.reserve_release_days,
       min_payout_amount    = EXCLUDED.min_payout_amount,
       updated_at           = NOW()
     RETURNING *`,
    [
      promoterId,
      merged.payoutCycle,
      merged.rollingReservePct,
      merged.reserveReleaseDays,
      merged.minPayoutAmount,
    ]
  );

  return mapSettings(upsertRows[0]);
  }); // end withTenantContext
}

// ---------------------------------------------------------------------------
// Rolling reserve uvolnění (cron)
// ---------------------------------------------------------------------------

/**
 * Cron job — spouštět denně v 07:00.
 * Uvolní matured reserves a emituje Kafka eventy.
 */
export async function releaseMaturedReserves(
  deps: ServiceDeps,
  context: TenantContext = { role: 'service' },
): Promise<{ released: number; amount: number }> {
  const { kafka } = deps;
  return withTenantContext(deps.db, context, async (db) => {
  const reserveRows = await db.query<RollingReserveRow>(
    `SELECT * FROM platform.rolling_reserves
     WHERE release_date <= CURRENT_DATE AND released = FALSE
     ORDER BY release_date ASC`,
    []
  );

  if (reserveRows.length === 0) {
    return { released: 0, amount: 0 };
  }

  let totalReleased = 0;
  let totalAmount = 0;

  // Agregace per promotér pro Kafka event
  const promoterAmounts = new Map<string, number>();

  for (const reserve of reserveRows) {
    await db.execute(
      `UPDATE platform.rolling_reserves
       SET released = TRUE, released_at = NOW()
       WHERE id = $1`,
      [reserve.id]
    );

    totalReleased++;
    totalAmount += reserve.amount;

    const prev = promoterAmounts.get(reserve.promoter_id) ?? 0;
    promoterAmounts.set(reserve.promoter_id, prev + reserve.amount);
  }

  // Emituj Kafka event per promotér
  for (const [promoterId, amount] of promoterAmounts.entries()) {
    kafka
      .send('payout.reserve_released', { promoterId, amount })
      .catch(() => {});
  }

  return { released: totalReleased, amount: totalAmount };
  }); // end withTenantContext
}

/**
 * Automatické vytvoření payoutů dle nastavení cyklu.
 * Cron — spouštět denně v 06:00.
 */
export async function processPayoutCycles(
  deps: ServiceDeps,
  context: TenantContext = { role: 'service' },
): Promise<{ created: number }> {
  return withTenantContext(deps.db, context, async (db) => {

  const settingsRows = await db.query<PayoutSettingsRow>(
    `SELECT * FROM platform.payout_settings WHERE payout_cycle != 'manual'`,
    []
  );

  const now = new Date();
  let created = 0;

  for (const settings of settingsRows) {
    const cycle = settings.payout_cycle;
    const promoterId = settings.promoter_id;
    let shouldCreate = false;
    let periodFrom: Date;
    let periodTo: Date;

    if (cycle === 'daily') {
      shouldCreate = true;
      periodFrom = new Date(now);
      periodFrom.setDate(periodFrom.getDate() - 1);
      periodFrom.setHours(0, 0, 0, 0);
      periodTo = new Date(now);
      periodTo.setHours(0, 0, 0, 0);
    } else if (cycle === 'weekly') {
      // Každý pondělí
      shouldCreate = now.getDay() === 1;
      periodFrom = new Date(now);
      periodFrom.setDate(periodFrom.getDate() - 7);
      periodFrom.setHours(0, 0, 0, 0);
      periodTo = new Date(now);
      periodTo.setHours(0, 0, 0, 0);
    } else if (cycle === 'monthly') {
      // 1. každého měsíce
      shouldCreate = now.getDate() === 1;
      periodFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      periodTo = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (cycle === 'post_event') {
      // Hledáme eventy, které skončily před více než 24h a ještě nemají settled settlement
      const endedEventRows = await db.query<{ event_id: string; promoter_id: string }>(
        `SELECT es.event_id, es.promoter_id
         FROM platform.event_settlements es
         JOIN catalog.events e ON e.id = es.event_id
         WHERE es.promoter_id = $1
           AND es.settled = FALSE
           AND e.end_date <= NOW() - INTERVAL '24 hours'
         LIMIT 10`,
        [promoterId]
      );

      for (const row of endedEventRows) {
        try {
          periodFrom = new Date(now);
          periodFrom.setDate(periodFrom.getDate() - 90);
          periodTo = new Date(now);
          await createPayoutForPromoter(row.promoter_id, periodFrom, periodTo, deps);
          created++;
        } catch (err) {
          if (err instanceof PayoutError && err.code === 'PAYOUT_BELOW_MINIMUM') {
            // Přeskočit — pod minimem
          } else {
            throw err;
          }
        }
      }
      continue;
    } else {
      continue;
    }

    if (!shouldCreate) continue;

    try {
      await createPayoutForPromoter(promoterId, periodFrom!, periodTo!, deps);
      created++;
    } catch (err) {
      if (err instanceof PayoutError && err.code === 'PAYOUT_BELOW_MINIMUM') {
        // Přeskočit — pod minimem
      } else {
        throw err;
      }
    }
  }

  return { created };
  }); // end withTenantContext
}
