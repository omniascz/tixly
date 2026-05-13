import cron from 'node-cron';
import type { DbAdapter } from '../types/referral.types';
import {
  confirmConversion,
  cancelConversion,
} from '../services/conversion.service';
import { CreditTransactionType } from '../types/referral.types';

// ============================================================
// Referral Scheduler — background cron jobs
// ============================================================

const PENDING_CONFIRM_DAYS = 14;
const CREDIT_EXPIRY_MONTHS = 12;

interface PendingConversionRow {
  id: string;
  created_at: string;
}

interface ExpirableCreditRow {
  id: string;
  user_id: string;
  amount_halire: string;
}

interface RefundedConversionRow {
  order_id: string;
}

// ─── Job implementations ──────────────────────────────────────

/**
 * Job 1 — Confirm pending conversions older than 14 days.
 * Runs daily at 07:00.
 */
async function confirmMatureConversions(db: DbAdapter): Promise<void> {
  console.log('[referral-scheduler] confirmMatureConversions START');

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - PENDING_CONFIRM_DAYS);

  const rows = await db.query<PendingConversionRow>(
    `SELECT id FROM referral.conversions
     WHERE status = 'pending'
       AND created_at <= $1`,
    [cutoff.toISOString()],
  );

  const results = await Promise.allSettled(
    rows.map((row) => confirmConversion(row.id, db)),
  );

  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;

  console.log(
    `[referral-scheduler] confirmMatureConversions DONE — confirmed: ${succeeded}, failed: ${failed}`,
  );
  if (failed > 0) {
    results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .forEach((r) => console.error('[referral-scheduler] confirm error:', r.reason));
  }
}

/**
 * Job 2 — Expire credits older than 12 months.
 * Runs daily at 08:00.
 */
async function expireOldCredits(db: DbAdapter): Promise<void> {
  console.log('[referral-scheduler] expireOldCredits START');

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - CREDIT_EXPIRY_MONTHS);

  // Find referral_earned transactions older than 12 months where the
  // referenced conversion is still confirmed (not already spent/expired).
  // We expire any positive transaction that hasn't been reversed yet.
  const rows = await db.query<ExpirableCreditRow>(
    `SELECT ct.id, ct.user_id, ct.amount_halire
     FROM referral.credit_transactions ct
     WHERE ct.type = 'referral_earned'
       AND ct.created_at <= $1
       AND NOT EXISTS (
         SELECT 1 FROM referral.credit_transactions ct2
         WHERE ct2.reference_id = ct.reference_id
           AND ct2.type = 'expired'
       )`,
    [cutoff.toISOString()],
  );

  const results = await Promise.allSettled(
    rows.map(async (row) => {
      const amountHalire = parseInt(row.amount_halire, 10);

      // Insert expiry transaction (negative to deduct)
      await db.execute(
        `INSERT INTO referral.credit_transactions
           (user_id, amount_halire, type, reference_id, description)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          row.user_id,
          -amountHalire,
          CreditTransactionType.Expired,
          row.id,
          `Credit expired (12-month limit reached)`,
        ],
      );

      // Deduct from wallet (floor at 0 via DB CHECK)
      await db.execute(
        `UPDATE referral.credit_wallet
         SET balance_halire = GREATEST(0, balance_halire - $1),
             updated_at     = NOW()
         WHERE user_id = $2`,
        [amountHalire, row.user_id],
      );
    }),
  );

  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;

  console.log(
    `[referral-scheduler] expireOldCredits DONE — expired: ${succeeded}, failed: ${failed}`,
  );
  if (failed > 0) {
    results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .forEach((r) => console.error('[referral-scheduler] expire error:', r.reason));
  }
}

/**
 * Job 3 — Cancel conversions whose underlying order has been refunded.
 * Runs daily at 09:00.
 */
async function cancelRefundedConversions(db: DbAdapter): Promise<void> {
  console.log('[referral-scheduler] cancelRefundedConversions START');

  // Join referral.conversions with orders.orders to find refunded ones
  const rows = await db.query<RefundedConversionRow>(
    `SELECT c.order_id
     FROM referral.conversions c
     JOIN orders.orders o ON o.id = c.order_id
     WHERE c.status IN ('pending', 'confirmed')
       AND o.status = 'refunded'`,
    [],
  );

  const results = await Promise.allSettled(
    rows.map((row) => cancelConversion(row.order_id, db)),
  );

  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;

  console.log(
    `[referral-scheduler] cancelRefundedConversions DONE — cancelled: ${succeeded}, failed: ${failed}`,
  );
  if (failed > 0) {
    results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .forEach((r) => console.error('[referral-scheduler] cancel error:', r.reason));
  }
}

// ─── Scheduler bootstrap ─────────────────────────────────────

export function startReferralScheduler(db: DbAdapter): void {
  const tasks: cron.ScheduledTask[] = [];

  // Job 1: confirm mature conversions — daily at 07:00
  tasks.push(
    cron.schedule('0 7 * * *', () => {
      confirmMatureConversions(db).catch((err) =>
        console.error('[referral-scheduler] FATAL confirmMatureConversions:', err),
      );
    }),
  );

  // Job 2: expire old credits — daily at 08:00
  tasks.push(
    cron.schedule('0 8 * * *', () => {
      expireOldCredits(db).catch((err) =>
        console.error('[referral-scheduler] FATAL expireOldCredits:', err),
      );
    }),
  );

  // Job 3: cancel refunded conversions — daily at 09:00
  tasks.push(
    cron.schedule('0 9 * * *', () => {
      cancelRefundedConversions(db).catch((err) =>
        console.error('[referral-scheduler] FATAL cancelRefundedConversions:', err),
      );
    }),
  );

  console.log('[referral-scheduler] 3 cron jobs scheduled (07:00, 08:00, 09:00 UTC)');

  // Graceful shutdown
  const shutdown = () => {
    console.log('[referral-scheduler] Shutting down...');
    tasks.forEach((t) => t.stop());
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
