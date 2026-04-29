import { FlashSaleService } from '../services/flash-sale.service';
import type { FlashSaleDbAdapter } from '../services/flash-sale.service';

const CRON_INTERVAL_MS = 60_000; // 1 minute

interface JobLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

// ---------------------------------------------------------------------------
// FlashSaleJob
// ---------------------------------------------------------------------------

export class FlashSaleJob {
  private timer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private shutdownRequested = false;
  private currentTickDone: Promise<void> = Promise.resolve();

  constructor(
    private readonly flashSaleService: FlashSaleService,
    private readonly db: FlashSaleDbAdapter,
    private readonly logger: JobLogger,
  ) {}

  // -------------------------------------------------------------------------
  // start
  // -------------------------------------------------------------------------

  start(): void {
    if (this.timer !== null) {
      this.logger.info('FlashSaleJob is already running');
      return;
    }

    this.logger.info('FlashSaleJob started', { intervalMs: CRON_INTERVAL_MS });

    // Run immediately, then on every interval tick
    this.currentTickDone = this.runTick();

    this.timer = setInterval(() => {
      if (this.shutdownRequested) return;
      this.currentTickDone = this.runTick();
    }, CRON_INTERVAL_MS);
  }

  // -------------------------------------------------------------------------
  // stop — graceful shutdown
  // -------------------------------------------------------------------------

  async stop(): Promise<void> {
    this.shutdownRequested = true;

    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.logger.info(
      'FlashSaleJob shutdown requested — waiting for current tick to finish',
    );
    await this.currentTickDone;
    this.logger.info('FlashSaleJob stopped');
  }

  // -------------------------------------------------------------------------
  // runTick — processes activations and expirations in a single tick
  // -------------------------------------------------------------------------

  private async runTick(): Promise<void> {
    // Skip this tick if the previous one is still running
    if (this.isRunning) {
      this.logger.info(
        'FlashSaleJob: previous tick still running, skipping',
      );
      return;
    }

    this.isRunning = true;

    try {
      const [activated, ended] = await Promise.all([
        this.processActivations(),
        this.processExpirations(),
      ]);

      if (activated > 0 || ended > 0) {
        this.logger.info('FlashSaleJob tick complete', { activated, ended });
      }
    } catch (err) {
      this.logger.error('FlashSaleJob: unexpected tick error', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.isRunning = false;
    }
  }

  // -------------------------------------------------------------------------
  // processActivations
  // -------------------------------------------------------------------------

  private async processActivations(): Promise<number> {
    try {
      const count = await this.flashSaleService.processScheduledActivations(
        this.db,
      );
      if (count > 0) {
        this.logger.info(`FlashSaleJob: activated ${count} flash sale(s)`);
      }
      return count;
    } catch (err) {
      this.logger.error('FlashSaleJob: processScheduledActivations failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return 0;
    }
  }

  // -------------------------------------------------------------------------
  // processExpirations
  // -------------------------------------------------------------------------

  private async processExpirations(): Promise<number> {
    try {
      const count = await this.flashSaleService.processExpiredFlashSales(
        this.db,
      );
      if (count > 0) {
        this.logger.info(`FlashSaleJob: ended ${count} flash sale(s)`);
      }
      return count;
    } catch (err) {
      this.logger.error('FlashSaleJob: processExpiredFlashSales failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Process-level graceful shutdown wiring
// ---------------------------------------------------------------------------

export function registerShutdownHandler(job: FlashSaleJob): void {
  const shutdown = async (): Promise<void> => {
    await job.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

// ---------------------------------------------------------------------------
// Convenience factory — wire into your app entry point
// ---------------------------------------------------------------------------

export function createFlashSaleJob(
  db: FlashSaleDbAdapter,
  logger: JobLogger = console,
): FlashSaleJob {
  const service = new FlashSaleService();
  return new FlashSaleJob(service, db, logger);
}
