import { PostEventReportService } from '../services/post-event-report.service';
import { ReportDbAdapter } from '../services/post-event-report.service';

/**
 * Cron job for processing finished events
 * Runs every 30 minutes to check for events that have finished
 * and generate reports for those that don't have one yet
 */

let isRunning = false;

/**
 * Process all finished events and generate reports
 * Implements graceful shutdown with skip-if-running
 */
export async function processFinishedEventsJob(db: ReportDbAdapter): Promise<void> {
  // Skip if already running
  if (isRunning) {
    console.log('[post-event-report-job] Job already running, skipping execution');
    return;
  }

  isRunning = true;

  try {
    const service = new PostEventReportService();
    const count = await service.processFinishedEvents(db);
    console.log(`[post-event-report-job] Successfully generated ${count} report(s)`);
  } catch (error) {
    console.error('[post-event-report-job] Error processing finished events:', error);
  } finally {
    isRunning = false;
  }
}

/**
 * Initialize the cron job (call this once in application startup)
 * Runs every 30 minutes
 * @param db Database adapter
 * @param intervalMs Interval between runs in milliseconds (default: 30 minutes)
 */
export function initializePostEventReportJob(
  db: ReportDbAdapter,
  intervalMs: number = 30 * 60 * 1000
): NodeJS.Timer {
  console.log('[post-event-report-job] Initializing job with 30-minute interval');

  // Run immediately on startup
  processFinishedEventsJob(db).catch((error) => {
    console.error('[post-event-report-job] Error in initial job run:', error);
  });

  // Then run periodically
  const timer = setInterval(() => {
    processFinishedEventsJob(db).catch((error) => {
      console.error('[post-event-report-job] Error in periodic job run:', error);
    });
  }, intervalMs);

  // Handle graceful shutdown
  process.on('SIGTERM', () => {
    console.log('[post-event-report-job] Received SIGTERM, waiting for current job to finish');
    clearInterval(timer);
    // Job will finish current iteration due to isRunning flag
  });

  process.on('SIGINT', () => {
    console.log('[post-event-report-job] Received SIGINT, waiting for current job to finish');
    clearInterval(timer);
  });

  return timer;
}
