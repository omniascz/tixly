// Cron job — runs every 15 minutes.
// Processes due deliveries and retries failed ones.
//
// Skip-if-running guard prevents overlapping executions when a run takes
// longer than the 15-minute window.

import { DelayedDeliveryService } from '../services/delayed-delivery.service';
import type {
  DeliveryDbAdapter,
  KafkaProducerAdapter,
} from '../services/delayed-delivery.service';

// ---------------------------------------------------------------------------
// DeliveryJob
// ---------------------------------------------------------------------------

export class DeliveryJob {
  private isRunning = false;
  private readonly service: DelayedDeliveryService;

  constructor(
    private readonly db: DeliveryDbAdapter,
    private readonly kafka: KafkaProducerAdapter,
  ) {
    this.service = new DelayedDeliveryService();
  }

  // -------------------------------------------------------------------------
  // run — called by the cron scheduler every 15 minutes
  // -------------------------------------------------------------------------

  async run(): Promise<void> {
    if (this.isRunning) {
      console.warn('[delivery-job] Previous run still in progress — skipping this tick');
      return;
    }

    this.isRunning = true;
    const startedAt = Date.now();

    try {
      // Phase 1: process all due schedules
      const { delivered, failed } = await this.service.processDueDeliveries(
        this.db,
        this.kafka,
      );
      console.info(
        `[delivery-job] processDueDeliveries — delivered: ${delivered}, failed: ${failed}`,
      );

      // Phase 2: retry previously failed schedules
      const retried = await this.service.retryFailed(this.db, this.kafka);
      if (retried > 0) {
        console.info(`[delivery-job] retryFailed — retried: ${retried}`);
      }

      // Phase 3: release expired embargoes
      const { released } = await this.service.releaseExpiredEmbargoes(
        this.db,
        this.kafka,
      );
      if (released > 0) {
        console.info(`[delivery-job] releaseExpiredEmbargoes — released: ${released}`);
      }
    } catch (err) {
      console.error('[delivery-job] Unexpected error during run:', err);
    } finally {
      this.isRunning = false;
      const elapsed = Date.now() - startedAt;
      console.debug(`[delivery-job] Run complete in ${elapsed}ms`);
    }
  }

  // -------------------------------------------------------------------------
  // Graceful shutdown
  // -------------------------------------------------------------------------

  /**
   * Call this on SIGTERM / SIGINT.
   * Waits up to maxWaitMs for the current run to finish before resolving.
   */
  async shutdown(maxWaitMs = 30_000): Promise<void> {
    if (!this.isRunning) return;

    console.info('[delivery-job] Shutdown requested — waiting for current run to finish...');

    const deadline = Date.now() + maxWaitMs;
    while (this.isRunning && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
    }

    if (this.isRunning) {
      console.warn('[delivery-job] Shutdown timed out — run still in progress');
    } else {
      console.info('[delivery-job] Graceful shutdown complete');
    }
  }
}

// ---------------------------------------------------------------------------
// registerDeliveryCronJob — wire into your cron runtime at startup
// ---------------------------------------------------------------------------

/**
 * Registers the delivery cron job to run every 15 minutes.
 *
 * @param db    - Database adapter implementation
 * @param kafka - Kafka producer adapter implementation
 * @param cron  - Any cron library that accepts `schedule(expression, fn)`
 * @returns     The DeliveryJob instance (call .shutdown() on SIGTERM)
 *
 * @example
 *   import cron from 'node-cron';
 *   const job = registerDeliveryCronJob(db, kafka, cron);
 *   process.on('SIGTERM', () => job.shutdown());
 */
export function registerDeliveryCronJob(
  db: DeliveryDbAdapter,
  kafka: KafkaProducerAdapter,
  cron: {
    schedule(expression: string, fn: () => void | Promise<void>): void;
  },
): DeliveryJob {
  const job = new DeliveryJob(db, kafka);

  // Every 15 minutes
  cron.schedule('*/15 * * * *', () => {
    void job.run();
  });

  console.info('[delivery-job] Cron registered — running every 15 minutes');

  return job;
}
