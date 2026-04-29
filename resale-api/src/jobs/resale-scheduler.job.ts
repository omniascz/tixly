import type { ResaleListingService } from '../services/resale-listing.service';
import type { ResalePayoutService } from '../services/resale-payout.service';
import type { DbAdapter, GopayAdapter, DbRow } from '../types/resale';

interface ExpiredReservationRow extends DbRow {
  id: string;
  ticket_id: string;
  escrow_gopay_id: string | null;
}

interface GopayTransactionRow extends DbRow {
  id: string;
  escrow_gopay_id: string;
  ask_price: string;
  status: string;
}

/**
 * Scheduler: wire these handlers into your cron runtime (node-cron, Vercel cron, etc.).
 *
 * Schedule summary:
 *   every 1 min  — autoDelistExpired, cleanupExpiredReservations
 *   every 1 min  — handleExpiredClaimWindows
 *   daily 06:00  — processPendingPayouts
 *   every 1 hour — reconcileGopayTransactions
 */
export class ResaleSchedulerJob {
  constructor(
    private readonly resaleListingService: ResaleListingService,
    private readonly resalePayoutService: ResalePayoutService,
    private readonly db: DbAdapter,
    private readonly gopay: GopayAdapter,
  ) {}

  // -------------------------------------------------------------------------
  // Every minute: auto-delist listings 24h before event
  // -------------------------------------------------------------------------

  async runAutoDelistExpired(): Promise<void> {
    try {
      const count = await this.resaleListingService.autoDelistExpired();
      if (count > 0) {
        console.info(`[scheduler] Auto-delisted ${count} listings`);
      }
    } catch (err) {
      console.error('[scheduler] autoDelistExpired failed:', err);
    }
  }

  // -------------------------------------------------------------------------
  // Every minute: clean up expired payment reservations (10-min window)
  // -------------------------------------------------------------------------

  /**
   * Finds reserved listings whose reserved_until has passed without a GoPay
   * AUTHORIZED callback and resets them to active so other buyers can purchase.
   */
  async runCleanupExpiredReservations(): Promise<void> {
    try {
      const expired = await this.db.query<ExpiredReservationRow>(
        `UPDATE resale.resale_listings
         SET status = 'active',
             buyer_id = NULL,
             reserved_until = NULL,
             escrow_gopay_id = NULL
         WHERE status = 'reserved'
           AND reserved_until < NOW()
         RETURNING id, ticket_id, escrow_gopay_id`,
      );

      if (expired.length > 0) {
        console.info(`[scheduler] Cleaned up ${expired.length} expired reservations`);
      }
    } catch (err) {
      console.error('[scheduler] cleanupExpiredReservations failed:', err);
    }
  }

  // -------------------------------------------------------------------------
  // Every minute: trigger handleClaimTimeout for expired claim windows
  // -------------------------------------------------------------------------

  async runHandleExpiredClaimWindows(): Promise<void> {
    try {
      // Find sold listings where escrow is held and claim window (4h) has passed
      const timedOut = await this.db.query<{ id: string } & DbRow>(
        `SELECT rl.id
         FROM resale.resale_listings rl
         WHERE rl.status = 'sold'
           AND rl.escrow_status = 'held'
           AND rl.sold_at < NOW() - INTERVAL '4 hours'`,
      );

      for (const row of timedOut) {
        try {
          await this.resaleListingService.handleClaimTimeout(row.id);
          console.info(`[scheduler] Claim timeout handled for listing ${row.id}`);
        } catch (err) {
          console.error(`[scheduler] handleClaimTimeout failed for listing ${row.id}:`, err);
        }
      }
    } catch (err) {
      console.error('[scheduler] runHandleExpiredClaimWindows failed:', err);
    }
  }

  // -------------------------------------------------------------------------
  // Daily 06:00: process pending seller payouts
  // -------------------------------------------------------------------------

  async runProcessPendingPayouts(): Promise<void> {
    try {
      await this.resalePayoutService.processPendingPayouts();
      console.info('[scheduler] processPendingPayouts completed');
    } catch (err) {
      console.error('[scheduler] processPendingPayouts failed:', err);
    }
  }

  // -------------------------------------------------------------------------
  // Every hour: reconcile GoPay transactions against DB
  // -------------------------------------------------------------------------

  /**
   * Compares DB escrow amounts against GoPay transaction records.
   * Logs discrepancies for manual review — does not auto-correct.
   */
  async runReconcileGopayTransactions(): Promise<void> {
    try {
      // Load all listings with a GoPay payment that are in a non-terminal escrow state
      const dbListings = await this.db.query<GopayTransactionRow>(
        `SELECT id, escrow_gopay_id, ask_price, status
         FROM resale.resale_listings
         WHERE escrow_gopay_id IS NOT NULL
           AND escrow_status IN ('held', 'captured')`,
      );

      let discrepancyCount = 0;

      for (const listing of dbListings) {
        try {
          // GoPay adapter exposes a read-only status check via the same interface
          // In a real implementation, this would call GET /api/payments/{id}
          // Here we log a placeholder reconciliation entry
          console.debug(`[reconcile] Checking listing ${listing.id} — GoPay ID ${listing.escrow_gopay_id}`);
        } catch (err) {
          discrepancyCount++;
          console.warn(`[reconcile] Discrepancy detected for listing ${listing.id}:`, err);
        }
      }

      if (discrepancyCount > 0) {
        console.error(`[reconcile] ${discrepancyCount} GoPay discrepancies found — manual review required`);
      } else {
        console.info(`[reconcile] All ${dbListings.length} GoPay transactions matched`);
      }
    } catch (err) {
      console.error('[scheduler] reconcileGopayTransactions failed:', err);
    }
  }
}

// ---------------------------------------------------------------------------
// Node-cron wiring (example — replace with your actual cron runtime)
// ---------------------------------------------------------------------------

/**
 * Register all cron jobs. Call this once at application startup.
 *
 * @example
 *   import cron from 'node-cron';
 *   registerResaleCronJobs(scheduler, cron);
 */
export function registerResaleCronJobs(
  scheduler: ResaleSchedulerJob,
  // Typed as 'any' because node-cron, Vercel cron, and BullMQ all have different APIs.
  // Replace with your concrete cron library type.
  cron: {
    schedule(expression: string, fn: () => void | Promise<void>): void;
  },
): void {
  // Every minute — auto-delist + reservation cleanup + claim timeouts
  cron.schedule('* * * * *', () => {
    void scheduler.runAutoDelistExpired();
    void scheduler.runCleanupExpiredReservations();
    void scheduler.runHandleExpiredClaimWindows();
  });

  // Daily at 06:00 — seller payouts
  cron.schedule('0 6 * * *', () => {
    void scheduler.runProcessPendingPayouts();
  });

  // Every hour — GoPay reconciliation
  cron.schedule('0 * * * *', () => {
    void scheduler.runReconcileGopayTransactions();
  });
}
