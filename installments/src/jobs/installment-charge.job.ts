// Installment charge cron job.
// Runs daily at 09:00 and processes all overdue installment payments.
//
// Usage (node-cron example):
//   import cron from 'node-cron';
//   import { InstallmentChargeJob } from './installment-charge.job';
//   const job = new InstallmentChargeJob(db, gopay);
//   job.register(cron);

import { InstallmentService } from '../services/installment.service';
import type { InstallmentDbAdapter, GoPayAdapter } from '../services/installment.service';

// ---------------------------------------------------------------------------
// Skip-if-running guard
// ---------------------------------------------------------------------------

let isRunning = false;

// ---------------------------------------------------------------------------
// InstallmentChargeJob
// ---------------------------------------------------------------------------

export class InstallmentChargeJob {
  private readonly service: InstallmentService;

  constructor(
    private readonly db: InstallmentDbAdapter,
    private readonly gopay: GoPayAdapter,
  ) {
    this.service = new InstallmentService();
  }

  // -------------------------------------------------------------------------
  // run
  // -------------------------------------------------------------------------

  /**
   * Processes all overdue installment payments.
   * Guarded against concurrent execution (skip-if-running).
   */
  async run(): Promise<void> {
    if (isRunning) {
      console.warn('[installment-job] Previous run still in progress — skipping this tick.');
      return;
    }

    isRunning = true;
    const startedAt = Date.now();

    console.info(`[installment-job] Starting overdue payment processing at ${new Date().toISOString()}`);

    try {
      const result = await this.service.processOverduePayments(this.db, this.gopay);

      const durationMs = Date.now() - startedAt;
      console.info(
        `[installment-job] Completed in ${durationMs}ms — ` +
          `charged: ${result.charged}, failed: ${result.failed}, cancelled: ${result.cancelled}`,
      );
    } catch (err) {
      console.error('[installment-job] Fatal error during run:', err);
    } finally {
      isRunning = false;
    }
  }

  // -------------------------------------------------------------------------
  // register — wire into a cron runtime
  // -------------------------------------------------------------------------

  /**
   * Registers the daily 09:00 cron schedule.
   *
   * @param cron Any cron runtime with a `.schedule(expression, fn)` method.
   *             Works with node-cron, cron, etc.
   *
   * @example
   *   import cron from 'node-cron';
   *   job.register(cron);
   */
  register(cron: { schedule(expression: string, fn: () => void | Promise<void>): void }): void {
    // Daily at 09:00 (server local time).
    cron.schedule('0 9 * * *', () => {
      void this.run();
    });

    console.info('[installment-job] Registered daily 09:00 cron schedule.');
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

/**
 * Registers SIGINT / SIGTERM handlers so the process waits for the current
 * run to finish before exiting.
 *
 * Call once at process startup alongside `job.register(cron)`.
 */
export function registerGracefulShutdown(): void {
  const shutdown = (signal: string) => {
    console.info(`[installment-job] ${signal} received. Waiting for current run to finish…`);

    const poll = setInterval(() => {
      if (!isRunning) {
        clearInterval(poll);
        console.info('[installment-job] Graceful shutdown complete.');
        process.exit(0);
      }
    }, 250);
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}
