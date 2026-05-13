/**
 * Holdback Release Cron Job
 *
 * Runs every 5 minutes. Processes:
 *   1. Scheduled holdbacks whose release_at has passed
 *   2. Trigger-based holdbacks where sell-through >= threshold
 *
 * Usage:
 *   npx ts-node src/jobs/holdback-release.job.ts
 *
 * Graceful shutdown:
 *   SIGINT / SIGTERM → wait for current batch to finish, then exit
 */

import { HoldbackService } from '../services/holdback.service';
import type { HoldbackDbAdapter } from '../services/holdback.service';

// ---------------------------------------------------------------------------
// Adapter factory — replace with real PostgreSQL adapter in production
// ---------------------------------------------------------------------------

function buildDbAdapter(): HoldbackDbAdapter {
  // In production this would import and instantiate the real pg-based adapter.
  // The job is wired at the infrastructure layer; the service stays adapter-agnostic.
  throw new Error(
    'buildDbAdapter() must be replaced with the real DB adapter before deploying.',
  );
}

// ---------------------------------------------------------------------------
// Job state
// ---------------------------------------------------------------------------

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let isRunning = false;
let shutdownRequested = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Core job logic
// ---------------------------------------------------------------------------

async function runBatch(service: HoldbackService): Promise<void> {
  if (isRunning) {
    console.warn('[holdback-release] Previous batch still running — skipping tick');
    return;
  }

  isRunning = true;
  const startedAt = Date.now();

  try {
    const { released, errors } = await service.processScheduledReleases();

    const elapsedMs = Date.now() - startedAt;
    console.log(
      `[holdback-release] Released ${released} holdback(s) back to public` +
        (errors > 0 ? `, ${errors} error(s)` : '') +
        ` [${elapsedMs}ms]`,
    );

    if (errors > 0) {
      console.error(
        `[holdback-release] ${errors} holdback(s) failed to release — check logs above`,
      );
    }
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    console.error(
      `[holdback-release] Batch failed after ${elapsedMs}ms:`,
      err,
    );
  } finally {
    isRunning = false;
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function start(): Promise<void> {
  console.log('[holdback-release] Starting — interval every 5 minutes');

  const db = buildDbAdapter();
  const service = new HoldbackService(db);

  // Run immediately on start
  await runBatch(service);

  if (shutdownRequested) {
    console.log('[holdback-release] Shutdown requested during first run — exiting');
    process.exit(0);
  }

  intervalHandle = setInterval(() => {
    if (shutdownRequested) {
      return;
    }
    void runBatch(service);
  }, INTERVAL_MS);

  // Keep Node.js process alive
  intervalHandle.unref();
  // Re-ref so the process stays alive while the interval is active
  intervalHandle.ref();
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function shutdown(signal: string): void {
  if (shutdownRequested) return;
  shutdownRequested = true;

  console.log(`[holdback-release] ${signal} received — shutting down gracefully`);

  if (intervalHandle !== null) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }

  const waitForBatch = (): void => {
    if (!isRunning) {
      console.log('[holdback-release] All batches complete — exiting');
      process.exit(0);
    }
    console.log('[holdback-release] Waiting for current batch to finish...');
    setTimeout(waitForBatch, 500);
  };

  waitForBatch();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

start().catch((err: unknown) => {
  console.error('[holdback-release] Fatal startup error:', err);
  process.exit(1);
});
