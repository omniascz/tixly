import type { PhaseTransitionEvent } from '../types/pricing';
import type { PricingService } from '../services/pricing.service';
import type { DbAdapter } from '../services/pricing.service';

const UPCOMING_EVENT_WINDOW_HOURS = 48;
const CRON_INTERVAL_MS = 60_000; // 1 minute

interface JobLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export class PhaseCheckerJob {
  private timer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private shutdownRequested = false;
  private currentBatchDone: Promise<void> = Promise.resolve();

  constructor(
    private readonly pricingService: PricingService,
    private readonly db: DbAdapter,
    private readonly logger: JobLogger,
  ) {}

  start(): void {
    if (this.timer !== null) {
      this.logger.info('PhaseCheckerJob is already running');
      return;
    }

    this.logger.info('PhaseCheckerJob started', {
      intervalMs: CRON_INTERVAL_MS,
    });

    // Run immediately on start, then on interval
    this.currentBatchDone = this.runBatch();

    this.timer = setInterval(() => {
      if (this.shutdownRequested) return;
      this.currentBatchDone = this.runBatch();
    }, CRON_INTERVAL_MS);
  }

  /**
   * Graceful shutdown — waits for the current batch to finish before stopping.
   */
  async stop(): Promise<void> {
    this.shutdownRequested = true;

    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.logger.info('PhaseCheckerJob shutdown requested — waiting for current batch');
    await this.currentBatchDone;
    this.logger.info('PhaseCheckerJob stopped');
  }

  private async runBatch(): Promise<void> {
    if (this.isRunning) {
      this.logger.info('PhaseCheckerJob: previous batch still running, skipping');
      return;
    }

    this.isRunning = true;
    const startedAt = Date.now();
    let checked = 0;
    let transitioned = 0;

    try {
      const ticketTypes = await this.db.getActiveTicketTypesForUpcomingEvents(
        UPCOMING_EVENT_WINDOW_HOURS,
      );

      checked = ticketTypes.length;

      const results = await Promise.allSettled(
        ticketTypes.map((tt) =>
          this.pricingService.checkAndTransitionPhases(tt.id),
        ),
      );

      const transitions: PhaseTransitionEvent[] = [];

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value !== null) {
          transitions.push(result.value);
          transitioned++;
        } else if (result.status === 'rejected') {
          this.logger.error('PhaseCheckerJob: error checking ticket type', {
            error: result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
          });
        }
      }

      const durationMs = Date.now() - startedAt;
      this.logger.info('PhaseCheckerJob batch complete', {
        checked,
        transitioned,
        durationMs,
        transitions: transitions.map((t) => ({
          ticketTypeId: t.ticketTypeId,
          fromPhase: t.fromPhase,
          toPhase: t.toPhase,
          triggeredBy: t.triggeredBy,
        })),
      });
    } catch (err) {
      this.logger.error('PhaseCheckerJob: unexpected batch error', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.isRunning = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Process-level graceful shutdown wiring (called from app entry point)
// ---------------------------------------------------------------------------

export function registerShutdownHandler(job: PhaseCheckerJob): void {
  const shutdown = async (): Promise<void> => {
    await job.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
