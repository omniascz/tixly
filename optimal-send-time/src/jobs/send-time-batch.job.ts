/**
 * Optimal Send Time — nightly batch job
 *
 * Schedule: every day at 04:00 (before churn prediction job)
 *
 * Loads all active users who had at least one e-mail interaction in the last
 * 365 days and recomputes their Bayesian send-time model.
 *
 * Runs in batches of 50 with Promise.allSettled so a single user failure
 * does not abort the entire run.
 */

import { computeUserSendTime } from '../services/send-time.service';
import type { DbAdapter } from '../types/send-time.types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BATCH_SIZE        = 50;
const LOOKBACK_DAYS     = 365;

// ---------------------------------------------------------------------------
// Shutdown signal handling
// ---------------------------------------------------------------------------

let shuttingDown = false;

function registerShutdownHandlers(): void {
  const shutdown = (signal: string) => {
    console.log(`[send-time-batch] Received ${signal} — finishing current batch then exiting.`);
    shuttingDown = true;
  };

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// ---------------------------------------------------------------------------
// Main job
// ---------------------------------------------------------------------------

export async function runSendTimeBatchJob(db: DbAdapter): Promise<void> {
  registerShutdownHandlers();

  const startedAt = Date.now();
  console.log('[send-time-batch] Starting at', new Date(startedAt).toISOString());

  // ------------------------------------------------------------------
  // 1. Fetch all active user IDs
  // ------------------------------------------------------------------
  const rows = await db.query<{ user_id: string }>(
    `SELECT DISTINCT user_id
     FROM ai.email_engagement_log
     WHERE occurred_at >= NOW() - INTERVAL '${LOOKBACK_DAYS} days'
     ORDER BY user_id`
  );

  const userIds = rows.map((r) => r.user_id);
  console.log(`[send-time-batch] Found ${userIds.length} active users to process.`);

  // ------------------------------------------------------------------
  // 2. Process in batches
  // ------------------------------------------------------------------
  let successCount = 0;
  let errorCount   = 0;

  for (let offset = 0; offset < userIds.length; offset += BATCH_SIZE) {
    if (shuttingDown) {
      console.log(`[send-time-batch] Graceful shutdown — stopping after ${offset} users processed.`);
      break;
    }

    const batch   = userIds.slice(offset, offset + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((userId) => computeUserSendTime(userId, db))
    );

    for (let i = 0; i < batch.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        successCount++;
      } else {
        errorCount++;
        console.error(
          `[send-time-batch] Failed for user ${batch[i]}:`,
          result.reason instanceof Error ? result.reason.message : result.reason
        );
      }
    }

    const processed = Math.min(offset + BATCH_SIZE, userIds.length);
    console.log(
      `[send-time-batch] Progress: ${processed}/${userIds.length} ` +
      `(${successCount} ok, ${errorCount} errors so far)`
    );
  }

  const durationMs = Date.now() - startedAt;
  console.log(
    `[send-time-batch] Done in ${durationMs}ms. ` +
    `Computed send times for ${successCount} users, ${errorCount} errors.`
  );
}

// ---------------------------------------------------------------------------
// CLI entry point  (node dist/jobs/send-time-batch.job.js)
// ---------------------------------------------------------------------------

if (require.main === module) {
  // Lazy-import the production DB adapter to avoid bundling it into tests
  (async () => {
    // The actual DB adapter is project-specific; import from shared infra.
    // Adjust the import path to match the Tixly monorepo structure.
    const { createDbAdapter } = await import('../../../shared/db') as {
      createDbAdapter: () => DbAdapter;
    };

    const db = createDbAdapter();

    try {
      await runSendTimeBatchJob(db);
      process.exit(0);
    } catch (err) {
      console.error('[send-time-batch] Fatal error:', err);
      process.exit(1);
    }
  })();
}
