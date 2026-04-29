import { SeasonPassService } from '../services/season-pass.service';

// =============================================================================
// Retry state — in-memory; for production use a persistent retry queue (Kafka)
// =============================================================================

interface RetryRecord {
  passId: string;
  attempts: number;
  nextAttemptAt: Date;
}

// =============================================================================
// PassRenewalJob
// =============================================================================

export interface RenewalJobLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
}

export interface RenewalJobDBAdapter {
  /** Returns passes in 'suspended' status with renewal_attempts < maxAttempts due for retry. */
  getPassesDueForRetry(before: Date, maxAttempts: number): Promise<Array<{ id: string; attempts: number }>>;
  incrementRenewalAttempts(passId: string): Promise<void>;
  cancelPassAfterMaxRetries(passId: string): Promise<void>;
}

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_INTERVAL_HOURS = 24;

export class PassRenewalJob {
  constructor(
    private readonly seasonPassService: SeasonPassService,
    private readonly db: RenewalJobDBAdapter,
    private readonly logger: RenewalJobLogger
  ) {}

  /**
   * Main entry point — scheduled daily at 08:00.
   * 1. Runs checkAndRenewExpiring() for passes due today.
   * 2. Retries suspended passes within max retry window.
   */
  async run(): Promise<void> {
    this.logger.info('PassRenewalJob started');

    // --- Step 1: Renew passes expiring within 24 hours ---
    let renewed = 0;
    let failed = 0;
    let totalRevenue = 0;

    try {
      const result = await this.seasonPassService.checkAndRenewExpiring();
      renewed = result.renewed;
      failed = result.failed;
      totalRevenue = result.totalRevenue;
    } catch (err) {
      this.logger.error('checkAndRenewExpiring threw unexpectedly', { err });
    }

    this.logger.info('Renewal pass run complete', {
      renewed,
      failed,
      totalRevenueCZK: totalRevenue,
    });

    // --- Step 2: Retry suspended passes ---
    await this.retryFailedRenewals();
  }

  /**
   * Retries suspended passes up to MAX_RETRY_ATTEMPTS times, each 24 hours apart.
   * After MAX_RETRY_ATTEMPTS failures the pass is permanently cancelled.
   */
  private async retryFailedRenewals(): Promise<void> {
    const now = new Date();
    const duePasses = await this.db.getPassesDueForRetry(now, MAX_RETRY_ATTEMPTS);

    for (const { id: passId, attempts } of duePasses) {
      try {
        await this.seasonPassService.renewPass(passId);
        this.logger.info('Retry renewal succeeded', { passId, attempt: attempts + 1 });
      } catch (err) {
        const newAttempts = attempts + 1;
        if (newAttempts >= MAX_RETRY_ATTEMPTS) {
          this.logger.warn('Max renewal retries reached — cancelling pass', {
            passId,
            attempts: newAttempts,
          });
          await this.db.cancelPassAfterMaxRetries(passId);
        } else {
          await this.db.incrementRenewalAttempts(passId);
          const nextRetry = new Date(now.getTime() + RETRY_INTERVAL_HOURS * 60 * 60 * 1000);
          this.logger.warn('Retry renewal failed, scheduling next attempt', {
            passId,
            attempt: newAttempts,
            nextAttemptAt: nextRetry.toISOString(),
          });
        }
      }
    }
  }
}

// =============================================================================
// Cron scheduler — wires the job to run every day at 08:00
// This module is imported by the app bootstrap; the cron library is injected
// so the job remains testable without a running scheduler.
// =============================================================================

export type CronScheduler = (cronExpression: string, fn: () => void | Promise<void>) => void;

export function scheduleRenewalJob(job: PassRenewalJob, scheduler: CronScheduler): void {
  // '0 8 * * *' = every day at 08:00 server time
  scheduler('0 8 * * *', async () => {
    try {
      await job.run();
    } catch (err) {
      // Top-level catch so a crash in one run does not kill the cron worker
      console.error('[PassRenewalJob] Unhandled error in job run', err);
    }
  });
}
